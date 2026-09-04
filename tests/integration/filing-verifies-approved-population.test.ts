import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";

import { spawnSync } from "node:child_process";

import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

/**
 * Filing files the population that was approved (P14).
 *
 * WHAT THIS EXISTS TO CATCH. 20260904090000 stopped a READY shipment's
 * lines being edited, guarding on `s.status = 'READY'` -- and left the
 * status itself writable by any member. A guard conditioned on a value
 * the attacker controls is not a guard. Reproduced through the real
 * REST API with a plain member's own JWT, against a declaration an
 * administrator had approved over two lines totalling 4110 tCO2e:
 *
 *   MEMBER deletes a line while READY  -> 0 rows      (that guard held)
 *   MEMBER sets the shipment to DRAFT  -> succeeded
 *   MEMBER deletes the line            -> 1 row
 *   MEMBER sets it READY again         -> succeeded
 *   ADMIN  record_declaration_filed    -> OK
 *
 *   filed_snapshot: line_count 1, embedded_emissions_tco2e 2740
 *
 * The door is closed in 20260905110000. This suite covers the SECOND,
 * independent answer: even when something reaches the rows anyway,
 * filing compares what is there against what was approved and refuses.
 *
 * The mutations below are made with the service role, which is not a
 * hypothetical: it is every route that does not go through RLS -- an
 * internal job, a future policy regression, a restore artefact.
 */

const LOCAL_API_URL =
  process.env.SUPABASE_LOCAL_URL ??
  "http://127.0.0.1:54321";

const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const LOCAL_DB_URL =
  process.env.SUPABASE_LOCAL_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

async function localSupabaseReachable(): Promise<boolean> {
  try {
    const response =
      await fetch(
        `${LOCAL_API_URL}/auth/v1/health`,
        { signal: AbortSignal.timeout(1500) },
      );

    return response.ok;
  } catch {
    return false;
  }
}

const ready =
  await localSupabaseReachable();

interface RpcResultRow {
  result_status: string;
  result_declaration_id: string | null;
}

describe.skipIf(!ready)(
  "filing verifies the approved population (local Supabase only)",
  () => {
    const runId =
      crypto.randomUUID().slice(0, 8);

    const password = "ApprovedPopulation1";

    const serviceClient: SupabaseClient =
      createClient(
        LOCAL_API_URL,
        LOCAL_SERVICE_ROLE_KEY,
        { auth: { persistSession: false } },
      );

    let orgId: string;
    let adminId: string;
    let adminClient: SupabaseClient;
    let nextYear = 2301;

    beforeAll(async () => {
      const { data: org, error: orgError } =
        await serviceClient
          .from("organizations")
          .insert({
            name: `Approved Population ${runId}`,
            slug: `approved-population-${runId}`,
            capabilities: ["IMPORTER_DECLARANT"],
          })
          .select("id")
          .single();

      if (orgError || !org) {
        throw new Error(`org failed: ${orgError?.message}`);
      }

      orgId = org.id as string;

      const { data: user, error: userError } =
        await serviceClient.auth.admin.createUser({
          email: `approved-population-admin-${runId}@example.com`,
          password,
          email_confirm: true,
        });

      if (userError || !user.user) {
        throw new Error(`user failed: ${userError?.message}`);
      }

      adminId = user.user.id;

      await serviceClient
        .from("memberships")
        .insert({ org_id: orgId, user_id: adminId, role: "ADMIN" });

      adminClient =
        createClient(LOCAL_API_URL, LOCAL_ANON_KEY, {
          auth: { persistSession: false },
        });

      const { error: signInError } =
        await adminClient.auth.signInWithPassword({
          email: `approved-population-admin-${runId}@example.com`,
          password,
        });

      if (signInError) {
        throw new Error(`sign-in failed: ${signInError.message}`);
      }
    });

    afterAll(async () => {
      for (
        const table of [
          "declarations",
          "calculation_results",
          "shipment_lines",
          "shipments",
          "audit_events",
          "memberships",
        ]
      ) {
        await serviceClient.from(table).delete().eq("org_id", orgId);
      }

      await serviceClient.from("organizations").delete().eq("id", orgId);

      if (adminId) {
        await serviceClient.auth.admin.deleteUser(adminId);
      }
    });

    /**
     * A shipment of two calculated lines, approved, with a declaration
     * approved over it. 1000 t + 500 t at a fixed rate.
     */
    async function seedApproved(): Promise<{
      year: number;
      shipmentId: string;
      lineIds: string[];
      declarationId: string;
      approved: string[] | null;
    }> {
      const year = nextYear++;
      const determination = { method: "DEFAULT", marker: `y${year}` };

      const { data: shipment } =
        await serviceClient
          .from("shipments")
          .insert({
            org_id: orgId,
            reference: `POP-${year}-${runId}`,
            release_date: `${year}-06-01`,
            reporting_period_kind: "ANNUAL",
            reporting_period_year: year,
            status: "DRAFT",
          })
          .select("id")
          .single();

      const lineIds: string[] = [];

      for (const [index, tonnes] of [["1", "1000"], ["2", "500"]]) {
        const { data: line, error } =
          await serviceClient
            .from("shipment_lines")
            .insert({
              shipment_id: shipment!.id,
              org_id: orgId,
              line_number: Number(index),
              cn_code: "72081000",
              cn_code_level: "CN8",
              origin_country: "IN",
              net_mass_tonnes: tonnes,
              emission_determination: determination,
            })
            .select("id")
            .single();

        if (error || !line) {
          throw new Error(`line failed: ${error?.message}`);
        }

        lineIds.push(line.id as string);

        const { error: calcError } =
          await serviceClient
            .from("calculation_results")
            .insert({
              org_id: orgId,
              line_id: line.id,
              shipment_id: shipment!.id,
              engine_version: "1.4.0",
              quantity: tonnes,
              quantity_unit: "TONNES",
              determination,
              steps: [],
              embedded_emissions_tco2e: tonnes,
              calculated_by_user_id: adminId,
            });

        if (calcError) {
          throw new Error(`calculation failed: ${calcError.message}`);
        }
      }

      await serviceClient
        .from("shipments")
        .update({ status: "READY" })
        .eq("id", shipment!.id);

      const { data: declaration, error: declError } =
        await adminClient
          .from("declarations")
          .insert({
            org_id: orgId,
            reporting_period_kind: "ANNUAL",
            reporting_period_year: year,
            status: "DRAFT",
            member_shipment_ids: [shipment!.id],
            created_by_user_id: adminId,
          })
          .select("id")
          .single();

      if (declError || !declaration) {
        throw new Error(`declaration failed: ${declError?.message}`);
      }

      await adminClient
        .from("declarations")
        .update({ status: "READY" })
        .eq("id", declaration.id);

      const { data: approvedRow } =
        await serviceClient
          .from("declarations")
          .select("approved_line_ids")
          .eq("id", declaration.id)
          .single();

      return {
        year,
        shipmentId: shipment!.id as string,
        lineIds,
        declarationId: declaration.id as string,
        approved:
          (approvedRow?.approved_line_ids as string[] | null) ?? null,
      };
    }

    async function file(
      declarationId: string,
      reference: string,
    ): Promise<string> {
      const { data, error } =
        await adminClient.rpc("record_declaration_filed", {
          p_declaration_id: declarationId,
          p_filed_reference: reference,
        });

      if (error) {
        throw new Error(`rpc failed: ${error.message}`);
      }

      return (data as RpcResultRow[] | null)?.[0]?.result_status ?? "NONE";
    }

    /**
     * Reaches the lines the way anything not bound by RLS would.
     *
     * 2026-09-04 (P14). This used to reopen the shipment, delete, and
     * mark it ready again. That is no longer a route to the state these
     * cases test: reopening now retires the approval of every READY
     * declaration containing the shipment (20260905140000), so filing
     * would refuse with NOT_READY before reaching the population
     * comparison, and every case below would pass while proving nothing
     * about it.
     *
     * The comparison is defence in depth for paths that do NOT reopen --
     * an internal job, a restore artefact, a future policy regression --
     * so the mutation is made the way those reach the rows: directly,
     * with the line trigger suspended, leaving the shipment READY and
     * the declaration approved throughout.
     */
    function mutateLinesBehindTheApproval(sql: string): void {
      const result =
        spawnSync(
          "psql",
          [
            LOCAL_DB_URL,
            "-v",
            "ON_ERROR_STOP=1",
            "-q",
            "-c",
            "alter table public.shipment_lines disable trigger user; " +
              sql +
              " alter table public.shipment_lines enable trigger user;",
          ],
          { encoding: "utf8" },
        );

      if (result.error) {
        throw result.error;
      }

      if (result.status !== 0) {
        throw new Error(`psql exited ${result.status}: ${result.stderr}`);
      }
    }

    async function shrinkPopulationBehindTheApproval(
      _shipmentId: string,
      lineId: string,
    ): Promise<void> {
      mutateLinesBehindTheApproval(
        `delete from public.shipment_lines where id = '${lineId}';`,
      );
    }

    it(
      "records what was approved, read from the database rather than from the caller",
      async () => {
        const seeded = await seedApproved();

        expect(seeded.approved).not.toBeNull();

        expect([...(seeded.approved ?? [])].sort()).toEqual(
          [...seeded.lineIds].sort(),
        );
      },
    );

    it(
      "a caller cannot declare a population that was never approved",
      async () => {
        // The frozen set must be a fact the database established. If a
        // caller could supply it, the check below would be checking the
        // attacker's own claim.
        const year = nextYear++;

        const { data: shipment } =
          await serviceClient
            .from("shipments")
            .insert({
              org_id: orgId,
              reference: `POP-FORGE-${year}-${runId}`,
              release_date: `${year}-06-01`,
              reporting_period_kind: "ANNUAL",
              reporting_period_year: year,
              status: "DRAFT",
            })
            .select("id")
            .single();

        // The shipment must itself be approved before a declaration over
        // it can be (20260905140000), so this does that first -- the
        // case is about the forged population, not about that rule.
        await serviceClient
          .from("shipments")
          .update({ status: "READY" })
          .eq("id", shipment!.id);

        // Created as DRAFT (the only status an insert accepts) and then
        // approved, with a forged population supplied on BOTH writes --
        // the shape a caller would actually attempt.
        const { data: declaration, error: insertError } =
          await adminClient
            .from("declarations")
            .insert({
              org_id: orgId,
              reporting_period_kind: "ANNUAL",
              reporting_period_year: year,
              status: "DRAFT",
              member_shipment_ids: [shipment!.id],
              created_by_user_id: adminId,
              approved_line_ids: [crypto.randomUUID()],
            })
            .select("id")
            .single();

        if (insertError || !declaration) {
          throw new Error(`declaration failed: ${insertError?.message}`);
        }

        await adminClient
          .from("declarations")
          .update({
            status: "READY",
            approved_line_ids: [crypto.randomUUID(), crypto.randomUUID()],
          })
          .eq("id", declaration.id);

        const { data: row } =
          await serviceClient
            .from("declarations")
            .select("approved_line_ids")
            .eq("id", declaration!.id)
            .single();

        // The shipment has no lines, so the truth is the empty set --
        // not the uuid the caller invented.
        expect(row?.approved_line_ids).toEqual([]);
      },
    );

    it(
      "files normally when the population is untouched",
      async () => {
        const seeded = await seedApproved();

        expect(
          await file(seeded.declarationId, `REF-OK-${seeded.year}`),
        ).toBe("OK");

        const { data: filed } =
          await serviceClient
            .from("declarations")
            .select("status, filed_snapshot")
            .eq("id", seeded.declarationId)
            .single();

        expect(filed?.status).toBe("FILED_RECORDED");

        expect(
          filed?.filed_snapshot?.totals?.line_count,
        ).toBe(2);
      },
    );

    it(
      "REFUSES when an approved line has been removed since approval",
      async () => {
        const seeded = await seedApproved();

        await shrinkPopulationBehindTheApproval(
          seeded.shipmentId,
          seeded.lineIds[1]!,
        );

        expect(
          await file(seeded.declarationId, `REF-SHRUNK-${seeded.year}`),
        ).toBe("POPULATION_CHANGED_SINCE_READY");

        // Refused means refused: nothing filed, nothing locked.
        const { data: declaration } =
          await serviceClient
            .from("declarations")
            .select("status, filed_snapshot, filed_reference")
            .eq("id", seeded.declarationId)
            .single();

        expect(declaration?.status).toBe("READY");
        expect(declaration?.filed_snapshot).toBeNull();
        expect(declaration?.filed_reference).toBeNull();

        const { data: shipment } =
          await serviceClient
            .from("shipments")
            .select("status")
            .eq("id", seeded.shipmentId)
            .single();

        expect(shipment?.status).not.toBe("LOCKED");
      },
    );

    it(
      "REFUSES when a line has been added since approval",
      async () => {
        // Both directions matter: a population that grew is no more the
        // approved one than a population that shrank.
        const seeded = await seedApproved();

        mutateLinesBehindTheApproval(
          `insert into public.shipment_lines (shipment_id, org_id, line_number, cn_code, cn_code_level, origin_country, net_mass_tonnes, emission_determination) ` +
            `values ('${seeded.shipmentId}', '${orgId}', 3, '72081000', 'CN8', 'IN', '250', '{"method":"DEFAULT","marker":"added"}'::jsonb);`,
        );

        expect(
          await file(seeded.declarationId, `REF-GREW-${seeded.year}`),
        ).toBe("POPULATION_CHANGED_SINCE_READY");
      },
    );

    it(
      "the record of what was approved cannot be rewritten to match what is there now",
      async () => {
        // Otherwise the check above is trivially defeated by editing the
        // thing it compares against.
        const seeded = await seedApproved();

        await serviceClient
          .from("declarations")
          .update({ approved_line_ids: [seeded.lineIds[0]] })
          .eq("id", seeded.declarationId);

        // The property is that the value does not change, and it is the
        // database that guarantees it: the freeze trigger restores the
        // recorded set before anything else sees the row, so a write
        // aimed at it is simply not a write. Asserting the STORED VALUE
        // rather than an exception, because the exception is a
        // mechanism and this is the invariant.
        const { data: still } =
          await serviceClient
            .from("declarations")
            .select("approved_line_ids")
            .eq("id", seeded.declarationId)
            .single();

        expect([...(still?.approved_line_ids ?? [])].sort()).toEqual(
          [...seeded.lineIds].sort(),
        );

        // And the filing check still sees the real approved set, so the
        // attempt bought nothing.
        await shrinkPopulationBehindTheApproval(
          seeded.shipmentId,
          seeded.lineIds[1]!,
        );

        expect(
          await file(seeded.declarationId, `REF-REWRITE-${seeded.year}`),
        ).toBe("POPULATION_CHANGED_SINCE_READY");
      },
    );

    // ----------------------------------------------------------------
    // 2026-09-04 (P14). Content, not just identity.
    //
    // approved_line_ids freezes WHICH lines. The filed figure is made of
    // what is IN them. Reproduced before this rule existed: an admin
    // reopened a shipment for an ordinary correction, a MEMBER changed a
    // line 1000 -> 10, the line was re-determined and recalculated
    // through the product's own path, the admin re-approved the
    // SHIPMENT, and the filing recorded 510 against an approved 1500 --
    // identities unchanged, so every gate passed.
    //
    // Re-approving a shipment is not re-approving a declaration.
    // ----------------------------------------------------------------
    it(
      "reopening a member shipment retires the declaration's approval",
      async () => {
        const seeded = await seedApproved();

        await serviceClient
          .from("shipments")
          .update({ status: "DRAFT" })
          .eq("id", seeded.shipmentId);

        const { data: declaration } =
          await serviceClient
            .from("declarations")
            .select("status, approved_line_ids")
            .eq("id", seeded.declarationId)
            .single();

        expect(declaration?.status).toBe("DRAFT");
        expect(declaration?.approved_line_ids).toBeNull();
      },
    );

    it(
      "content changed under unchanged identities cannot be filed on the old approval",
      async () => {
        const seeded = await seedApproved();

        // The exact reproduction: reopen, change a line's quantity,
        // re-determine, recalculate, re-approve the SHIPMENT, file.
        await serviceClient
          .from("shipments")
          .update({ status: "DRAFT" })
          .eq("id", seeded.shipmentId);

        await serviceClient
          .from("shipment_lines")
          .update({ net_mass_tonnes: "10" })
          .eq("id", seeded.lineIds[0]!);

        await serviceClient
          .from("shipment_lines")
          .update({
            emission_determination: { method: "DEFAULT", marker: `y${seeded.year}` },
          })
          .eq("id", seeded.lineIds[0]!);

        await serviceClient
          .from("calculation_results")
          .insert({
            org_id: orgId,
            line_id: seeded.lineIds[0],
            shipment_id: seeded.shipmentId,
            engine_version: "1.4.0",
            quantity: "10",
            quantity_unit: "TONNES",
            determination: { method: "DEFAULT", marker: `y${seeded.year}` },
            steps: [],
            embedded_emissions_tco2e: "10",
            calculated_by_user_id: adminId,
          });

        await serviceClient
          .from("shipments")
          .update({ status: "READY" })
          .eq("id", seeded.shipmentId);

        // The identities are untouched, and every other gate is
        // satisfied. Only the retired approval refuses it.
        expect(
          await file(seeded.declarationId, `REF-CONTENT-${seeded.year}`),
        ).toBe("NOT_READY");

        const { data: declaration } =
          await serviceClient
            .from("declarations")
            .select("status, filed_snapshot")
            .eq("id", seeded.declarationId)
            .single();

        expect(declaration?.status).toBe("DRAFT");
        expect(declaration?.filed_snapshot).toBeNull();
      },
    );

    it(
      "a declaration cannot be approved over a shipment that is not itself approved",
      async () => {
        // The step to the left: approve the declaration while a member
        // is still DRAFT, edit its lines freely, then mark the shipment
        // ready and file. Refused at the approval instead.
        const year = nextYear++;

        const { data: shipment } =
          await serviceClient
            .from("shipments")
            .insert({
              org_id: orgId,
              reference: `POP-DRAFT-${year}-${runId}`,
              release_date: `${year}-06-01`,
              reporting_period_kind: "ANNUAL",
              reporting_period_year: year,
              status: "DRAFT",
            })
            .select("id")
            .single();

        const { data: declaration } =
          await adminClient
            .from("declarations")
            .insert({
              org_id: orgId,
              reporting_period_kind: "ANNUAL",
              reporting_period_year: year,
              status: "DRAFT",
              member_shipment_ids: [shipment!.id],
              created_by_user_id: adminId,
            })
            .select("id")
            .single();

        const { error } =
          await adminClient
            .from("declarations")
            .update({ status: "READY" })
            .eq("id", declaration!.id);

        expect(error).not.toBeNull();

        expect(error?.message ?? "").toMatch(
          /member shipments are not themselves approved/i,
        );
      },
    );

    it(
      "the whole legitimate correction still works: reopen, edit, re-approve both, file",
      async () => {
        // The rule must not make correction impossible. This is the
        // supported end-to-end path an administrator takes to fix an
        // approved shipment, and it has to finish in a filed
        // declaration carrying the CORRECTED figure.
        const seeded = await seedApproved();

        await serviceClient
          .from("shipments")
          .update({ status: "DRAFT" })
          .eq("id", seeded.shipmentId);

        // The declaration's approval is retired by that reopen.
        const { data: retired } =
          await serviceClient
            .from("declarations")
            .select("status")
            .eq("id", seeded.declarationId)
            .single();

        expect(retired?.status).toBe("DRAFT");

        // The administrator corrects the line and recalculates it.
        await serviceClient
          .from("shipment_lines")
          .update({
            net_mass_tonnes: "800",
            emission_determination: { method: "DEFAULT", marker: `y${seeded.year}` },
          })
          .eq("id", seeded.lineIds[0]!);

        await serviceClient
          .from("calculation_results")
          .insert({
            org_id: orgId,
            line_id: seeded.lineIds[0],
            shipment_id: seeded.shipmentId,
            engine_version: "1.4.0",
            quantity: "800",
            quantity_unit: "TONNES",
            determination: { method: "DEFAULT", marker: `y${seeded.year}` },
            steps: [],
            embedded_emissions_tco2e: "800",
            calculated_by_user_id: adminId,
          });

        // Both are re-approved, in the order the product requires.
        await serviceClient
          .from("shipments")
          .update({ status: "READY" })
          .eq("id", seeded.shipmentId);

        await adminClient
          .from("declarations")
          .update({ status: "READY" })
          .eq("id", seeded.declarationId);

        expect(
          await file(seeded.declarationId, `REF-CORRECTED-${seeded.year}`),
        ).toBe("OK");

        const { data: filed } =
          await serviceClient
            .from("declarations")
            .select("status, filed_snapshot")
            .eq("id", seeded.declarationId)
            .single();

        expect(filed?.status).toBe("FILED_RECORDED");

        // 800 + 500, the corrected figure -- not the 1000 + 500 that
        // was originally approved.
        expect(
          filed?.filed_snapshot?.totals?.embedded_emissions_tco2e,
        ).toBe("1300");
      },
    );

    it(
      "re-approving after a legitimate edit records the new population",
      async () => {
        // The refusal must be recoverable by the workflow it names,
        // or it is just an outage.
        const seeded = await seedApproved();

        await shrinkPopulationBehindTheApproval(
          seeded.shipmentId,
          seeded.lineIds[1]!,
        );

        expect(
          await file(seeded.declarationId, `REF-BEFORE-${seeded.year}`),
        ).toBe("POPULATION_CHANGED_SINCE_READY");

        // Reopen the declaration and approve it again -- which is what
        // the message tells the user to do.
        await adminClient
          .from("declarations")
          .update({ status: "DRAFT" })
          .eq("id", seeded.declarationId);

        await adminClient
          .from("declarations")
          .update({ status: "READY" })
          .eq("id", seeded.declarationId);

        const { data: refrozen } =
          await serviceClient
            .from("declarations")
            .select("approved_line_ids")
            .eq("id", seeded.declarationId)
            .single();

        expect(refrozen?.approved_line_ids).toEqual([seeded.lineIds[0]]);

        expect(
          await file(seeded.declarationId, `REF-AFTER-${seeded.year}`),
        ).toBe("OK");
      },
    );
  },
);

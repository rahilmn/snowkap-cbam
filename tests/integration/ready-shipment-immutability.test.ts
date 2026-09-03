import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";

import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

// Standing suite for P14 FILE-1 / owner decision 1.
//
// READY is an approval checkpoint: it records the line population and
// content a declarant approved for filing. Before this was enforced, a
// plain MEMBER could delete one of two approved lines from a READY
// shipment and the subsequent filing recorded 2640 tCO2e against a
// period containing 3960 -- a 33% under-report in an immutable
// artifact, produced through the ordinary UI ("Remove line", with a
// confirmation dialog), signed off by an administrator who approved
// 3960, with every filing-time check passing because all of them
// describe the state at filing rather than the state that was
// approved.
//
// The invariant is
//
//     READY population == FILED population
//
// and it is enforced at the MUTATION boundary rather than by comparing
// snapshots at filing time -- see
// supabase/migrations/20260904090000_p14_ready_shipments_are_not_editable.sql
// for why. Editing an approved shipment is not forbidden; it is made
// explicit. REOPEN (READY -> DRAFT) already exists in
// src/domain/shipments/lifecycle.ts and is audited.
//
// Raw supabase-js against RLS and the trigger, never through
// manage-lines.ts: the point is the wall that stands when the
// application layer is bypassed, because bypassing it is exactly what
// the reproduction did.

const LOCAL_API_URL =
  process.env.SUPABASE_LOCAL_URL ??
  "http://127.0.0.1:54321";

const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

async function isLocalSupabaseReachable(): Promise<boolean> {
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

const localSupabaseReachable =
  await isLocalSupabaseReachable();

describe.skipIf(!localSupabaseReachable)(
  "READY shipments are not editable (P14 FILE-1, local Supabase only)",
  () => {
    const runId = crypto.randomUUID().slice(0, 8);
    const password = `ready-immutability-${runId}!`;

    const serviceClient: SupabaseClient =
      createClient(LOCAL_API_URL, LOCAL_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      });

    let orgId: string;
    let adminId: string;
    let memberId: string;
    let adminClient: SupabaseClient;
    let memberClient: SupabaseClient;

    let nextYear = 2700;

    /** DRAFT shipment with one line -- the state before approval. */
    async function seedDraftShipment(): Promise<{
      shipmentId: string;
      lineId: string;
    }> {
      const year = nextYear++;

      const { data: shipment, error: shipmentError } =
        await serviceClient
          .from("shipments")
          .insert({
            org_id: orgId,
            reference: `READY-IMMUT-${year}-${runId}`,
            release_date: `${year}-06-01`,
            reporting_period_kind: "ANNUAL",
            reporting_period_year: year,
            status: "DRAFT",
          })
          .select("id")
          .single();

      if (shipmentError || !shipment) {
        throw new Error(`seed shipment failed: ${shipmentError?.message}`);
      }

      const { data: line, error: lineError } =
        await serviceClient
          .from("shipment_lines")
          .insert({
            shipment_id: shipment.id,
            org_id: orgId,
            line_number: 1,
            cn_code: "72081000",
            cn_code_level: "CN8",
            origin_country: "IN",
            net_mass_tonnes: "1000",
          })
          .select("id")
          .single();

      if (lineError || !line) {
        throw new Error(`seed line failed: ${lineError?.message}`);
      }

      return { shipmentId: shipment.id as string, lineId: line.id as string };
    }

    async function setStatus(shipmentId: string, status: string): Promise<void> {
      const { error } =
        await serviceClient
          .from("shipments")
          .update({ status })
          .eq("id", shipmentId);

      if (error) {
        throw new Error(`set status ${status} failed: ${error.message}`);
      }
    }

    beforeAll(async () => {
      const { data: org, error: orgError } =
        await serviceClient
          .from("organizations")
          .insert({
            name: `Ready Immutability ${runId}`,
            slug: `ready-immutability-${runId}`,
            capabilities: ["IMPORTER_DECLARANT"],
          })
          .select("id")
          .single();

      if (orgError || !org) {
        throw new Error(`org failed: ${orgError?.message}`);
      }

      orgId = org.id as string;

      async function createUser(label: string): Promise<string> {
        const { data, error } =
          await serviceClient.auth.admin.createUser({
            email: `ready-immutability-${label}-${runId}@example.com`,
            password,
            email_confirm: true,
          });

        if (error || !data.user) {
          throw new Error(`user ${label} failed: ${error?.message}`);
        }

        return data.user.id;
      }

      adminId = await createUser("admin");
      memberId = await createUser("member");

      const { error: membershipError } =
        await serviceClient
          .from("memberships")
          .insert([
            { org_id: orgId, user_id: adminId, role: "ADMIN" },
            { org_id: orgId, user_id: memberId, role: "MEMBER" },
          ]);

      if (membershipError) {
        throw new Error(`memberships failed: ${membershipError.message}`);
      }

      async function signIn(label: string): Promise<SupabaseClient> {
        const client =
          createClient(LOCAL_API_URL, LOCAL_ANON_KEY, {
            auth: { persistSession: false },
          });

        const { error } =
          await client.auth.signInWithPassword({
            email: `ready-immutability-${label}-${runId}@example.com`,
            password,
          });

        if (error) {
          throw new Error(`sign in ${label} failed: ${error.message}`);
        }

        return client;
      }

      adminClient = await signIn("admin");
      memberClient = await signIn("member");
    });

    afterAll(async () => {
      await serviceClient.from("calculation_results").delete().eq("org_id", orgId);
      await serviceClient.from("shipment_lines").delete().eq("org_id", orgId);
      await serviceClient.from("shipments").delete().eq("org_id", orgId);
      await serviceClient.from("audit_events").delete().eq("org_id", orgId);
      await serviceClient.from("memberships").delete().eq("org_id", orgId);
      await serviceClient.from("organizations").delete().eq("id", orgId);

      for (const id of [adminId, memberId]) {
        if (id) {
          await serviceClient.auth.admin.deleteUser(id);
        }
      }
    });

    /**
     * How a refusal actually presents, stated once because it decides
     * what every assertion below can check.
     *
     * A DELETE or UPDATE that RLS filters out is not an error:
     * PostgREST reports success with zero rows affected, because from
     * Postgres's point of view the statement matched nothing. So the
     * assertion has to be "the row is still there, still saying what it
     * said", not "an error came back".
     *
     * An INSERT is different -- a row failing WITH CHECK is a policy
     * violation and does raise.
     *
     * The trigger raises for everyone, but only for rows that reach it;
     * under RLS the row is already filtered away, so the trigger is
     * what binds service_role, which RLS does not constrain.
     *
     * The application layer turns the silent case into something a user
     * can act on: manage-lines.ts maps "zero rows affected" to
     * SHIPMENT_NOT_EDITABLE rather than reporting success.
     */
    describe("a READY shipment refuses every line mutation", () => {
      it("MEMBER cannot DELETE a line -- the exact reproduction that filed 2640 against 3960", async () => {
        const { shipmentId, lineId } = await seedDraftShipment();
        await setStatus(shipmentId, "READY");

        await memberClient
          .from("shipment_lines")
          .delete()
          .eq("id", lineId);

        // The line is still there. That is the assertion that matters:
        // the approved population did not change.
        const { count } =
          await serviceClient
            .from("shipment_lines")
            .select("id", { count: "exact", head: true })
            .eq("shipment_id", shipmentId);

        expect(count).toBe(1);
      });

      it("MEMBER cannot INSERT a line", async () => {
        const { shipmentId } = await seedDraftShipment();
        await setStatus(shipmentId, "READY");

        const { error } =
          await memberClient
            .from("shipment_lines")
            .insert({
              shipment_id: shipmentId,
              org_id: orgId,
              line_number: 2,
              cn_code: "72081000",
              cn_code_level: "CN8",
              origin_country: "IN",
              net_mass_tonnes: "1",
            });

        expect(error).not.toBeNull();
      });

      it("MEMBER cannot UPDATE a line's quantity", async () => {
        const { shipmentId, lineId } = await seedDraftShipment();
        await setStatus(shipmentId, "READY");

        await memberClient
          .from("shipment_lines")
          .update({ net_mass_tonnes: "1" })
          .eq("id", lineId);

        const { data } =
          await serviceClient
            .from("shipment_lines")
            .select("net_mass_tonnes")
            .eq("id", lineId)
            .single();

        expect(data?.net_mass_tonnes).toBe("1000");
      });

      it(
        "an ADMIN cannot either -- this is a lifecycle rule, not a role " +
          "restriction, so the approver has no privileged edit path around it",
        async () => {
          const { shipmentId, lineId } = await seedDraftShipment();
          await setStatus(shipmentId, "READY");

          await adminClient
            .from("shipment_lines")
            .delete()
            .eq("id", lineId);

          await adminClient
            .from("shipment_lines")
            .update({ net_mass_tonnes: "1" })
            .eq("id", lineId);

          const { data } =
            await serviceClient
              .from("shipment_lines")
              .select("net_mass_tonnes")
              .eq("id", lineId)
              .maybeSingle();

          expect(data).not.toBeNull();
          expect(data?.net_mass_tonnes).toBe("1000");
        },
      );

      it(
        "re-determining an approved line is refused too -- changing the " +
          "emissions basis of an approved line changes what was approved just " +
          "as surely as deleting it",
        async () => {
          const { shipmentId, lineId } = await seedDraftShipment();
          await setStatus(shipmentId, "READY");

          await memberClient
            .from("shipment_lines")
            .update({
              emission_determination: { method: "DEFAULT", forged: true },
            })
            .eq("id", lineId);

          const { data } =
            await serviceClient
              .from("shipment_lines")
              .select("emission_determination")
              .eq("id", lineId)
              .single();

          expect(data?.emission_determination).toBeNull();
        },
      );

      it(
        "the trusted server role is bound by it as well -- this is a " +
          "data-integrity fact about what an administrator approved, not an " +
          "authorization rule about who is asking",
        async () => {
          const { shipmentId, lineId } = await seedDraftShipment();
          await setStatus(shipmentId, "READY");

          const { error } =
            await serviceClient
              .from("shipment_lines")
              .delete()
              .eq("id", lineId);

          expect(error).not.toBeNull();
          expect(error?.message).toContain("marked READY");
        },
      );
    });

    describe("the ordinary workflow is untouched", () => {
      it("DRAFT lines are still fully editable by a MEMBER", async () => {
        const { shipmentId, lineId } = await seedDraftShipment();

        const update =
          await memberClient
            .from("shipment_lines")
            .update({ net_mass_tonnes: "999" })
            .eq("id", lineId);

        expect(update.error).toBeNull();

        const insert =
          await memberClient
            .from("shipment_lines")
            .insert({
              shipment_id: shipmentId,
              org_id: orgId,
              line_number: 2,
              cn_code: "72081000",
              cn_code_level: "CN8",
              origin_country: "IN",
              net_mass_tonnes: "5",
            });

        expect(insert.error).toBeNull();

        const remove =
          await memberClient
            .from("shipment_lines")
            .delete()
            .eq("id", lineId);

        expect(remove.error).toBeNull();
      });

      it(
        "REOPEN is the way through: reopen, edit, mark ready again -- the " +
          "edit is not forbidden, it is made explicit and auditable",
        async () => {
          const { shipmentId, lineId } = await seedDraftShipment();
          await setStatus(shipmentId, "READY");

          await memberClient
            .from("shipment_lines")
            .update({ net_mass_tonnes: "42" })
            .eq("id", lineId);

          const { data: whileReady } =
            await serviceClient
              .from("shipment_lines")
              .select("net_mass_tonnes")
              .eq("id", lineId)
              .single();

          expect(whileReady?.net_mass_tonnes).toBe("1000");

          // REOPEN (READY -> DRAFT), the transition
          // src/domain/shipments/lifecycle.ts already defines.
          await setStatus(shipmentId, "DRAFT");

          const allowed =
            await memberClient
              .from("shipment_lines")
              .update({ net_mass_tonnes: "42" })
              .eq("id", lineId);

          expect(allowed.error).toBeNull();

          await setStatus(shipmentId, "READY");

          const { data } =
            await serviceClient
              .from("shipment_lines")
              .select("net_mass_tonnes")
              .eq("id", lineId)
              .single();

          expect(data?.net_mass_tonnes).toBe("42");
        },
      );

      it("LOCKED and VOID remain refused, exactly as before", async () => {
        const locked = await seedDraftShipment();
        await setStatus(locked.shipmentId, "LOCKED");

        await memberClient
          .from("shipment_lines")
          .delete()
          .eq("id", locked.lineId);

        const voided = await seedDraftShipment();
        await setStatus(voided.shipmentId, "VOID");

        await memberClient
          .from("shipment_lines")
          .delete()
          .eq("id", voided.lineId);

        const { count } =
          await serviceClient
            .from("shipment_lines")
            .select("id", { count: "exact", head: true })
            .in("id", [locked.lineId, voided.lineId]);

        expect(count).toBe(2);
      });
    });

    // ----------------------------------------------------------------
    // 2026-09-04 (P14). The door the first fix left open.
    //
    // The cases above prove a READY shipment's lines cannot be edited.
    // They all condition on the status being READY -- and nothing stopped
    // a plain MEMBER changing that status. Reproduced through the real
    // REST API with a member's own JWT: reopen to DRAFT, delete an
    // approved line, mark READY again, and the administrator's filing
    // recorded 2740 tCO2e against an approved 4110.
    //
    // A guard conditioned on a value the attacker controls is not a
    // guard, which is why the fix is in two places: the status itself is
    // administrative territory, and filing independently re-checks the
    // population.
    // ----------------------------------------------------------------
    describe("READY is administrative territory", () => {
      it("a MEMBER cannot reopen a READY shipment", async () => {
        const { shipmentId } = await seedDraftShipment();
        await setStatus(shipmentId, "READY");

        const { data, error } =
          await memberClient
            .from("shipments")
            .update({ status: "DRAFT" })
            .eq("id", shipmentId)
            .select("status");

        // RLS filters rather than raising, so "no rows" is the refusal.
        expect(error).toBeNull();
        expect(data ?? []).toEqual([]);

        const { data: still } =
          await serviceClient
            .from("shipments")
            .select("status")
            .eq("id", shipmentId)
            .single();

        expect(still?.status).toBe("READY");
      });

      it("a MEMBER cannot change anything else on a READY shipment either", async () => {
        const { shipmentId } = await seedDraftShipment();
        await setStatus(shipmentId, "READY");

        await memberClient
          .from("shipments")
          .update({ reference: "MEMBER-RENAMED" })
          .eq("id", shipmentId);

        const { data: still } =
          await serviceClient
            .from("shipments")
            .select("reference")
            .eq("id", shipmentId)
            .single();

        expect(still?.reference).not.toBe("MEMBER-RENAMED");
      });

      it("the whole reproduction now fails at its first step", async () => {
        const { shipmentId, lineId } = await seedDraftShipment();
        await setStatus(shipmentId, "READY");

        // 1. reopen
        await memberClient
          .from("shipments")
          .update({ status: "DRAFT" })
          .eq("id", shipmentId);

        // 2. delete the approved line
        await memberClient
          .from("shipment_lines")
          .delete()
          .eq("id", lineId);

        // 3. re-approve
        await memberClient
          .from("shipments")
          .update({ status: "READY" })
          .eq("id", shipmentId);

        const { count } =
          await serviceClient
            .from("shipment_lines")
            .select("id", { count: "exact", head: true })
            .eq("shipment_id", shipmentId);

        expect(count).toBe(1);

        const { data: shipment } =
          await serviceClient
            .from("shipments")
            .select("status")
            .eq("id", shipmentId)
            .single();

        expect(shipment?.status).toBe("READY");
      });

      it("an ADMIN can still reopen -- the legitimate workflow is preserved", async () => {
        const { shipmentId, lineId } = await seedDraftShipment();
        await setStatus(shipmentId, "READY");

        const { data: reopened } =
          await adminClient
            .from("shipments")
            .update({ status: "DRAFT" })
            .eq("id", shipmentId)
            .select("status");

        expect(reopened).toEqual([{ status: "DRAFT" }]);

        // ...and the lines are editable again once it is DRAFT.
        const { error: deleteError } =
          await adminClient
            .from("shipment_lines")
            .delete()
            .eq("id", lineId);

        expect(deleteError).toBeNull();

        const { data: reapproved } =
          await adminClient
            .from("shipments")
            .update({ status: "READY" })
            .eq("id", shipmentId)
            .select("status");

        expect(reapproved).toEqual([{ status: "READY" }]);
      });
    });
  },
);

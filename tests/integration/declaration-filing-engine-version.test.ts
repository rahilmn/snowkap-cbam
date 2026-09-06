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

import {
  ENGINE_VERSION,
} from "../../src/domain/calculations/types";

// Standing suite for P14 owner decision 2: a filed declaration must
// never incorporate a calculation produced by a superseded engine.
//
// Reproduced before the gate existed: a calculation_results row
// carrying engine_version '1.2.0' -- the version whose unit guard
// tested the denominator with a substring match, so `tCO2e/kilotonne`
// computed at 1:1 and overstated by 1,000x -- filed with result OK. The
// filed snapshot recorded "1.2.0" faithfully. Provenance was honest and
// nothing gated on it.
//
// The gate reads the current version from app.engine_version rather
// than taking it as a parameter, because record_declaration_filed is
// granted to `authenticated` and directly callable -- a caller-supplied
// "current version" would let a member satisfy the gate by naming
// whatever version their stale result carries. The first test here is
// what keeps that database row honest.

const LOCAL_API_URL =
  process.env.SUPABASE_LOCAL_URL ??
  "http://127.0.0.1:54321";

const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

/** A version that is not the current one, whatever the current one is. */
const SUPERSEDED_VERSION = "1.2.0";

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
  "declaration filing requires the current engine version (P14, local Supabase only)",
  () => {
    const runId = crypto.randomUUID().slice(0, 8);
    const password = `engine-version-${runId}!`;

    const serviceClient: SupabaseClient =
      createClient(LOCAL_API_URL, LOCAL_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      });

    let orgId: string;
    let adminId: string;
    let adminClient: SupabaseClient;
    // 2026-09-06 (S5 cross-phase hardening): record_declaration_filed
    // now also refuses DATASET_SUPERSEDED for a DEFAULT determination
    // whose resolution.dataset_id doesn't name a currently-ACTIVE
    // regulatory_datasets row (20260906250000) -- fetched once, real,
    // so this file's own fixtures (which only ever cared about engine
    // version) keep passing that unrelated gate.
    let activeDatasetId: string;

    let nextYear = 2800;

    async function seedReadyShipment(engineVersion: string): Promise<{
      shipmentId: string;
      lineId: string;
      year: number;
    }> {
      const year = nextYear++;
      const determination = { method: "DEFAULT", marker: `y${year}`, resolution: { dataset_id: activeDatasetId } };

      const { data: shipment, error: shipmentError } =
        await serviceClient
          .from("shipments")
          .insert({
            org_id: orgId,
            reference: `ENGINE-${year}-${runId}`,
            release_date: `${year}-06-01`,
            reporting_period_kind: "ANNUAL",
            reporting_period_year: year,
            status: "DRAFT",
          })
          .select("id")
          .single();

      if (shipmentError || !shipment) {
        throw new Error(`shipment failed: ${shipmentError?.message}`);
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
            emission_determination: determination,
          })
          .select("id")
          .single();

      if (lineError || !line) {
        throw new Error(`line failed: ${lineError?.message}`);
      }

      const { error: resultError } =
        await serviceClient
          .from("calculation_results")
          .insert({
            org_id: orgId,
            line_id: line.id,
            shipment_id: shipment.id,
            engine_version: engineVersion,
            quantity: "1000",
            quantity_unit: "TONNES",
            determination,
            steps: [],
            embedded_emissions_tco2e: "2640",
            calculated_by_user_id: adminId,
          });

      if (resultError) {
        throw new Error(`calculation failed: ${resultError.message}`);
      }

      // Approved only once the lines exist -- a READY shipment's lines
      // are not editable (owner decision 1).
      const { error: readyError } =
        await serviceClient
          .from("shipments")
          .update({ status: "READY" })
          .eq("id", shipment.id);

      if (readyError) {
        throw new Error(`mark ready failed: ${readyError.message}`);
      }

      return {
        shipmentId: shipment.id as string,
        lineId: line.id as string,
        year,
      };
    }

    async function fileFor(options: {
      year: number;
      shipmentId: string;
      reference: string;
      supersedes?: string;
    }): Promise<{ declarationId: string; status: string }> {
      const { data: declaration, error } =
        await adminClient
          .from("declarations")
          .insert({
            org_id: orgId,
            reporting_period_kind: "ANNUAL",
            reporting_period_year: options.year,
            status: "DRAFT",
            member_shipment_ids: [options.shipmentId],
            created_by_user_id: adminId,
            supersedes_declaration_id: options.supersedes ?? null,
          })
          .select("id")
          .single();

      if (error || !declaration) {
        throw new Error(`declaration failed: ${error?.message}`);
      }

      const ready =
        await adminClient
          .from("declarations")
          .update({ status: "READY" })
          .eq("id", declaration.id);

      if (ready.error) {
        throw new Error(`mark ready failed: ${ready.error.message}`);
      }

      const { data, error: rpcError } =
        await adminClient.rpc("record_declaration_filed", {
          p_declaration_id: declaration.id,
          p_filed_reference: options.reference,
        });

      if (rpcError) {
        throw new Error(`rpc failed: ${rpcError.message}`);
      }

      return {
        declarationId: declaration.id as string,
        status: (data as { result_status: string }[])[0].result_status,
      };
    }

    beforeAll(async () => {
      const { data: activeDataset, error: activeDatasetError } =
        await serviceClient
          .from("regulatory_datasets")
          .select("id")
          .eq("dataset_type", "DEFAULT_EMISSION_VALUES")
          .eq("status", "ACTIVE")
          .single();

      if (activeDatasetError || !activeDataset) {
        throw new Error(
          `active regulatory dataset lookup failed: ${activeDatasetError?.message}`,
        );
      }

      activeDatasetId = activeDataset.id as string;

      const { data: org, error: orgError } =
        await serviceClient
          .from("organizations")
          .insert({
            name: `Engine Version ${runId}`,
            slug: `engine-version-${runId}`,
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
          email: `engine-version-admin-${runId}@example.com`,
          password,
          email_confirm: true,
        });

      if (userError || !user.user) {
        throw new Error(`user failed: ${userError?.message}`);
      }

      adminId = user.user.id;

      const { error: membershipError } =
        await serviceClient
          .from("memberships")
          .insert({ org_id: orgId, user_id: adminId, role: "ADMIN" });

      if (membershipError) {
        throw new Error(`membership failed: ${membershipError.message}`);
      }

      adminClient = createClient(LOCAL_API_URL, LOCAL_ANON_KEY, {
        auth: { persistSession: false },
      });

      const { error: signInError } =
        await adminClient.auth.signInWithPassword({
          email: `engine-version-admin-${runId}@example.com`,
          password,
        });

      if (signInError) {
        throw new Error(`sign in failed: ${signInError.message}`);
      }
    });

    afterAll(async () => {
      await serviceClient.from("calculation_results").delete().eq("org_id", orgId);
      await serviceClient.from("declarations").delete().eq("org_id", orgId);
      await serviceClient.from("shipment_lines").delete().eq("org_id", orgId);
      await serviceClient.from("shipments").delete().eq("org_id", orgId);
      await serviceClient.from("audit_events").delete().eq("org_id", orgId);
      await serviceClient.from("memberships").delete().eq("org_id", orgId);
      await serviceClient.from("organizations").delete().eq("id", orgId);

      if (adminId) {
        await serviceClient.auth.admin.deleteUser(adminId);
      }
    });

    it(
      "app.engine_version equals the application's ENGINE_VERSION -- the pin " +
        "that stops the filing gate silently comparing against a stale value " +
        "after a version bump forgets its migration",
      async () => {
        // Through public.current_engine_version() rather than the table:
        // the `app` schema is deliberately not exposed to PostgREST, so
        // the value the filing gate compares against cannot be written
        // from the API. A direct table read gets PGRST106.
        const { data, error } =
          await serviceClient.rpc("current_engine_version");

        expect(error).toBeNull();
        expect(data).toBe(ENGINE_VERSION);
      },
    );

    it("files a declaration whose calculations came from the current engine", async () => {
      const seeded = await seedReadyShipment(ENGINE_VERSION);

      const { status } = await fileFor({
        year: seeded.year,
        shipmentId: seeded.shipmentId,
        reference: `REF-CURRENT-${runId}`,
      });

      expect(status).toBe("OK");
    });

    it("refuses a declaration whose calculation came from a superseded engine", async () => {
      const seeded = await seedReadyShipment(SUPERSEDED_VERSION);

      const { status } = await fileFor({
        year: seeded.year,
        shipmentId: seeded.shipmentId,
        reference: `REF-STALE-${runId}`,
      });

      expect(status).toBe("CALCULATION_ENGINE_OUTDATED");
    });

    it(
      "recalculating clears the refusal, appends rather than rewrites, and " +
        "leaves the superseded result intact for provenance",
      async () => {
        const seeded = await seedReadyShipment(SUPERSEDED_VERSION);

        const refused = await fileFor({
          year: seeded.year,
          shipmentId: seeded.shipmentId,
          reference: `REF-BEFORE-RECALC-${runId}`,
        });

        expect(refused.status).toBe("CALCULATION_ENGINE_OUTDATED");

        // Recalculation goes through the trusted channel, which appends.
        const { data: determination } =
          await serviceClient
            .from("shipment_lines")
            .select("emission_determination")
            .eq("id", seeded.lineId)
            .single();

        const { data: recalculated, error: recalculateError } =
          await serviceClient.rpc("record_calculation_result", {
            p_org_id: orgId,
            p_line_id: seeded.lineId,
            p_calculated_by_user_id: adminId,
            p_engine_version: ENGINE_VERSION,
            p_parameter_datasets: [],
            p_quantity: "1000",
            p_quantity_unit: "TONNES",
            p_determination: determination?.emission_determination,
            p_steps: [],
            p_embedded_emissions_tco2e: "2640",
            p_correlation_id: null,
          });

        expect(recalculateError).toBeNull();
        expect(
          (recalculated as { result_status: string }[])[0].result_status,
        ).toBe("OK");

        // The declaration created above is already READY, so file a new
        // one for the same period would collide; reuse the existing one.
        const { data: existing } =
          await adminClient
            .from("declarations")
            .select("id")
            .eq("reporting_period_year", seeded.year)
            .single();

        const { data: filed } =
          await adminClient.rpc("record_declaration_filed", {
            p_declaration_id: existing?.id,
            p_filed_reference: `REF-AFTER-RECALC-${runId}`,
          });

        expect(
          (filed as { result_status: string }[])[0].result_status,
        ).toBe("OK");

        // Both results survive: append-only, and the superseded row is
        // the historical record of what was computed and when.
        const { data: rows } =
          await serviceClient
            .from("calculation_results")
            .select("engine_version")
            .eq("line_id", seeded.lineId);

        const versions =
          (rows ?? []).map((r) => (r as { engine_version: string }).engine_version).sort();

        expect(versions).toEqual([SUPERSEDED_VERSION, ENGINE_VERSION].sort());
      },
    );

    it("an amendment is held to the same rule -- it is a declaration and runs the same gate", async () => {
      const seeded = await seedReadyShipment(ENGINE_VERSION);

      const original = await fileFor({
        year: seeded.year,
        shipmentId: seeded.shipmentId,
        reference: `REF-AMEND-ORIGINAL-${runId}`,
      });

      expect(original.status).toBe("OK");

      // A later result from a superseded engine, appended after filing.
      const { data: determination } =
        await serviceClient
          .from("shipment_lines")
          .select("emission_determination")
          .eq("id", seeded.lineId)
          .single();

      const { error: staleError } =
        await serviceClient
          .from("calculation_results")
          .insert({
            org_id: orgId,
            line_id: seeded.lineId,
            shipment_id: seeded.shipmentId,
            engine_version: SUPERSEDED_VERSION,
            quantity: "1000",
            quantity_unit: "TONNES",
            determination: determination?.emission_determination,
            steps: [],
            embedded_emissions_tco2e: "2640",
            calculated_by_user_id: adminId,
          });

      expect(staleError).toBeNull();

      const amendment = await fileFor({
        year: seeded.year,
        shipmentId: seeded.shipmentId,
        reference: `REF-AMEND-${runId}`,
        supersedes: original.declarationId,
      });

      expect(amendment.status).toBe("CALCULATION_ENGINE_OUTDATED");
    });
  },
);

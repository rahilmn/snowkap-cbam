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

// Snowkap CBAM, S5 cross-phase hardening (2026-09-06).
// public.record_calculation_result's own SHIPMENT_NOT_EDITABLE gate
// (20260903190000_p141_calculation_results_trusted_write_only.sql) was
// never widened alongside 20260904090000_p14_ready_shipments_are_not_
// editable.sql, which made shipment_lines writes DRAFT-only for every
// role -- a Recalculate on a READY shipment could silently succeed and
// append a new "latest" calculation_results row, which both get-latest-
// calculations.ts and record_declaration_filed() pick up as authoritative
// with no reopen and no re-approval. Closed by 20260906210000. Real
// local Supabase, real service-role RPC call (the only channel that may
// write this table), not mocked.

const LOCAL_API_URL =
  process.env.SUPABASE_LOCAL_URL ??
  "http://127.0.0.1:54321";

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
  "record_calculation_result -- refuses a READY shipment, not only LOCKED/VOID (local Supabase only)",
  () => {
    const runId =
      crypto.randomUUID().slice(0, 8);

    const serviceClient: SupabaseClient =
      createClient(
        LOCAL_API_URL,
        LOCAL_SERVICE_ROLE_KEY,
        { auth: { persistSession: false } },
      );

    let orgId: string;
    let userId: string;
    let shipmentId: string;
    let lineId: string;

    const determination =
      {
        method: "DEFAULT",
        resolution: {
          dataset_version: "2026-definitive-corrected",
          values: { direct_specific: "1.5", indirect_specific: "0.2" },
          emission_unit: "tCO2e/t",
        },
      };

    beforeAll(async () => {
      const { data: org, error: orgError } =
        await serviceClient
          .from("organizations")
          .insert(
            {
              name: `S5 Calc READY Lock Test Org ${runId}`,
              slug: `s5-calc-ready-lock-test-org-${runId}`,
              capabilities: ["IMPORTER_DECLARANT"],
            },
          )
          .select("id")
          .single();

      if (orgError || !org) {
        throw new Error(
          `Failed to create org: ${orgError?.message}`,
        );
      }

      orgId = org.id;

      const { data: user, error: userError } =
        await serviceClient.auth.admin.createUser(
          {
            email: `s5-calc-ready-lock-${runId}@example.com`,
            password: `s5-calc-ready-lock-test-password-${runId}!`,
            email_confirm: true,
          },
        );

      if (userError || !user.user) {
        throw new Error(
          `Failed to create user: ${userError?.message}`,
        );
      }

      userId = user.user.id;

      const { error: membershipError } =
        await serviceClient
          .from("memberships")
          .insert(
            { org_id: orgId, user_id: userId, role: "MEMBER" },
          );

      if (membershipError) {
        throw new Error(
          `Failed to create membership: ${membershipError.message}`,
        );
      }

      const { data: shipment, error: shipmentError } =
        await serviceClient
          .from("shipments")
          .insert(
            {
              org_id: orgId,
              reference: `S5-CALC-READY-LOCK-${runId}`,
              release_date: "2026-01-01",
              reporting_period_kind: "ANNUAL",
              reporting_period_year: 2026,
              status: "DRAFT",
            },
          )
          .select("id")
          .single();

      if (shipmentError || !shipment) {
        throw new Error(
          `Failed to create shipment: ${shipmentError?.message}`,
        );
      }

      shipmentId = shipment.id;

      const { data: line, error: lineError } =
        await serviceClient
          .from("shipment_lines")
          .insert(
            {
              shipment_id: shipmentId,
              org_id: orgId,
              line_number: 1,
              cn_code: "72081000",
              cn_code_level: "CN8",
              origin_country: "DE",
              net_mass_tonnes: "10",
              emission_determination: determination,
            },
          )
          .select("id")
          .single();

      if (lineError || !line) {
        throw new Error(
          `Failed to create shipment line: ${lineError?.message}`,
        );
      }

      lineId = line.id;
    });

    afterAll(async () => {
      await serviceClient
        .from("calculation_results")
        .delete()
        .eq("line_id", lineId);

      await serviceClient
        .from("shipment_lines")
        .delete()
        .eq("id", lineId);

      await serviceClient
        .from("shipments")
        .delete()
        .eq("id", shipmentId);

      await serviceClient
        .from("memberships")
        .delete()
        .eq("org_id", orgId);

      await serviceClient
        .from("organizations")
        .delete()
        .eq("id", orgId);

      await serviceClient.auth.admin.deleteUser(
        userId,
      );
    });

    it(
      "records a calculation while the shipment is DRAFT",
      async () => {
        const { data, error } =
          await serviceClient.rpc(
            "record_calculation_result",
            {
              p_org_id: orgId,
              p_line_id: lineId,
              p_calculated_by_user_id: userId,
              p_engine_version: "1.3.0",
              p_parameter_datasets: [],
              p_quantity: "10",
              p_quantity_unit: "TONNES",
              p_determination: determination,
              p_steps: [],
              p_embedded_emissions_tco2e: "15.0",
              p_correlation_id: crypto.randomUUID(),
            },
          );

        expect(error).toBeNull();
        expect(data?.[0]?.result_status).toBe(
          "OK",
        );
      },
    );

    it(
      "refuses SHIPMENT_NOT_EDITABLE for the exact same, still-current inputs once the shipment is READY -- the recalculate bypass this migration closes",
      async () => {
        const { error: transitionError } =
          await serviceClient
            .from("shipments")
            .update(
              { status: "READY" },
            )
            .eq("id", shipmentId);

        if (transitionError) {
          throw new Error(
            `Failed to transition shipment to READY: ${transitionError.message}`,
          );
        }

        const { data, error } =
          await serviceClient.rpc(
            "record_calculation_result",
            {
              p_org_id: orgId,
              p_line_id: lineId,
              p_calculated_by_user_id: userId,
              p_engine_version: "1.3.0",
              p_parameter_datasets: [],
              p_quantity: "10",
              p_quantity_unit: "TONNES",
              p_determination: determination,
              p_steps: [],
              p_embedded_emissions_tco2e: "15.0",
              p_correlation_id: crypto.randomUUID(),
            },
          );

        expect(error).toBeNull();
        expect(data?.[0]?.result_status).toBe(
          "SHIPMENT_NOT_EDITABLE",
        );

        const { count } =
          await serviceClient
            .from("calculation_results")
            .select("id", { count: "exact", head: true })
            .eq("line_id", lineId);

        expect(count).toBe(
          1,
        );
      },
    );
  },
);

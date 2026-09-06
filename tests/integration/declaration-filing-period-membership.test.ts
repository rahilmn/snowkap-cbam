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

// Standing suite for the P14 remediation's declaration-membership fix
// (supabase/migrations/20260903220000_p14_filing_requires_period_complete_membership.sql).
//
// Three states were live-reproducible before it, every one returning OK
// from record_declaration_filed, and every one producing an immutable
// filed declaration that does not describe its own reporting period:
//
//   * a 2026 declaration whose only member was a 2027 shipment
//   * a 2026 declaration omitting one of the period's two READY
//     shipments -- filing 2640 tCO2e against a period holding 3960
//   * the same shipment frozen into two FILED_RECORDED declarations
//
// The second is the one that matters against this project's release
// boundary: a materially understated filed declaration produced by an
// administrator using the product as designed, bypassing nothing.
//
// The controls matter as much as the attacks here. This fix constrains
// the single most important write in the product, so the suite proves
// an honest filing, an amendment, and an amendment OF an amendment all
// still succeed -- a gate that also blocks legitimate filings would be
// a worse defect than the one it closes.

const LOCAL_API_URL =
  process.env.SUPABASE_LOCAL_URL ??
  "http://127.0.0.1:54321";

const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

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
  "declaration filing: membership must be the reporting period (P14, local Supabase only)",
  () => {
    const runId = crypto.randomUUID().slice(0, 8);
    const password = `declaration-period-${runId}!`;

    const serviceClient: SupabaseClient =
      createClient(LOCAL_API_URL, LOCAL_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      });

    let orgId: string;
    let adminId: string;
    let adminClient: SupabaseClient;
    let activeDatasetId: string;

    /** Each test gets its own year, so filings never collide. */
    let nextYear = 2400;

    async function seedReadyCalculatedShipment(
      year: number,
      reference: string,
      quantity: string,
      emissions: string,
    ): Promise<string> {
      const determination = {
        method: "DEFAULT",
        marker: reference,
        // 2026-09-06 (S5 cross-phase hardening): record_declaration_
        // filed now also refuses DATASET_SUPERSEDED for a DEFAULT
        // determination whose resolution.dataset_id doesn't name a
        // currently-ACTIVE regulatory_datasets row (20260906250000) --
        // fetched once in beforeAll, real, so this file's own fixtures
        // (which only ever cared about period-membership correctness)
        // keep passing that unrelated gate.
        resolution: { dataset_id: activeDatasetId },
      };

      const { data: shipment, error: shipmentError } =
        await serviceClient
          .from("shipments")
          .insert({
            org_id: orgId,
            reference,
            release_date: `${year}-06-01`,
            reporting_period_kind: "ANNUAL",
            reporting_period_year: year,
            // 2026-09-04 (P14 owner decision 1). Seeded DRAFT and
            // promoted below, once the line exists: a READY shipment's
            // lines are no longer editable, and a fixture that seeds
            // the end state directly is asserting against a shape the
            // product cannot produce.
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
            net_mass_tonnes: quantity,
            emission_determination: determination,
          })
          .select("id")
          .single();

      if (lineError || !line) {
        throw new Error(`seed line failed: ${lineError?.message}`);
      }

      const { error: resultError } =
        await serviceClient
          .from("calculation_results")
          .insert({
            org_id: orgId,
            line_id: line.id,
            shipment_id: shipment.id,
            engine_version: "1.4.0",
            quantity,
            quantity_unit: "TONNES",
            determination,
            steps: [],
            embedded_emissions_tco2e: emissions,
            calculated_by_user_id: adminId,
          });

      if (resultError) {
        throw new Error(`seed calculation failed: ${resultError.message}`);
      }

      const ready =
        await serviceClient
          .from("shipments")
          .update({ status: "READY" })
          .eq("id", shipment.id);

      if (ready.error) {
        throw new Error(`mark ready failed: ${ready.error.message}`);
      }

      return shipment.id as string;
    }

    async function fileDeclaration(options: {
      year: number;
      members: string[];
      reference: string;
      supersedes?: string;
    }): Promise<{ declarationId: string; resultStatus: string }> {
      const { data: declaration, error: declarationError } =
        await adminClient
          .from("declarations")
          .insert({
            org_id: orgId,
            reporting_period_kind: "ANNUAL",
            reporting_period_year: options.year,
            status: "DRAFT",
            member_shipment_ids: options.members,
            created_by_user_id: adminId,
            supersedes_declaration_id: options.supersedes ?? null,
          })
          .select("id")
          .single();

      if (declarationError || !declaration) {
        throw new Error(`declaration insert failed: ${declarationError?.message}`);
      }

      const ready =
        await adminClient
          .from("declarations")
          .update({ status: "READY" })
          .eq("id", declaration.id);

      if (ready.error) {
        throw new Error(`mark ready failed: ${ready.error.message}`);
      }

      const { data, error } =
        await adminClient.rpc("record_declaration_filed", {
          p_declaration_id: declaration.id,
          p_filed_reference: options.reference,
        });

      if (error) {
        throw new Error(`rpc failed: ${error.message}`);
      }

      return {
        declarationId: declaration.id as string,
        resultStatus: (data as { result_status: string }[])[0].result_status,
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
            name: `Declaration Period Membership ${runId}`,
            slug: `declaration-period-membership-${runId}`,
            capabilities: ["IMPORTER_DECLARANT"],
          })
          .select("id")
          .single();

      if (orgError || !org) {
        throw new Error(`org create failed: ${orgError?.message}`);
      }

      orgId = org.id as string;

      const { data: user, error: userError } =
        await serviceClient.auth.admin.createUser({
          email: `declaration-period-admin-${runId}@example.com`,
          password,
          email_confirm: true,
        });

      if (userError || !user.user) {
        throw new Error(`user create failed: ${userError?.message}`);
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
          email: `declaration-period-admin-${runId}@example.com`,
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
      "refuses a declaration whose member belongs to a different reporting period",
      async () => {
        const declarationYear = nextYear++;
        const otherYear = nextYear++;

        const foreign = await seedReadyCalculatedShipment(
          otherYear,
          `PERIOD-FOREIGN-${runId}`,
          "1000",
          "2640",
        );

        const { resultStatus } = await fileDeclaration({
          year: declarationYear,
          members: [foreign],
          reference: `REF-CROSS-${runId}`,
        });

        expect(resultStatus).toBe("MEMBERS_NOT_PERIOD_COMPLETE");
      },
    );

    it(
      "refuses a declaration that omits one of its period's shipments -- the " +
        "materially understated filing, produced by an administrator using the " +
        "product as designed",
      async () => {
        const year = nextYear++;

        const included = await seedReadyCalculatedShipment(
          year,
          `PERIOD-INCLUDED-${runId}`,
          "1000",
          "2640",
        );

        await seedReadyCalculatedShipment(
          year,
          `PERIOD-OMITTED-${runId}`,
          "500",
          "1320",
        );

        const { resultStatus } = await fileDeclaration({
          year,
          members: [included],
          reference: `REF-OMITS-${runId}`,
        });

        expect(resultStatus).toBe("MEMBERS_NOT_PERIOD_COMPLETE");
      },
    );

    it("files an honest, period-complete declaration", async () => {
      const year = nextYear++;

      const first = await seedReadyCalculatedShipment(
        year,
        `PERIOD-COMPLETE-A-${runId}`,
        "1000",
        "2640",
      );
      const second = await seedReadyCalculatedShipment(
        year,
        `PERIOD-COMPLETE-B-${runId}`,
        "500",
        "1320",
      );

      const { resultStatus } = await fileDeclaration({
        year,
        members: [first, second],
        reference: `REF-HONEST-${runId}`,
      });

      expect(resultStatus).toBe("OK");
    });

    it(
      "still files an amendment, and an amendment of that amendment -- the " +
        "supersede chain is walked transitively, so a correction to a " +
        "correction is not mistaken for a double filing",
      async () => {
        const year = nextYear++;

        const shipment = await seedReadyCalculatedShipment(
          year,
          `PERIOD-AMEND-${runId}`,
          "1000",
          "2640",
        );

        const original = await fileDeclaration({
          year,
          members: [shipment],
          reference: `REF-ORIGINAL-${runId}`,
        });

        expect(original.resultStatus).toBe("OK");

        const amendment = await fileDeclaration({
          year,
          members: [shipment],
          reference: `REF-AMENDMENT-${runId}`,
          supersedes: original.declarationId,
        });

        expect(amendment.resultStatus).toBe("OK");

        const amendmentOfAmendment = await fileDeclaration({
          year,
          members: [shipment],
          reference: `REF-AMENDMENT-2-${runId}`,
          supersedes: amendment.declarationId,
        });

        expect(amendmentOfAmendment.resultStatus).toBe("OK");
      },
    );

    it(
      "refuses a shipment already filed on an unrelated declaration -- defence " +
        "in depth behind declarations_period_original_uq, which already blocks " +
        "the same-period case, for the cross-period case a reporting-period " +
        "edit would otherwise open",
      async () => {
        const firstYear = nextYear++;
        const secondYear = nextYear++;

        const shipment = await seedReadyCalculatedShipment(
          firstYear,
          `PERIOD-DOUBLE-${runId}`,
          "1000",
          "2640",
        );

        const first = await fileDeclaration({
          year: firstYear,
          members: [shipment],
          reference: `REF-DOUBLE-FIRST-${runId}`,
        });

        expect(first.resultStatus).toBe("OK");

        // Move the (now LOCKED) shipment into another period with the
        // service role -- the product refuses this, since
        // shipments_update_own_org_not_terminal excludes LOCKED, so this
        // constructs the end state directly rather than pretending a
        // member could reach it today.
        const moved =
          await serviceClient
            .from("shipments")
            .update({ reporting_period_year: secondYear })
            .eq("id", shipment);

        expect(moved.error).toBeNull();

        const second = await fileDeclaration({
          year: secondYear,
          members: [shipment],
          reference: `REF-DOUBLE-SECOND-${runId}`,
        });

        expect(second.resultStatus).toBe("SHIPMENT_ALREADY_FILED");
      },
    );
  },
);

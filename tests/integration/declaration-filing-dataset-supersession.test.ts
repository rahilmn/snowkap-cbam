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
// record_declaration_filed() checks the current engine version
// (20260904100000) but, until this migration (20260906250000), never
// checked whether a DEFAULT determination's own regulatory dataset had
// since been SUPERSEDED -- the sanctioned way a regulatory correction
// is published (CLAUDE.md's own "facts-as-datasets" rule). Live-
// reproduced end to end, through this exact RPC, with real org OWNER
// credentials: a declaration built entirely on a since-corrected
// dataset filed with result OK, faithfully recording the superseded
// version in its own provenance, with nothing gating on it. Mirrors
// declaration-filing-engine-version.test.ts's own structure closely --
// this is the sibling gate, one layer down (dataset currency rather
// than engine currency).

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
  "record_declaration_filed refuses DATASET_SUPERSEDED (local Supabase only)",
  () => {
    const runId =
      crypto.randomUUID().slice(0, 8);

    const password =
      `dataset-supersession-${runId}!`;

    const serviceClient: SupabaseClient =
      createClient(
        LOCAL_API_URL,
        LOCAL_SERVICE_ROLE_KEY,
        { auth: { persistSession: false } },
      );

    let orgId: string;
    let ownerId: string;
    let ownerClient: SupabaseClient;
    let activeDatasetId: string;
    let activeDatasetVersion: string;

    async function seedReadyDeclaration(
      year: number,
      datasetId: string,
    ): Promise<{ shipmentId: string; lineId: string; declarationId: string }> {
      const determination =
        {
          method: "DEFAULT",
          resolution: { dataset_id: datasetId, dataset_version: activeDatasetVersion, reason: "EXACT_CN8_MATCH" },
        };

      const { data: shipment, error: shipmentError } =
        await serviceClient
          .from("shipments")
          .insert(
            {
              org_id: orgId,
              reference: `DATASET-${year}-${runId}`,
              release_date: `${year}-06-01`,
              reporting_period_kind: "ANNUAL",
              reporting_period_year: year,
              status: "DRAFT",
            },
          )
          .select("id")
          .single();

      if (shipmentError || !shipment) {
        throw new Error(
          `seed shipment failed: ${shipmentError?.message}`,
        );
      }

      const { data: line, error: lineError } =
        await serviceClient
          .from("shipment_lines")
          .insert(
            {
              shipment_id: shipment.id,
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
          `seed line failed: ${lineError?.message}`,
        );
      }

      const { data: engineVersionRow, error: engineVersionError } =
        await serviceClient.rpc(
          "current_engine_version",
        );

      if (engineVersionError) {
        throw new Error(
          `current_engine_version rpc failed: ${engineVersionError.message}`,
        );
      }

      const { error: calcError } =
        await serviceClient
          .from("calculation_results")
          .insert(
            {
              org_id: orgId,
              line_id: line.id,
              shipment_id: shipment.id,
              engine_version: engineVersionRow as unknown as string,
              quantity: "10",
              quantity_unit: "TONNES",
              determination,
              steps: [],
              embedded_emissions_tco2e: "15.0",
              calculated_by_user_id: ownerId,
            },
          );

      if (calcError) {
        throw new Error(
          `seed calculation failed: ${calcError.message}`,
        );
      }

      const { error: readyError } =
        await serviceClient
          .from("shipments")
          .update(
            { status: "READY" },
          )
          .eq("id", shipment.id);

      if (readyError) {
        throw new Error(
          `mark ready failed: ${readyError.message}`,
        );
      }

      const { data: declaration, error: declarationError } =
        await ownerClient
          .from("declarations")
          .insert(
            {
              org_id: orgId,
              reporting_period_kind: "ANNUAL",
              reporting_period_year: year,
              status: "DRAFT",
              member_shipment_ids: [shipment.id],
              created_by_user_id: ownerId,
            },
          )
          .select("id")
          .single();

      if (declarationError || !declaration) {
        throw new Error(
          `seed declaration failed: ${declarationError?.message}`,
        );
      }

      const { error: declReadyError } =
        await ownerClient
          .from("declarations")
          .update(
            { status: "READY" },
          )
          .eq("id", declaration.id);

      if (declReadyError) {
        throw new Error(
          `mark declaration ready failed: ${declReadyError.message}`,
        );
      }

      return {
        shipmentId: shipment.id as string,
        lineId: line.id as string,
        declarationId: declaration.id as string,
      };
    }

    beforeAll(async () => {
      const { data: activeDataset, error: activeDatasetError } =
        await serviceClient
          .from("regulatory_datasets")
          .select("id, version")
          .eq("dataset_type", "DEFAULT_EMISSION_VALUES")
          .eq("status", "ACTIVE")
          .single();

      if (activeDatasetError || !activeDataset) {
        throw new Error(
          `active regulatory dataset lookup failed: ${activeDatasetError?.message}`,
        );
      }

      activeDatasetId = activeDataset.id as string;
      activeDatasetVersion = activeDataset.version as string;

      const { data: org, error: orgError } =
        await serviceClient
          .from("organizations")
          .insert(
            {
              name: `S5 Dataset Supersession ${runId}`,
              slug: `s5-dataset-supersession-${runId}`,
              capabilities: ["IMPORTER_DECLARANT"],
            },
          )
          .select("id")
          .single();

      if (orgError || !org) {
        throw new Error(
          `org failed: ${orgError?.message}`,
        );
      }

      orgId = org.id as string;

      const { data: user, error: userError } =
        await serviceClient.auth.admin.createUser(
          {
            email: `s5-dataset-supersession-owner-${runId}@example.com`,
            password,
            email_confirm: true,
          },
        );

      if (userError || !user.user) {
        throw new Error(
          `user failed: ${userError?.message}`,
        );
      }

      ownerId = user.user.id;

      const { error: membershipError } =
        await serviceClient
          .from("memberships")
          .insert(
            { org_id: orgId, user_id: ownerId, role: "OWNER" },
          );

      if (membershipError) {
        throw new Error(
          `membership failed: ${membershipError.message}`,
        );
      }

      ownerClient =
        createClient(
          LOCAL_API_URL,
          LOCAL_ANON_KEY,
          { auth: { persistSession: false } },
        );

      const { error: signInError } =
        await ownerClient.auth.signInWithPassword(
          {
            email: `s5-dataset-supersession-owner-${runId}@example.com`,
            password,
          },
        );

      if (signInError) {
        throw new Error(
          `sign in failed: ${signInError.message}`,
        );
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

      if (ownerId) {
        await serviceClient.auth.admin.deleteUser(
          ownerId,
        );
      }
    });

    it(
      "files normally against the currently-ACTIVE dataset",
      async () => {
        const seeded =
          await seedReadyDeclaration(
            2701,
            activeDatasetId,
          );

        const { data, error } =
          await ownerClient.rpc(
            "record_declaration_filed",
            {
              p_declaration_id: seeded.declarationId,
              p_filed_reference: `REF-DATASET-OK-${runId}`,
            },
          );

        expect(error).toBeNull();

        expect(
          (data as { result_status: string }[])[0]?.result_status,
        ).toBe(
          "OK",
        );
      },
    );

    it(
      "refuses DATASET_SUPERSEDED once the referenced regulatory dataset is no longer ACTIVE -- the exact live-reproduced S5 finding",
      async () => {
        const seeded =
          await seedReadyDeclaration(
            2702,
            activeDatasetId,
          );

        // The regulatory correction: mark the dataset this line's
        // determination was resolved against as no longer ACTIVE.
        const { error: supersedeError } =
          await serviceClient
            .from("regulatory_datasets")
            .update(
              { status: "SUPERSEDED" },
            )
            .eq("id", activeDatasetId);

        if (supersedeError) {
          throw new Error(
            `Failed to supersede the dataset: ${supersedeError.message}`,
          );
        }

        try {
          const { data, error } =
            await ownerClient.rpc(
              "record_declaration_filed",
              {
                p_declaration_id: seeded.declarationId,
                p_filed_reference: `REF-DATASET-SUPERSEDED-${runId}`,
              },
            );

          expect(error).toBeNull();

          expect(
            (data as { result_status: string }[])[0]?.result_status,
          ).toBe(
            "DATASET_SUPERSEDED",
          );

          const { data: declaration } =
            await serviceClient
              .from("declarations")
              .select("status")
              .eq("id", seeded.declarationId)
              .single();

          // Correctly refused, not silently filed.
          expect(declaration?.status).toBe(
            "READY",
          );
        } finally {
          // Restore the dataset to ACTIVE, whatever happened above, so
          // this test's own side effect never leaks into a sibling
          // test file sharing this local database.
          await serviceClient
            .from("regulatory_datasets")
            .update(
              { status: "ACTIVE" },
            )
            .eq("id", activeDatasetId);
        }
      },
    );

    it(
      "never applies to an ACTUAL determination -- no regulatory dataset is resolved for one",
      async () => {
        const { data: shipment, error: shipmentError } =
          await serviceClient
            .from("shipments")
            .insert(
              {
                org_id: orgId,
                reference: `DATASET-ACTUAL-${runId}`,
                release_date: "2703-06-01",
                reporting_period_kind: "ANNUAL",
                reporting_period_year: 2703,
                status: "DRAFT",
              },
            )
            .select("id")
            .single();

        if (shipmentError || !shipment) {
          throw new Error(
            `seed shipment failed: ${shipmentError?.message}`,
          );
        }

        const actualDetermination =
          {
            method: "ACTUAL",
            snapshot: {
              emission_data_id: crypto.randomUUID(),
              emission_data_version: 1,
              installation_id: crypto.randomUUID(),
              resolved_at: new Date(0).toISOString(),
              values: { direct_specific: "1.0", indirect_specific: "0.5" },
              emission_unit: "tCO2e/t",
              methodology: "EU_METHOD",
              verification: { status: "VERIFIED", verifier_user_id: ownerId },
              evidence_file_ids: [],
              sharing_grant_id: null,
              record_provenance: "OPERATOR_PROVIDED",
              dataset_reporting_period: { kind: "ANNUAL", year: 2703, quarter: null },
              declaration_context: null,
              precursors: [],
            },
          };

        const { data: line, error: lineError } =
          await serviceClient
            .from("shipment_lines")
            .insert(
              {
                shipment_id: shipment.id,
                org_id: orgId,
                line_number: 1,
                cn_code: "72081000",
                cn_code_level: "CN8",
                origin_country: "DE",
                net_mass_tonnes: "10",
                emission_determination: actualDetermination,
              },
            )
            .select("id")
            .single();

        if (lineError || !line) {
          throw new Error(
            `seed line failed: ${lineError?.message}`,
          );
        }

        const { data: engineVersionRow } =
          await serviceClient.rpc(
            "current_engine_version",
          );

        const { error: calcError } =
          await serviceClient
            .from("calculation_results")
            .insert(
              {
                org_id: orgId,
                line_id: line.id,
                shipment_id: shipment.id,
                engine_version: engineVersionRow as unknown as string,
                quantity: "10",
                quantity_unit: "TONNES",
                determination: actualDetermination,
                steps: [],
                embedded_emissions_tco2e: "15.0",
                calculated_by_user_id: ownerId,
              },
            );

        if (calcError) {
          throw new Error(
            `seed calculation failed: ${calcError.message}`,
          );
        }

        await serviceClient
          .from("shipments")
          .update(
            { status: "READY" },
          )
          .eq("id", shipment.id);

        const { data: declaration, error: declarationError } =
          await ownerClient
            .from("declarations")
            .insert(
              {
                org_id: orgId,
                reporting_period_kind: "ANNUAL",
                reporting_period_year: 2703,
                status: "DRAFT",
                member_shipment_ids: [shipment.id],
                created_by_user_id: ownerId,
              },
            )
            .select("id")
            .single();

        if (declarationError || !declaration) {
          throw new Error(
            `seed declaration failed: ${declarationError?.message}`,
          );
        }

        await ownerClient
          .from("declarations")
          .update(
            { status: "READY" },
          )
          .eq("id", declaration.id);

        const { data, error } =
          await ownerClient.rpc(
            "record_declaration_filed",
            {
              p_declaration_id: declaration.id,
              p_filed_reference: `REF-DATASET-ACTUAL-${runId}`,
            },
          );

        expect(error).toBeNull();

        // Not DATASET_SUPERSEDED -- an ACTUAL determination resolves no
        // regulatory dataset, so this check must never fire for it.
        // (May legitimately be REJECTED for an unrelated reason --
        // this fixture's ACTUAL snapshot is not byte-real -- but it
        // must never be DATASET_SUPERSEDED specifically.)
        expect(
          (data as { result_status: string }[])[0]?.result_status,
        ).not.toBe(
          "DATASET_SUPERSEDED",
        );
      },
    );
  },
);

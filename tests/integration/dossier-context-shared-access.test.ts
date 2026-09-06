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

// Snowkap CBAM SME Experience v2.1.1, S4: proves
// emission_data_declaration_context_select_shared /
// emission_data_precursors_select_shared
// (20260906190000_s4_widen_dossier_select_for_grantee.sql) actually
// admit a grantee's read of a shared installation's ACTIVE+VERIFIED
// record's dossier, and fail closed for everything else -- the exact
// RLS surface determine-from-actual-data.ts's context-freezing step
// depends on. Real local Supabase, real auth users, real cross-tenant
// proof, not mocked. Structurally mirrors
// declaration-context-and-precursors-isolation.test.ts's own fixture
// setup (this session's own Slice 1 test) plus a sharing_grants row,
// the one thing that test didn't need.

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
  "emission_data_declaration_context / emission_data_precursors -- SELECT widened for a sharing-grant grantee (local Supabase only)",
  () => {
    const runId =
      crypto.randomUUID().slice(
        0,
        8,
      );

    const serviceClient: SupabaseClient =
      createClient(
        LOCAL_API_URL,
        LOCAL_SERVICE_ROLE_KEY,
        { auth: { persistSession: false } },
      );

    let producerOrgId: string;
    let granteeOrgId: string;
    let strangerOrgId: string;
    let producerUserId: string;
    let granteeUserId: string;
    let strangerUserId: string;
    let installationId: string;
    let activeVerifiedEmissionDataId: string;
    let draftUnverifiedEmissionDataId: string;

    let granteeClient: SupabaseClient;
    let strangerClient: SupabaseClient;

    async function signInAnonClient(
      email: string,
      password: string,
    ): Promise<SupabaseClient> {
      const client =
        createClient(
          LOCAL_API_URL,
          LOCAL_ANON_KEY,
          { auth: { persistSession: false } },
        );

      const { error } =
        await client.auth.signInWithPassword(
          { email, password },
        );

      if (error) {
        throw new Error(
          `Failed to sign in ${email}: ${error.message}`,
        );
      }

      return client;
    }

    beforeAll(async () => {
      async function createOrg(
        label: string,
        capabilities: string[],
      ): Promise<string> {
        const { data, error } =
          await serviceClient
            .from("organizations")
            .insert(
              {
                name: `S4 Shared Dossier Test ${label} ${runId}`,
                slug: `s4-shared-dossier-${label.toLowerCase()}-${runId}`,
                capabilities,
              },
            )
            .select("id")
            .single();

        if (error || !data) {
          throw new Error(
            `Failed to create org ${label}: ${error?.message}`,
          );
        }

        return data.id;
      }

      producerOrgId =
        await createOrg(
          "Producer",
          ["PRODUCER_OPERATOR"],
        );

      granteeOrgId =
        await createOrg(
          "Grantee",
          ["IMPORTER_DECLARANT"],
        );

      strangerOrgId =
        await createOrg(
          "Stranger",
          ["IMPORTER_DECLARANT"],
        );

      const password =
        `s4-shared-dossier-test-password-${runId}!`;

      async function createUser(
        label: string,
      ): Promise<string> {
        const { data, error } =
          await serviceClient.auth.admin.createUser(
            {
              email: `s4-shared-dossier-${label}-${runId}@example.com`,
              password,
              email_confirm: true,
            },
          );

        if (error || !data.user) {
          throw new Error(
            `Failed to create user ${label}: ${error?.message}`,
          );
        }

        return data.user.id;
      }

      producerUserId =
        await createUser(
          "producer",
        );

      granteeUserId =
        await createUser(
          "grantee",
        );

      strangerUserId =
        await createUser(
          "stranger",
        );

      const { error: membershipError } =
        await serviceClient
          .from("memberships")
          .insert(
            [
              { org_id: producerOrgId, user_id: producerUserId, role: "OWNER" },
              { org_id: granteeOrgId, user_id: granteeUserId, role: "MEMBER" },
              { org_id: strangerOrgId, user_id: strangerUserId, role: "MEMBER" },
            ],
          );

      if (membershipError) {
        throw new Error(
          `Failed to create memberships: ${membershipError.message}`,
        );
      }

      granteeClient =
        await signInAnonClient(
          `s4-shared-dossier-grantee-${runId}@example.com`,
          password,
        );

      strangerClient =
        await signInAnonClient(
          `s4-shared-dossier-stranger-${runId}@example.com`,
          password,
        );

      const { data: operator, error: operatorError } =
        await serviceClient
          .from("operators")
          .insert(
            {
              org_id: producerOrgId,
              provenance: "OPERATOR_PROVIDED",
              name: `S4 Shared Dossier Test Operator ${runId}`,
              country: "DE",
            },
          )
          .select("id")
          .single();

      if (operatorError || !operator) {
        throw new Error(
          `Failed to create operator: ${operatorError?.message}`,
        );
      }

      const { data: installation, error: installationError } =
        await serviceClient
          .from("installations")
          .insert(
            {
              operator_id: operator.id,
              org_id: producerOrgId,
              provenance: "OPERATOR_PROVIDED",
              name: `S4 Shared Dossier Test Installation ${runId}`,
              country: "DE",
            },
          )
          .select("id")
          .single();

      if (installationError || !installation) {
        throw new Error(
          `Failed to create installation: ${installationError?.message}`,
        );
      }

      installationId = installation.id;

      async function createEmissionData(
        reportingPeriodYear: number,
        status: string,
        verificationStatus: string,
      ): Promise<string> {
        const { data, error } =
          await serviceClient
            .from("emission_data")
            .insert(
              {
                installation_id: installationId,
                entered_by_org_id: producerOrgId,
                cn_scope: ["25232100"],
                reporting_period_kind: "ANNUAL",
                // Distinct reporting_period_year per row -- cn_scope is
                // deliberately NOT part of the (installation_id, period,
                // version) lineage-uniqueness key (emission_data_version_uq;
                // see manage-emission-data.ts's own comment), so two
                // otherwise-identical rows for the same installation/
                // period/version collide even with different cn_scope
                // and different status.
                reporting_period_year: reportingPeriodYear,
                direct_specific: "1.0",
                indirect_specific: "0.5",
                emission_unit: "tCO2e/t",
                methodology: "EU_METHOD",
                status,
                verification_status: verificationStatus,
                verifier_user_id: verificationStatus === "VERIFIED" ? producerUserId : null,
                version: 1,
              },
            )
            .select("id")
            .single();

        if (error || !data) {
          throw new Error(
            `Failed to create emission_data (${status}/${verificationStatus}): ${error?.message}`,
          );
        }

        return data.id;
      }

      activeVerifiedEmissionDataId =
        await createEmissionData(
          2026,
          "ACTIVE",
          "VERIFIED",
        );

      draftUnverifiedEmissionDataId =
        await createEmissionData(
          2025,
          "DRAFT",
          "UNVERIFIED",
        );

      for (
        const emissionDataId of [activeVerifiedEmissionDataId, draftUnverifiedEmissionDataId]
      ) {
        const { error: contextError } =
          await serviceClient
            .from("emission_data_declaration_context")
            .insert(
              {
                org_id: producerOrgId,
                emission_data_id: emissionDataId,
                production_process_description: "Kiln-fired at 900C",
                verifier_report_declared: true,
                verifier_report_description: "TUV Rheinland, 2026-02",
              },
            );

        if (contextError) {
          throw new Error(
            `Failed to create declaration context for ${emissionDataId}: ${contextError.message}`,
          );
        }

        const { error: precursorError } =
          await serviceClient
            .from("emission_data_precursors")
            .insert(
              {
                org_id: producerOrgId,
                emission_data_id: emissionDataId,
                material_description: "Clinker, purchased",
                provenance: "ACTUAL_NO_DECLARED_REPORT",
              },
            );

        if (precursorError) {
          throw new Error(
            `Failed to create precursor for ${emissionDataId}: ${precursorError.message}`,
          );
        }
      }

      const { error: grantError } =
        await serviceClient
          .from("sharing_grants")
          .insert(
            {
              grantor_org_id: producerOrgId,
              grantee_org_id: granteeOrgId,
              installation_id: installationId,
              created_by_user_id: producerUserId,
              status: "ACTIVE",
            },
          );

      if (grantError) {
        throw new Error(
          `Failed to create sharing grant: ${grantError.message}`,
        );
      }
    });

    afterAll(async () => {
      await serviceClient
        .from("sharing_grants")
        .delete()
        .eq(
          "installation_id",
          installationId,
        );

      await serviceClient
        .from("emission_data_precursors")
        .delete()
        .in(
          "emission_data_id",
          [activeVerifiedEmissionDataId, draftUnverifiedEmissionDataId],
        );

      await serviceClient
        .from("emission_data_declaration_context")
        .delete()
        .in(
          "emission_data_id",
          [activeVerifiedEmissionDataId, draftUnverifiedEmissionDataId],
        );

      await serviceClient
        .from("emission_data")
        .delete()
        .in(
          "id",
          [activeVerifiedEmissionDataId, draftUnverifiedEmissionDataId],
        );

      await serviceClient
        .from("installations")
        .delete()
        .eq(
          "id",
          installationId,
        );

      await serviceClient
        .from("memberships")
        .delete()
        .in(
          "org_id",
          [producerOrgId, granteeOrgId, strangerOrgId],
        );

      await serviceClient
        .from("organizations")
        .delete()
        .in(
          "id",
          [producerOrgId, granteeOrgId, strangerOrgId],
        );

      for (
        const userId of [producerUserId, granteeUserId, strangerUserId]
      ) {
        await serviceClient.auth.admin.deleteUser(
          userId,
        );
      }
    });

    it(
      "a grantee CAN read the declaration context of the shared installation's ACTIVE+VERIFIED record",
      async () => {
        const { data, error } =
          await granteeClient
            .from("emission_data_declaration_context")
            .select(
              "production_process_description",
            )
            .eq(
              "emission_data_id",
              activeVerifiedEmissionDataId,
            )
            .maybeSingle();

        expect(error).toBeNull();
        expect(data?.production_process_description).toBe(
          "Kiln-fired at 900C",
        );
      },
    );

    it(
      "a grantee CAN read the precursors of the shared installation's ACTIVE+VERIFIED record",
      async () => {
        const { data, error } =
          await granteeClient
            .from("emission_data_precursors")
            .select(
              "material_description",
            )
            .eq(
              "emission_data_id",
              activeVerifiedEmissionDataId,
            );

        expect(error).toBeNull();
        expect(data).toEqual(
          [{ material_description: "Clinker, purchased" }],
        );
      },
    );

    it(
      "a grantee CANNOT read the declaration context of the same installation's DRAFT+UNVERIFIED record -- fails closed, not merely 'not yet shared'",
      async () => {
        const { data, error } =
          await granteeClient
            .from("emission_data_declaration_context")
            .select(
              "production_process_description",
            )
            .eq(
              "emission_data_id",
              draftUnverifiedEmissionDataId,
            )
            .maybeSingle();

        expect(error).toBeNull();
        expect(data).toBeNull();
      },
    );

    it(
      "a grantee CANNOT read the precursors of the same installation's DRAFT+UNVERIFIED record",
      async () => {
        const { data, error } =
          await granteeClient
            .from("emission_data_precursors")
            .select(
              "material_description",
            )
            .eq(
              "emission_data_id",
              draftUnverifiedEmissionDataId,
            );

        expect(error).toBeNull();
        expect(data).toEqual(
          [],
        );
      },
    );

    it(
      "a stranger org with no sharing grant at all CANNOT read either record's context, even the ACTIVE+VERIFIED one",
      async () => {
        const { data, error } =
          await strangerClient
            .from("emission_data_declaration_context")
            .select(
              "production_process_description",
            )
            .eq(
              "emission_data_id",
              activeVerifiedEmissionDataId,
            )
            .maybeSingle();

        expect(error).toBeNull();
        expect(data).toBeNull();
      },
    );

    it(
      "a stranger org with no sharing grant at all CANNOT read either record's precursors",
      async () => {
        const { data, error } =
          await strangerClient
            .from("emission_data_precursors")
            .select(
              "material_description",
            )
            .eq(
              "emission_data_id",
              activeVerifiedEmissionDataId,
            );

        expect(error).toBeNull();
        expect(data).toEqual(
          [],
        );
      },
    );

    it(
      "a grantee still cannot WRITE to a shared record's context -- the widened policy is read-only",
      async () => {
        const { data, error } =
          await granteeClient
            .from("emission_data_declaration_context")
            .update(
              { production_process_description: "Tampered by grantee" },
            )
            .eq(
              "emission_data_id",
              activeVerifiedEmissionDataId,
            )
            .select(
              "id",
            );

        expect(error).toBeNull();
        expect(data).toEqual(
          [],
        );

        const { data: unchanged } =
          await serviceClient
            .from("emission_data_declaration_context")
            .select(
              "production_process_description",
            )
            .eq(
              "emission_data_id",
              activeVerifiedEmissionDataId,
            )
            .single();

        expect(unchanged?.production_process_description).toBe(
          "Kiln-fired at 900C",
        );
      },
    );
  },
);

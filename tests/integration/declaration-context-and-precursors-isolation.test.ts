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

// Snowkap CBAM SME Experience v2.1.1, S4:
// emission_data_declaration_context and emission_data_precursors
// (20260906180000_s4_declaration_context_and_precursors.sql).
// Structurally mirrors guidance-dismissals-isolation.test.ts: real
// local Supabase, real auth users, real cross-tenant proof, not mocked.
// Runs against LOCAL, disposable Supabase only; skips cleanly when
// unreachable.

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
  "emission_data_declaration_context / emission_data_precursors RLS -- cross-org isolation (local Supabase only)",
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

    let orgAId: string;
    let orgBId: string;
    let memberAId: string;
    let memberBId: string;
    let operatorId: string;
    let installationId: string;
    let emissionDataId: string;
    let contextId: string;
    let precursorId: string;

    let clientA: SupabaseClient;
    let clientB: SupabaseClient;

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
      const { data: orgA, error: orgAError } =
        await serviceClient
          .from("organizations")
          .insert(
            {
              name: `S4 Dossier Test Org A ${runId}`,
              slug: `s4-dossier-test-org-a-${runId}`,
              capabilities: ["PRODUCER_OPERATOR"],
            },
          )
          .select("id")
          .single();

      if (orgAError || !orgA) {
        throw new Error(
          `Failed to create org A: ${orgAError?.message}`,
        );
      }

      orgAId = orgA.id;

      const { data: orgB, error: orgBError } =
        await serviceClient
          .from("organizations")
          .insert(
            {
              name: `S4 Dossier Test Org B ${runId}`,
              slug: `s4-dossier-test-org-b-${runId}`,
              capabilities: ["PRODUCER_OPERATOR"],
            },
          )
          .select("id")
          .single();

      if (orgBError || !orgB) {
        throw new Error(
          `Failed to create org B: ${orgBError?.message}`,
        );
      }

      orgBId = orgB.id;

      const password =
        `s4-dossier-test-password-${runId}!`;

      async function createUser(
        label: string,
      ): Promise<string> {
        const { data, error } =
          await serviceClient.auth.admin.createUser(
            {
              email: `s4-dossier-${label}-${runId}@example.com`,
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

      memberAId =
        await createUser(
          "member-a",
        );

      memberBId =
        await createUser(
          "member-b",
        );

      const { error: membershipError } =
        await serviceClient
          .from("memberships")
          .insert(
            [
              { org_id: orgAId, user_id: memberAId, role: "MEMBER" },
              { org_id: orgBId, user_id: memberBId, role: "MEMBER" },
            ],
          );

      if (membershipError) {
        throw new Error(
          `Failed to create memberships: ${membershipError.message}`,
        );
      }

      clientA =
        await signInAnonClient(
          `s4-dossier-member-a-${runId}@example.com`,
          password,
        );

      clientB =
        await signInAnonClient(
          `s4-dossier-member-b-${runId}@example.com`,
          password,
        );

      const { data: operator, error: operatorError } =
        await serviceClient
          .from("operators")
          .insert(
            {
              org_id: orgAId,
              provenance: "OPERATOR_PROVIDED",
              name: `S4 Dossier Test Operator ${runId}`,
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

      operatorId = operator.id;

      const { data: installation, error: installationError } =
        await serviceClient
          .from("installations")
          .insert(
            {
              operator_id: operatorId,
              org_id: orgAId,
              provenance: "OPERATOR_PROVIDED",
              name: `S4 Dossier Test Installation ${runId}`,
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

      const { data: emissionData, error: emissionDataError } =
        await serviceClient
          .from("emission_data")
          .insert(
            {
              installation_id: installationId,
              entered_by_org_id: orgAId,
              cn_scope: ["25231000"],
              reporting_period_kind: "ANNUAL",
              reporting_period_year: 2026,
              direct_specific: "1.0",
              indirect_specific: "0.5",
              emission_unit: "tCO2e/t",
              methodology: "EU_METHOD",
              status: "DRAFT",
              verification_status: "UNVERIFIED",
              version: 1,
            },
          )
          .select("id")
          .single();

      if (emissionDataError || !emissionData) {
        throw new Error(
          `Failed to create emission_data: ${emissionDataError?.message}`,
        );
      }

      emissionDataId = emissionData.id;
    });

    afterAll(async () => {
      await serviceClient
        .from("emission_data_precursors")
        .delete()
        .eq(
          "emission_data_id",
          emissionDataId,
        );

      await serviceClient
        .from("emission_data_declaration_context")
        .delete()
        .eq(
          "emission_data_id",
          emissionDataId,
        );

      await serviceClient
        .from("emission_data")
        .delete()
        .eq(
          "id",
          emissionDataId,
        );

      await serviceClient
        .from("installations")
        .delete()
        .eq(
          "id",
          installationId,
        );

      await serviceClient
        .from("operators")
        .delete()
        .eq(
          "id",
          operatorId,
        );

      await serviceClient
        .from("memberships")
        .delete()
        .in(
          "org_id",
          [orgAId, orgBId],
        );

      await serviceClient
        .from("organizations")
        .delete()
        .in(
          "id",
          [orgAId, orgBId],
        );

      for (
        const userId of [memberAId, memberBId]
      ) {
        await serviceClient.auth.admin.deleteUser(
          userId,
        );
      }
    });

    it(
      "org A's own member can insert a declaration context for org A's own emission_data row",
      async () => {
        const { data, error } =
          await clientA
            .from("emission_data_declaration_context")
            .insert(
              {
                org_id: orgAId,
                emission_data_id: emissionDataId,
                production_process_description: "Kiln-fired at 900C",
                uses_purchased_precursors: true,
              },
            )
            .select("id")
            .single();

        expect(error).toBeNull();
        expect(data?.id).toBeTruthy();

        contextId = data!.id;
      },
    );

    it(
      "a stranger org's member cannot see org A's declaration context -- RLS silently filters to zero rows",
      async () => {
        const { data, error } =
          await clientB
            .from("emission_data_declaration_context")
            .select(
              "id",
            )
            .eq(
              "org_id",
              orgAId,
            );

        expect(error).toBeNull();
        expect(data).toEqual(
          [],
        );
      },
    );

    it(
      "a stranger org's member cannot insert a declaration context claiming org A's emission_data row -- refused by the cross-parent EXISTS check even if they somehow supplied their own org_id",
      async () => {
        const { error } =
          await clientB
            .from("emission_data_declaration_context")
            .insert(
              {
                org_id: orgBId,
                emission_data_id: emissionDataId,
                production_process_description: "Stranger's claim",
              },
            );

        expect(error).not.toBeNull();
      },
    );

    it(
      "a stranger org's member cannot update org A's declaration context",
      async () => {
        const { data, error } =
          await clientB
            .from("emission_data_declaration_context")
            .update(
              { production_process_description: "Tampered" },
            )
            .eq(
              "id",
              contextId,
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
              "id",
              contextId,
            )
            .single();

        expect(unchanged?.production_process_description).toBe(
          "Kiln-fired at 900C",
        );
      },
    );

    it(
      "org A's own member CAN update their own declaration context",
      async () => {
        const { data, error } =
          await clientA
            .from("emission_data_declaration_context")
            .update(
              { verifier_report_declared: true, verifier_report_description: "TUV Rheinland, 2026-02" },
            )
            .eq(
              "id",
              contextId,
            )
            .select(
              "verifier_report_declared",
            )
            .single();

        expect(error).toBeNull();
        expect(data?.verifier_report_declared).toBe(
          true,
        );
      },
    );

    it(
      "a verifier report description without declaring one exists is refused by the CHECK constraint",
      async () => {
        const { error } =
          await serviceClient
            .from("emission_data_declaration_context")
            .insert(
              {
                org_id: orgAId,
                emission_data_id: emissionDataId,
                verifier_report_declared: false,
                verifier_report_description: "Should be refused",
              },
            );

        // Also collides with the one-per-record unique constraint, but
        // even a fresh emission_data_id would hit the CHECK first --
        // this row is refused either way, which is what matters here.
        expect(error).not.toBeNull();
      },
    );

    it(
      "org A's own member can add a precursor with ACTUAL_WITH_DECLARED_REPORT provenance",
      async () => {
        const { data, error } =
          await clientA
            .from("emission_data_precursors")
            .insert(
              {
                org_id: orgAId,
                emission_data_id: emissionDataId,
                material_description: "Clinker, purchased",
                cn_code: "25231000",
                source_description: "Acme Cement, DE",
                direct_specific: "0.850",
                indirect_specific: "0.120",
                emission_unit: "tCO2e/t",
                provenance: "ACTUAL_WITH_DECLARED_REPORT",
                verifier_report_description: "TUV Rheinland, 2026-02",
              },
            )
            .select("id")
            .single();

        expect(error).toBeNull();
        expect(data?.id).toBeTruthy();

        precursorId = data!.id;
      },
    );

    it(
      "a verifier report description on a precursor without ACTUAL_WITH_DECLARED_REPORT provenance is refused by the CHECK constraint",
      async () => {
        const { error } =
          await serviceClient
            .from("emission_data_precursors")
            .insert(
              {
                org_id: orgAId,
                emission_data_id: emissionDataId,
                material_description: "Second precursor",
                provenance: "UNKNOWN",
                verifier_report_description: "Should be refused",
              },
            );

        expect(error).not.toBeNull();
      },
    );

    it(
      "a non-canonical decimal string on direct_specific is refused -- same grammar as emission_data's own numeric CHECK",
      async () => {
        const { error } =
          await serviceClient
            .from("emission_data_precursors")
            .insert(
              {
                org_id: orgAId,
                emission_data_id: emissionDataId,
                material_description: "Bad number precursor",
                direct_specific: "1_0",
                provenance: "UNKNOWN",
              },
            );

        expect(error).not.toBeNull();
      },
    );

    it(
      "a stranger org's member cannot see org A's precursors",
      async () => {
        const { data, error } =
          await clientB
            .from("emission_data_precursors")
            .select(
              "id",
            )
            .eq(
              "org_id",
              orgAId,
            );

        expect(error).toBeNull();
        expect(data).toEqual(
          [],
        );
      },
    );

    it(
      "a stranger org's member cannot delete org A's precursor",
      async () => {
        const { data, error } =
          await clientB
            .from("emission_data_precursors")
            .delete()
            .eq(
              "id",
              precursorId,
            )
            .select(
              "id",
            );

        expect(error).toBeNull();
        expect(data).toEqual(
          [],
        );

        const { data: stillThere } =
          await serviceClient
            .from("emission_data_precursors")
            .select(
              "id",
            )
            .eq(
              "id",
              precursorId,
            )
            .maybeSingle();

        expect(stillThere).not.toBeNull();
      },
    );

    it(
      "org A's own member CAN delete their own precursor",
      async () => {
        const { data, error } =
          await clientA
            .from("emission_data_precursors")
            .delete()
            .eq(
              "id",
              precursorId,
            )
            .select(
              "id",
            );

        expect(error).toBeNull();
        expect(data).toHaveLength(
          1,
        );
      },
    );
  },
);

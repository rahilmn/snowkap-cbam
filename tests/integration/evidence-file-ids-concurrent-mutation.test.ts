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
// uploadEvidenceFile/removeEvidenceFile (src/application/evidence/
// upload-evidence.ts) used to mutate emission_data.evidence_file_ids
// with a client-side read-then-write of the WHOLE array -- two such
// calls racing against the same record could each read the same
// baseline before either wrote, and the second writer's own write
// silently overwrote the first's, with no error anywhere. Closed by
// migration 20260906240000: public.append_evidence_file_id/
// remove_evidence_file_id perform the mutation as a single atomic
// `array_append`/`array_remove` UPDATE, so two genuinely concurrent
// calls against the same row serialize at the row level instead of
// racing. This proves the atomicity directly against real local
// Postgres with real concurrent requests (Promise.all over two
// separate supabase-js calls, each its own HTTP round trip/
// transaction), not a mock.

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
  "append_evidence_file_id / remove_evidence_file_id -- atomic under real concurrency (local Supabase only)",
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
    let emissionDataId: string;

    let memberClient: SupabaseClient;

    beforeAll(async () => {
      const { data: org, error: orgError } =
        await serviceClient
          .from("organizations")
          .insert(
            {
              name: `S5 Evidence Concurrency Test Org ${runId}`,
              slug: `s5-evidence-concurrency-test-org-${runId}`,
              capabilities: ["PRODUCER_OPERATOR"],
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

      const password =
        `s5-evidence-concurrency-test-password-${runId}!`;

      const { data: user, error: userError } =
        await serviceClient.auth.admin.createUser(
          {
            email: `s5-evidence-concurrency-${runId}@example.com`,
            password,
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

      memberClient =
        createClient(
          LOCAL_API_URL,
          LOCAL_ANON_KEY,
          { auth: { persistSession: false } },
        );

      const { error: signInError } =
        await memberClient.auth.signInWithPassword(
          { email: `s5-evidence-concurrency-${runId}@example.com`, password },
        );

      if (signInError) {
        throw new Error(
          `Failed to sign in: ${signInError.message}`,
        );
      }

      const { data: operator, error: operatorError } =
        await serviceClient
          .from("operators")
          .insert(
            {
              org_id: orgId,
              provenance: "OPERATOR_PROVIDED",
              name: `S5 Evidence Concurrency Test Operator ${runId}`,
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
              org_id: orgId,
              provenance: "OPERATOR_PROVIDED",
              name: `S5 Evidence Concurrency Test Installation ${runId}`,
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

      const { data: emissionData, error: emissionDataError } =
        await serviceClient
          .from("emission_data")
          .insert(
            {
              installation_id: installation.id,
              entered_by_org_id: orgId,
              cn_scope: ["25231000"],
              reporting_period_kind: "ANNUAL",
              reporting_period_year: 2026,
              direct_specific: "1.0",
              indirect_specific: "0.5",
              emission_unit: "tCO2e/t",
              methodology: "EU_METHOD",
              status: "DRAFT",
              verification_status: "UNVERIFIED",
              evidence_file_ids: [],
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
        .from("evidence_files")
        .delete()
        .eq("emission_data_id", emissionDataId);

      await serviceClient
        .from("emission_data")
        .delete()
        .eq("id", emissionDataId);

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

    // emission_data_update_own_org's own WITH CHECK includes the
    // evidence_file_ids anti-join (20260829480000): every element of a
    // NEW array must correspond to a real evidence_files row. Real rows
    // are seeded for whatever ids each test appends/removes, matching
    // how the real application (uploadEvidenceFile) always inserts the
    // evidence_files row before ever citing its id.
    async function seedEvidenceFilesRow(
      id: string,
    ): Promise<void> {
      const { error } =
        await serviceClient
          .from("evidence_files")
          .insert(
            {
              id,
              org_id: orgId,
              emission_data_id: emissionDataId,
              storage_path: `${orgId}/${emissionDataId}/${id}.pdf`,
              original_filename: `${id}.pdf`,
              mime_type: "application/pdf",
              size_bytes: 100,
              sha256: id.replace(/-/g, "").padEnd(64, "0").toLowerCase(),
              uploaded_by_user_id: userId,
            },
          );

      if (error) {
        throw new Error(
          `Failed to seed evidence_files row ${id}: ${error.message}`,
        );
      }
    }

    it(
      "two genuinely concurrent appends against the same row both land -- neither silently overwrites the other",
      async () => {
        const idA =
          crypto.randomUUID();

        const idB =
          crypto.randomUUID();

        await seedEvidenceFilesRow(
          idA,
        );

        await seedEvidenceFilesRow(
          idB,
        );

        const [resultA, resultB] =
          await Promise.all(
            [
              memberClient.rpc(
                "append_evidence_file_id",
                { p_emission_data_id: emissionDataId, p_evidence_file_id: idA },
              ),
              memberClient.rpc(
                "append_evidence_file_id",
                { p_emission_data_id: emissionDataId, p_evidence_file_id: idB },
              ),
            ],
          );

        expect(resultA.error).toBeNull();
        expect(resultB.error).toBeNull();

        const { data: after } =
          await serviceClient
            .from("emission_data")
            .select("evidence_file_ids")
            .eq("id", emissionDataId)
            .single();

        const ids =
          (after?.evidence_file_ids as string[]).sort();

        expect(ids).toEqual(
          [idA, idB].sort(),
        );
      },
    );

    it(
      "a concurrent append and remove against the same row both land -- the exact race the S5 finding demonstrated (an uploaded file's citation silently dropped by a concurrent removal)",
      async () => {
        const preExistingId =
          crypto.randomUUID();

        const newlyUploadedId =
          crypto.randomUUID();

        await seedEvidenceFilesRow(
          preExistingId,
        );

        await seedEvidenceFilesRow(
          newlyUploadedId,
        );

        const { error: seedError } =
          await serviceClient
            .from("emission_data")
            .update(
              { evidence_file_ids: [preExistingId] },
            )
            .eq("id", emissionDataId);

        if (seedError) {
          throw new Error(
            `Failed to seed evidence_file_ids: ${seedError.message}`,
          );
        }

        const [appendResult, removeResult] =
          await Promise.all(
            [
              memberClient.rpc(
                "append_evidence_file_id",
                { p_emission_data_id: emissionDataId, p_evidence_file_id: newlyUploadedId },
              ),
              memberClient.rpc(
                "remove_evidence_file_id",
                { p_emission_data_id: emissionDataId, p_evidence_file_id: preExistingId },
              ),
            ],
          );

        expect(appendResult.error).toBeNull();
        expect(removeResult.error).toBeNull();

        const { data: after } =
          await serviceClient
            .from("emission_data")
            .select("evidence_file_ids")
            .eq("id", emissionDataId)
            .single();

        // The newly-uploaded file's citation must survive regardless of
        // interleaving order, and the removed file must actually be
        // gone -- both, never just one (the pre-fix bug dropped the
        // append silently whichever order lost the race).
        expect(after?.evidence_file_ids).toEqual(
          [newlyUploadedId],
        );
      },
    );
  },
);

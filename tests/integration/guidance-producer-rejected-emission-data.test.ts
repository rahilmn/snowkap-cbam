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
  listRejectedEmissionDataForGuidance,
} from "../../src/application/emissions/list-rejected-emission-data-for-guidance";

// Snowkap CBAM, S5 cross-phase hardening (2026-09-06). Confirmed
// finding: the guidance dashboard had zero rule coverage for any S4
// producer-domain gate, so a producer-only org's dashboard read
// "Nothing needs your attention right now" while a REJECTED emission_
// data record sat permanently blocked. Proves listRejectedEmissionData
// ForGuidance's own real query shape (column/table names, RLS) against
// real local Postgres, not just a mock -- the unit tests already cover
// its own error-handling contract.

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
  "listRejectedEmissionDataForGuidance -- against real local Postgres (local Supabase only)",
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
    let installationId: string;
    let rejectedEmissionDataId: string;
    let memberClient: SupabaseClient;

    beforeAll(async () => {
      const { data: org, error: orgError } =
        await serviceClient
          .from("organizations")
          .insert(
            {
              name: `S5 Guidance Rejected Test Org ${runId}`,
              slug: `s5-guidance-rejected-test-org-${runId}`,
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
        `s5-guidance-rejected-test-password-${runId}!`;

      const { data: user, error: userError } =
        await serviceClient.auth.admin.createUser(
          {
            email: `s5-guidance-rejected-${runId}@example.com`,
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
          { email: `s5-guidance-rejected-${runId}@example.com`, password },
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
              name: `S5 Guidance Rejected Test Operator ${runId}`,
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
              name: `S5 Guidance Rejected Test Installation ${runId}`,
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
              entered_by_org_id: orgId,
              cn_scope: ["25231000"],
              reporting_period_kind: "ANNUAL",
              reporting_period_year: 2026,
              direct_specific: "1.0",
              indirect_specific: "0.5",
              emission_unit: "tCO2e/t",
              methodology: "EU_METHOD",
              status: "DRAFT",
              verification_status: "REJECTED",
              rejection_reason: "Live integration test: missing supporting evidence",
              version: 1,
            },
          )
          .select("id")
          .single();

      if (emissionDataError || !emissionData) {
        throw new Error(
          `Failed to create rejected emission_data: ${emissionDataError?.message}`,
        );
      }

      rejectedEmissionDataId = emissionData.id;
    });

    afterAll(async () => {
      await serviceClient
        .from("emission_data")
        .delete()
        .eq("id", rejectedEmissionDataId);

      await serviceClient
        .from("installations")
        .delete()
        .eq("id", installationId);

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
      "a real member finds their own org's REJECTED record, with the real installation name resolved",
      async () => {
        const result =
          await listRejectedEmissionDataForGuidance(
            memberClient,
            orgId as never,
          );

        expect(result).toHaveLength(
          1,
        );

        expect(result[0]?.id).toBe(
          rejectedEmissionDataId,
        );

        expect(result[0]?.installation_name).toBe(
          `S5 Guidance Rejected Test Installation ${runId}`,
        );

        expect(result[0]?.rejection_reason).toBe(
          "Live integration test: missing supporting evidence",
        );
      },
    );
  },
);

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

// Standing two-org isolation suite (docs/plans/MASTER_PLAN.md §13: "a
// standing test, not an assumption... from P3 on every new port/policy").
// Runs against a LOCAL, disposable Supabase instance (`supabase start`
// + `supabase migration up --local`) -- never the protected regulatory
// project, which this repo's standing rules forbid using as a tenancy/
// RLS testing playground. Skips cleanly (not fails, not silently
// passes) when local Supabase isn't reachable, matching the same
// discipline as every other credential-gated integration suite in this
// repo.
//
// The ANON_KEY/SERVICE_ROLE_KEY below are the fixed, publicly-
// documented demo JWTs `supabase start` always prints for a fresh
// local project (deterministically derived from the equally-public
// default local JWT_SECRET) -- not secrets. They are meaningless
// outside a local, unauthenticated Docker network and are safe to
// commit. Override via env if a different local setup is used.

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
        {
          signal:
            AbortSignal.timeout(
              1500,
            ),
        },
      );

    return response.ok;
  } catch {
    return false;
  }
}

const localSupabaseReachable =
  await isLocalSupabaseReachable();

describe.skipIf(!localSupabaseReachable)(
  "organizations RLS -- two-org isolation (local Supabase only)",
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
        {
          auth: { persistSession: false },
        },
      );

    let orgAId: string;
    let orgBId: string;
    let userAId: string;
    let userBId: string;
    let strangerId: string;

    let clientA: SupabaseClient;
    let clientB: SupabaseClient;
    let clientStranger: SupabaseClient;

    async function signInAnonClient(
      email: string,
      password: string,
    ): Promise<SupabaseClient> {
      const client =
        createClient(
          LOCAL_API_URL,
          LOCAL_ANON_KEY,
          {
            auth: { persistSession: false },
          },
        );

      const { error } =
        await client.auth.signInWithPassword(
          {
            email,
            password,
          },
        );

      if (error) {
        throw new Error(
          `Failed to sign in test user ${email}: ${error.message}`,
        );
      }

      return client;
    }

    beforeAll(async () => {
      // Two organizations, one member each, plus a stranger with no
      // membership anywhere -- created via the service-role client
      // since no INSERT policy exists yet (deliberately deferred until
      // the onboarding RPC lands -- see the migration's own header
      // comment). Service-role bypasses RLS by design, which is exactly
      // what provisioning test fixtures needs.
      const { data: orgA, error: orgAError } =
        await serviceClient
          .from("organizations")
          .insert(
            {
              name: `Isolation Test Org A ${runId}`,
              slug: `isolation-test-org-a-${runId}`,
              capabilities: ["IMPORTER_DECLARANT"],
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
              name: `Isolation Test Org B ${runId}`,
              slug: `isolation-test-org-b-${runId}`,
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
        `isolation-test-password-${runId}!`;

      const { data: userA, error: userAError } =
        await serviceClient.auth.admin.createUser(
          {
            email: `isolation-a-${runId}@example.com`,
            password,
            email_confirm: true,
          },
        );

      if (userAError || !userA.user) {
        throw new Error(
          `Failed to create user A: ${userAError?.message}`,
        );
      }

      userAId = userA.user.id;

      const { data: userB, error: userBError } =
        await serviceClient.auth.admin.createUser(
          {
            email: `isolation-b-${runId}@example.com`,
            password,
            email_confirm: true,
          },
        );

      if (userBError || !userB.user) {
        throw new Error(
          `Failed to create user B: ${userBError?.message}`,
        );
      }

      userBId = userB.user.id;

      const { data: stranger, error: strangerError } =
        await serviceClient.auth.admin.createUser(
          {
            email: `isolation-stranger-${runId}@example.com`,
            password,
            email_confirm: true,
          },
        );

      if (strangerError || !stranger.user) {
        throw new Error(
          `Failed to create stranger user: ${strangerError?.message}`,
        );
      }

      strangerId = stranger.user.id;

      const { error: membershipError } =
        await serviceClient
          .from("memberships")
          .insert(
            [
              {
                org_id: orgAId,
                user_id: userAId,
                role: "OWNER",
              },
              {
                org_id: orgBId,
                user_id: userBId,
                role: "OWNER",
              },
            ],
          );

      if (membershipError) {
        throw new Error(
          `Failed to create memberships: ${membershipError.message}`,
        );
      }

      const { error: auditError } =
        await serviceClient
          .from("audit_events")
          .insert(
            [
              {
                org_id: orgAId,
                actor_type: "SYSTEM",
                event_type: "isolation_test.fixture_created",
                aggregate_type: "ORGANIZATION",
                aggregate_id: orgAId,
                payload: {},
              },
              {
                org_id: orgBId,
                actor_type: "SYSTEM",
                event_type: "isolation_test.fixture_created",
                aggregate_type: "ORGANIZATION",
                aggregate_id: orgBId,
                payload: {},
              },
            ],
          );

      if (auditError) {
        throw new Error(
          `Failed to create audit events: ${auditError.message}`,
        );
      }

      clientA =
        await signInAnonClient(
          `isolation-a-${runId}@example.com`,
          password,
        );

      clientB =
        await signInAnonClient(
          `isolation-b-${runId}@example.com`,
          password,
        );

      clientStranger =
        await signInAnonClient(
          `isolation-stranger-${runId}@example.com`,
          password,
        );
    });

    afterAll(async () => {
      // Service role deletes bypass RLS; membership/audit rows cascade
      // or restrict per the migration's FK definitions, so delete in
      // dependency order.
      await serviceClient
        .from("audit_events")
        .delete()
        .in(
          "org_id",
          [orgAId, orgBId],
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
        const id of [userAId, userBId, strangerId]
      ) {
        await serviceClient.auth.admin.deleteUser(
          id,
        );
      }
    });

    it(
      "a user sees their own organization",
      async () => {
        const { data, error } =
          await clientA
            .from("organizations")
            .select("id")
            .eq("id", orgAId);

        expect(error).toBeNull();
        expect(data).toHaveLength(1);
      },
    );

    it(
      "a user does not see another organization",
      async () => {
        const { data, error } =
          await clientA
            .from("organizations")
            .select("id")
            .eq("id", orgBId);

        expect(error).toBeNull();
        expect(data).toHaveLength(0);
      },
    );

    it(
      "a user's unfiltered organizations query only returns their own org",
      async () => {
        const { data, error } =
          await clientB
            .from("organizations")
            .select("id");

        expect(error).toBeNull();
        expect(
          data?.map((row) => row.id),
        ).toEqual(
          [orgBId],
        );
      },
    );

    it(
      "a user sees their own membership but not the other org's",
      async () => {
        const { data: ownMemberships, error: ownError } =
          await clientA
            .from("memberships")
            .select("org_id, user_id");

        expect(ownError).toBeNull();
        expect(
          ownMemberships,
        ).toEqual(
          [
            {
              org_id: orgAId,
              user_id: userAId,
            },
          ],
        );

        const { data: otherOrgMemberships, error: otherError } =
          await clientA
            .from("memberships")
            .select("org_id, user_id")
            .eq("org_id", orgBId);

        expect(otherError).toBeNull();
        expect(otherOrgMemberships).toHaveLength(0);
      },
    );

    it(
      "a user sees their own org's audit events but not the other org's",
      async () => {
        const { data: ownEvents, error: ownError } =
          await clientA
            .from("audit_events")
            .select("org_id");

        expect(ownError).toBeNull();
        expect(
          ownEvents?.every(
            (event) => event.org_id === orgAId,
          ),
        ).toBe(true);

        expect(
          (ownEvents?.length ?? 0) > 0,
        ).toBe(true);

        const { data: otherEvents, error: otherError } =
          await clientA
            .from("audit_events")
            .select("org_id")
            .eq("org_id", orgBId);

        expect(otherError).toBeNull();
        expect(otherEvents).toHaveLength(0);
      },
    );

    it(
      "a stranger with no membership anywhere sees nothing in either org",
      async () => {
        const { data: organizations, error: orgError } =
          await clientStranger
            .from("organizations")
            .select("id");

        expect(orgError).toBeNull();
        expect(organizations).toHaveLength(0);

        const { data: memberships, error: membershipError } =
          await clientStranger
            .from("memberships")
            .select("id");

        expect(membershipError).toBeNull();
        expect(memberships).toHaveLength(0);

        const { data: auditEvents, error: auditError } =
          await clientStranger
            .from("audit_events")
            .select("id");

        expect(auditError).toBeNull();
        expect(auditEvents).toHaveLength(0);
      },
    );

    it(
      "a user cannot write to organizations (no INSERT policy exists yet)",
      async () => {
        const { error } =
          await clientA
            .from("organizations")
            .insert(
              {
                name: "Should not be allowed",
                slug: `should-not-be-allowed-${runId}`,
                capabilities: ["IMPORTER_DECLARANT"],
              },
            );

        // Deliberate: no INSERT policy exists for organizations yet
        // (see the migration header comment) -- RLS-enabled + zero
        // matching policy denies by default. This test locks in that
        // posture so it fails loudly if a future migration adds a
        // too-permissive policy without updating this expectation.
        expect(error).not.toBeNull();
      },
    );
  },
);

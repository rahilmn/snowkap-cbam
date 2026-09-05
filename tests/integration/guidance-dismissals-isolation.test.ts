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

// Snowkap CBAM SME Experience v2.1.1, S2: guidance_dismissals
// (20260905160000_sme_guidance_dismissals.sql). Structurally mirrors
// tests/integration/sme-organization-profiles-isolation.test.ts, with
// one addition that table didn't need: guidance_dismissals is scoped
// to (org, user), not just org, so this suite proves isolation in BOTH
// directions -- across orgs, AND across two members of the SAME org.
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
  "guidance_dismissals RLS -- cross-org AND cross-user-same-org isolation (local Supabase only)",
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
    let memberA1Id: string;
    let memberA2Id: string;
    let memberBId: string;

    let clientA1: SupabaseClient;
    let clientA2: SupabaseClient;
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
              name: `Guidance Dismissal Test Org A ${runId}`,
              slug: `guidance-dismissal-test-org-a-${runId}`,
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
              name: `Guidance Dismissal Test Org B ${runId}`,
              slug: `guidance-dismissal-test-org-b-${runId}`,
              capabilities: ["IMPORTER_DECLARANT"],
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
        `guidance-dismissal-test-password-${runId}!`;

      async function createUser(
        label: string,
      ): Promise<string> {
        const { data, error } =
          await serviceClient.auth.admin.createUser(
            {
              email: `guidance-dismissal-${label}-${runId}@example.com`,
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

      memberA1Id =
        await createUser(
          "member-a1",
        );

      memberA2Id =
        await createUser(
          "member-a2",
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
              { org_id: orgAId, user_id: memberA1Id, role: "MEMBER" },
              { org_id: orgAId, user_id: memberA2Id, role: "MEMBER" },
              { org_id: orgBId, user_id: memberBId, role: "MEMBER" },
            ],
          );

      if (membershipError) {
        throw new Error(
          `Failed to create memberships: ${membershipError.message}`,
        );
      }

      clientA1 =
        await signInAnonClient(
          `guidance-dismissal-member-a1-${runId}@example.com`,
          password,
        );

      clientA2 =
        await signInAnonClient(
          `guidance-dismissal-member-a2-${runId}@example.com`,
          password,
        );

      clientB =
        await signInAnonClient(
          `guidance-dismissal-member-b-${runId}@example.com`,
          password,
        );
    });

    afterAll(async () => {
      await serviceClient
        .from("guidance_dismissals")
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
        const userId of [memberA1Id, memberA2Id, memberBId]
      ) {
        await serviceClient.auth.admin.deleteUser(
          userId,
        );
      }
    });

    it(
      "any MEMBER may dismiss a guidance item for themselves -- not gated to ADMIN/OWNER, unlike organization_profiles",
      async () => {
        const { error } =
          await clientA1
            .from("guidance_dismissals")
            .insert(
              { org_id: orgAId, item_key: "I19:test-item" },
            );

        expect(error).toBeNull();
      },
    );

    it(
      "the trigger pins user_id from auth.uid(), not a caller-supplied value",
      async () => {
        const { data, error } =
          await clientA1
            .from("guidance_dismissals")
            .select(
              "user_id, item_key",
            )
            .eq(
              "org_id",
              orgAId,
            )
            .eq(
              "item_key",
              "I19:test-item",
            )
            .single();

        expect(error).toBeNull();
        expect(data?.user_id).toBe(
          memberA1Id,
        );
      },
    );

    it(
      "a fellow member of the SAME org cannot see the first member's dismissal -- RLS silently filters to zero rows, not an error",
      async () => {
        const { data, error } =
          await clientA2
            .from("guidance_dismissals")
            .select(
              "item_key",
            )
            .eq(
              "org_id",
              orgAId,
            )
            .eq(
              "item_key",
              "I19:test-item",
            );

        expect(error).toBeNull();
        expect(data).toEqual(
          [],
        );
      },
    );

    it(
      "a fellow member CAN insert their own dismissal for the exact same item_key in the same org -- the uniqueness is per (org, user, item), not per (org, item)",
      async () => {
        const { error } =
          await clientA2
            .from("guidance_dismissals")
            .insert(
              { org_id: orgAId, item_key: "I19:test-item" },
            );

        expect(error).toBeNull();
      },
    );

    it(
      "a fellow member cannot delete the first member's dismissal",
      async () => {
        const { data, error } =
          await clientA2
            .from("guidance_dismissals")
            .delete()
            .eq(
              "org_id",
              orgAId,
            )
            .eq(
              "item_key",
              "I19:test-item",
            )
            .eq(
              "user_id",
              memberA1Id,
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
            .from("guidance_dismissals")
            .select(
              "id",
            )
            .eq(
              "org_id",
              orgAId,
            )
            .eq(
              "item_key",
              "I19:test-item",
            )
            .eq(
              "user_id",
              memberA1Id,
            )
            .maybeSingle();

        expect(stillThere).not.toBeNull();
      },
    );

    it(
      "a member CAN delete their own dismissal (un-dismiss)",
      async () => {
        const { data, error } =
          await clientA1
            .from("guidance_dismissals")
            .delete()
            .eq(
              "org_id",
              orgAId,
            )
            .eq(
              "item_key",
              "I19:test-item",
            )
            .select(
              "id",
            );

        expect(error).toBeNull();
        expect(data).toHaveLength(
          1,
        );

        const { data: goneNow } =
          await serviceClient
            .from("guidance_dismissals")
            .select(
              "id",
            )
            .eq(
              "org_id",
              orgAId,
            )
            .eq(
              "item_key",
              "I19:test-item",
            )
            .eq(
              "user_id",
              memberA1Id,
            )
            .maybeSingle();

        expect(goneNow).toBeNull();
      },
    );

    it(
      "re-dismissing after undismissing succeeds (a fresh insert, not blocked by the earlier row)",
      async () => {
        const { error } =
          await clientA1
            .from("guidance_dismissals")
            .insert(
              { org_id: orgAId, item_key: "I19:test-item" },
            );

        expect(error).toBeNull();
      },
    );

    it(
      "dismissing the SAME item twice without undismissing hits the unique constraint (application code treats 23505 as success -- see dismiss-guidance-item.ts)",
      async () => {
        const { error } =
          await clientA1
            .from("guidance_dismissals")
            .insert(
              { org_id: orgAId, item_key: "I19:test-item" },
            );

        expect(error).not.toBeNull();
        expect(error?.code).toBe(
          "23505",
        );
      },
    );

    it(
      "a stranger org's member cannot read org A's dismissals at all",
      async () => {
        const { data, error } =
          await clientB
            .from("guidance_dismissals")
            .select(
              "item_key",
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
      "a stranger org's member cannot insert a dismissal into org A",
      async () => {
        const { error } =
          await clientB
            .from("guidance_dismissals")
            .insert(
              { org_id: orgAId, item_key: "I19:stranger-attempt" },
            );

        // Refused by the WITH CHECK (org_id must be one of the
        // caller's own orgs) -- a real error here, not a silently
        // filtered zero-row write, because INSERT policies can only
        // ever reject or accept the one row being written.
        expect(error).not.toBeNull();
      },
    );

    it(
      "empty item_key is refused by the CHECK constraint",
      async () => {
        const { error } =
          await serviceClient
            .from("guidance_dismissals")
            .insert(
              { org_id: orgAId, user_id: memberA1Id, item_key: "" },
            );

        expect(error).not.toBeNull();
      },
    );
  },
);

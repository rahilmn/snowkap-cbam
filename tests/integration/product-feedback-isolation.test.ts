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

// Snowkap CBAM SME Experience v2.1.1, S2: product_feedback
// (20260905170000_sme_product_feedback.sql). Structurally mirrors
// tests/integration/sme-organization-profiles-isolation.test.ts.
// Insert-only by design (no UPDATE/DELETE policy at all, matching
// audit_events) -- this suite proves that absence directly, not just
// that a write happens to be refused. Runs against LOCAL, disposable
// Supabase only; skips cleanly when unreachable.

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
  "product_feedback RLS -- insert-only, own-submission-read, cross-org and cross-user isolation (local Supabase only)",
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
              name: `Product Feedback Test Org A ${runId}`,
              slug: `product-feedback-test-org-a-${runId}`,
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
              name: `Product Feedback Test Org B ${runId}`,
              slug: `product-feedback-test-org-b-${runId}`,
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
        `product-feedback-test-password-${runId}!`;

      async function createUser(
        label: string,
      ): Promise<string> {
        const { data, error } =
          await serviceClient.auth.admin.createUser(
            {
              email: `product-feedback-${label}-${runId}@example.com`,
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
          `product-feedback-member-a1-${runId}@example.com`,
          password,
        );

      clientA2 =
        await signInAnonClient(
          `product-feedback-member-a2-${runId}@example.com`,
          password,
        );

      clientB =
        await signInAnonClient(
          `product-feedback-member-b-${runId}@example.com`,
          password,
        );
    });

    afterAll(async () => {
      await serviceClient
        .from("product_feedback")
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
      "any MEMBER may submit feedback for their own org",
      async () => {
        const { error } =
          await clientA1
            .from("product_feedback")
            .insert(
              {
                org_id: orgAId,
                rating: 4,
                comment: "Clear flow.",
                page: "/shipments/new",
                workflow: "importer-shipment-intake",
                context: { shipmentId: "abc" },
                release_sha: "test-sha",
              },
            );

        expect(error).toBeNull();
      },
    );

    it(
      "the trigger pins user_id from auth.uid(), not a caller-supplied value",
      async () => {
        const { data, error } =
          await serviceClient
            .from("product_feedback")
            .select(
              "user_id, page",
            )
            .eq(
              "org_id",
              orgAId,
            )
            .eq(
              "page",
              "/shipments/new",
            )
            .single();

        expect(error).toBeNull();
        expect(data?.user_id).toBe(
          memberA1Id,
        );
      },
    );

    it(
      "a submitter can read back their own submission",
      async () => {
        const { data, error } =
          await clientA1
            .from("product_feedback")
            .select(
              "page, rating",
            )
            .eq(
              "org_id",
              orgAId,
            )
            .eq(
              "page",
              "/shipments/new",
            )
            .maybeSingle();

        expect(error).toBeNull();
        expect(data?.rating).toBe(
          4,
        );
      },
    );

    it(
      "a fellow member of the SAME org cannot read the first member's submission -- RLS silently filters to zero rows",
      async () => {
        const { data, error } =
          await clientA2
            .from("product_feedback")
            .select(
              "page",
            )
            .eq(
              "org_id",
              orgAId,
            )
            .eq(
              "page",
              "/shipments/new",
            );

        expect(error).toBeNull();
        expect(data).toEqual(
          [],
        );
      },
    );

    it(
      "a fellow member CAN submit their own feedback in the same org",
      async () => {
        const { error } =
          await clientA2
            .from("product_feedback")
            .insert(
              {
                org_id: orgAId,
                rating: 2,
                page: "/declarations",
                release_sha: "test-sha",
              },
            );

        expect(error).toBeNull();
      },
    );

    it(
      "comment/workflow default to null and context to {} when omitted",
      async () => {
        const { data, error } =
          await clientA2
            .from("product_feedback")
            .select(
              "comment, workflow, context",
            )
            .eq(
              "org_id",
              orgAId,
            )
            .eq(
              "page",
              "/declarations",
            )
            .single();

        expect(error).toBeNull();
        expect(data?.comment).toBeNull();
        expect(data?.workflow).toBeNull();
        expect(data?.context).toEqual(
          {},
        );
      },
    );

    it(
      "the rating CHECK constraint refuses a value outside 1-5",
      async () => {
        const { error } =
          await clientA1
            .from("product_feedback")
            .insert(
              {
                org_id: orgAId,
                rating: 6,
                page: "/",
                release_sha: "test-sha",
              },
            );

        expect(error).not.toBeNull();
      },
    );

    it(
      "an empty page is refused by the CHECK constraint",
      async () => {
        const { error } =
          await clientA1
            .from("product_feedback")
            .insert(
              {
                org_id: orgAId,
                rating: 3,
                page: "",
                release_sha: "test-sha",
              },
            );

        expect(error).not.toBeNull();
      },
    );

    it(
      "no UPDATE policy exists -- even the submitter cannot edit their own feedback",
      async () => {
        const { data, error } =
          await clientA1
            .from("product_feedback")
            .update(
              { rating: 1 },
            )
            .eq(
              "org_id",
              orgAId,
            )
            .eq(
              "page",
              "/shipments/new",
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
            .from("product_feedback")
            .select(
              "rating",
            )
            .eq(
              "org_id",
              orgAId,
            )
            .eq(
              "page",
              "/shipments/new",
            )
            .single();

        expect(unchanged?.rating).toBe(
          4,
        );
      },
    );

    it(
      "no DELETE policy exists -- even the submitter cannot remove their own feedback",
      async () => {
        const { data, error } =
          await clientA1
            .from("product_feedback")
            .delete()
            .eq(
              "org_id",
              orgAId,
            )
            .eq(
              "page",
              "/shipments/new",
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
            .from("product_feedback")
            .select(
              "id",
            )
            .eq(
              "org_id",
              orgAId,
            )
            .eq(
              "page",
              "/shipments/new",
            )
            .maybeSingle();

        expect(stillThere).not.toBeNull();
      },
    );

    it(
      "a stranger org's member cannot read org A's feedback at all",
      async () => {
        const { data, error } =
          await clientB
            .from("product_feedback")
            .select(
              "page",
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
      "a stranger org's member cannot submit feedback into org A",
      async () => {
        const { error } =
          await clientB
            .from("product_feedback")
            .insert(
              {
                org_id: orgAId,
                rating: 5,
                page: "/stranger-attempt",
                release_sha: "test-sha",
              },
            );

        expect(error).not.toBeNull();
      },
    );

    it(
      "a stranger org's member can submit and read their own, separate org's feedback",
      async () => {
        const { error: insertError } =
          await clientB
            .from("product_feedback")
            .insert(
              {
                org_id: orgBId,
                rating: 5,
                page: "/",
                release_sha: "test-sha",
              },
            );

        expect(insertError).toBeNull();

        const { data, error } =
          await clientB
            .from("product_feedback")
            .select(
              "rating",
            )
            .eq(
              "org_id",
              orgBId,
            )
            .single();

        expect(error).toBeNull();
        expect(data?.rating).toBe(
          5,
        );
      },
    );
  },
);

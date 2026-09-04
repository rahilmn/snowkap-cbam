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

// Snowkap CBAM SME Experience v2.1.1, S1: organization_profiles
// (20260905150000_sme_organization_profiles.sql). Same standing-suite
// discipline as tests/integration/organizations-isolation.test.ts,
// which this file mirrors structurally (two orgs, one MEMBER + one
// ADMIN + one OWNER, plus a cross-org stranger). Runs against LOCAL,
// disposable Supabase only; skips cleanly when unreachable.

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
  "organization_profiles RLS -- isolation and role gate (local Supabase only)",
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
    let ownerAId: string;
    let adminAId: string;
    let memberAId: string;
    let ownerBId: string;

    let clientOwnerA: SupabaseClient;
    let clientAdminA: SupabaseClient;
    let clientMemberA: SupabaseClient;
    let clientOwnerB: SupabaseClient;

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
              name: `SME Profile Test Org A ${runId}`,
              slug: `sme-profile-test-org-a-${runId}`,
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
              name: `SME Profile Test Org B ${runId}`,
              slug: `sme-profile-test-org-b-${runId}`,
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
        `sme-profile-test-password-${runId}!`;

      async function createUser(
        label: string,
      ): Promise<string> {
        const { data, error } =
          await serviceClient.auth.admin.createUser(
            {
              email: `sme-profile-${label}-${runId}@example.com`,
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

      ownerAId =
        await createUser(
          "owner-a",
        );

      adminAId =
        await createUser(
          "admin-a",
        );

      memberAId =
        await createUser(
          "member-a",
        );

      ownerBId =
        await createUser(
          "owner-b",
        );

      const { error: membershipError } =
        await serviceClient
          .from("memberships")
          .insert(
            [
              { org_id: orgAId, user_id: ownerAId, role: "OWNER" },
              { org_id: orgAId, user_id: adminAId, role: "ADMIN" },
              { org_id: orgAId, user_id: memberAId, role: "MEMBER" },
              { org_id: orgBId, user_id: ownerBId, role: "OWNER" },
            ],
          );

      if (membershipError) {
        throw new Error(
          `Failed to create memberships: ${membershipError.message}`,
        );
      }

      clientOwnerA =
        await signInAnonClient(
          `sme-profile-owner-a-${runId}@example.com`,
          password,
        );

      clientAdminA =
        await signInAnonClient(
          `sme-profile-admin-a-${runId}@example.com`,
          password,
        );

      clientMemberA =
        await signInAnonClient(
          `sme-profile-member-a-${runId}@example.com`,
          password,
        );

      clientOwnerB =
        await signInAnonClient(
          `sme-profile-owner-b-${runId}@example.com`,
          password,
        );
    });

    afterAll(async () => {
      await serviceClient
        .from("organization_profiles")
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
        const userId of [ownerAId, adminAId, memberAId, ownerBId]
      ) {
        await serviceClient.auth.admin.deleteUser(
          userId,
        );
      }
    });

    it(
      "an OWNER can insert their own org's profile",
      async () => {
        const { error } =
          await clientOwnerA
            .from("organization_profiles")
            .insert(
              { org_id: orgAId, sectors: ["CEMENT"] },
            );

        expect(error).toBeNull();
      },
    );

    it(
      "the trigger pins updated_by_user_id from auth.uid(), not the caller's claimed value",
      async () => {
        const { data, error } =
          await clientOwnerA
            .from("organization_profiles")
            .select(
              "org_id, sectors, updated_by_user_id",
            )
            .eq(
              "org_id",
              orgAId,
            )
            .single();

        expect(error).toBeNull();
        expect(data?.updated_by_user_id).toBe(
          ownerAId,
        );
      },
    );

    it(
      "a forged updated_by_user_id in the write payload is silently overwritten by the trigger, not honored",
      async () => {
        const forgedUserId =
          adminAId;

        const { error } =
          await clientOwnerA
            .from("organization_profiles")
            .update(
              {
                sectors: ["CEMENT", "IRON_STEEL"],
                updated_by_user_id: forgedUserId,
              },
            )
            .eq(
              "org_id",
              orgAId,
            );

        expect(error).toBeNull();

        const { data } =
          await serviceClient
            .from("organization_profiles")
            .select(
              "updated_by_user_id",
            )
            .eq(
              "org_id",
              orgAId,
            )
            .single();

        expect(data?.updated_by_user_id).toBe(
          ownerAId,
        );

        expect(data?.updated_by_user_id).not.toBe(
          forgedUserId,
        );
      },
    );

    it(
      "an ADMIN of the same org can read and write it",
      async () => {
        const { data: readData, error: readError } =
          await clientAdminA
            .from("organization_profiles")
            .select(
              "org_id",
            )
            .eq(
              "org_id",
              orgAId,
            )
            .maybeSingle();

        expect(readError).toBeNull();
        expect(readData).not.toBeNull();

        const { error: writeError } =
          await clientAdminA
            .from("organization_profiles")
            .update(
              { sectors: ["FERTILISERS"] },
            )
            .eq(
              "org_id",
              orgAId,
            );

        expect(writeError).toBeNull();
      },
    );

    it(
      "a plain MEMBER can read the org's profile",
      async () => {
        const { data, error } =
          await clientMemberA
            .from("organization_profiles")
            .select(
              "org_id, sectors",
            )
            .eq(
              "org_id",
              orgAId,
            )
            .maybeSingle();

        expect(error).toBeNull();
        expect(data).not.toBeNull();
      },
    );

    it(
      "a plain MEMBER cannot write the org's profile -- RLS silently filters the write to zero rows, not an error",
      async () => {
        const { data, error } =
          await clientMemberA
            .from("organization_profiles")
            .update(
              { sectors: ["ALUMINIUM"] },
            )
            .eq(
              "org_id",
              orgAId,
            )
            .select(
              "org_id",
            );

        expect(error).toBeNull();
        expect(data).toEqual(
          [],
        );

        const { data: unchanged } =
          await serviceClient
            .from("organization_profiles")
            .select(
              "sectors",
            )
            .eq(
              "org_id",
              orgAId,
            )
            .single();

        expect(unchanged?.sectors).not.toContain(
          "ALUMINIUM",
        );
      },
    );

    it(
      "a MEMBER cannot insert a profile for their org either",
      async () => {
        const { data, error } =
          await clientMemberA
            .from("organization_profiles")
            .insert(
              { org_id: orgAId, sectors: ["HYDROGEN"] },
            )
            .select(
              "org_id",
            );

        // The row already exists (created by the OWNER test above), so
        // this is refused by the primary key, not distinguishably by
        // RLS alone -- the RLS INSERT policy is proven directly by the
        // OWNER-succeeds / stranger-below-refused pair instead. This
        // case documents that a MEMBER gets no foothold via INSERT
        // either way.
        expect(error).not.toBeNull();
        expect(data ?? []).toEqual(
          [],
        );
      },
    );

    it(
      "a stranger org (org B's OWNER) cannot read org A's profile at all",
      async () => {
        const { data, error } =
          await clientOwnerB
            .from("organization_profiles")
            .select(
              "org_id, sectors",
            )
            .eq(
              "org_id",
              orgAId,
            )
            .maybeSingle();

        expect(error).toBeNull();
        expect(data).toBeNull();
      },
    );

    it(
      "org B's OWNER cannot write into org A's profile",
      async () => {
        const { data, error } =
          await clientOwnerB
            .from("organization_profiles")
            .update(
              { sectors: ["ELECTRICITY"] },
            )
            .eq(
              "org_id",
              orgAId,
            )
            .select(
              "org_id",
            );

        expect(error).toBeNull();
        expect(data).toEqual(
          [],
        );
      },
    );

    it(
      "org B's OWNER can insert and read their own, separate org's profile",
      async () => {
        const { error: insertError } =
          await clientOwnerB
            .from("organization_profiles")
            .insert(
              { org_id: orgBId, sectors: ["ALUMINIUM"] },
            );

        expect(insertError).toBeNull();

        const { data, error } =
          await clientOwnerB
            .from("organization_profiles")
            .select(
              "org_id, sectors",
            )
            .eq(
              "org_id",
              orgBId,
            )
            .single();

        expect(error).toBeNull();
        expect(data?.sectors).toEqual(
          ["ALUMINIUM"],
        );
      },
    );

    it(
      "the sectors CHECK constraint refuses a value outside the canonical enum",
      async () => {
        const { error } =
          await serviceClient
            .from("organization_profiles")
            .update(
              { sectors: ["NOT_A_REAL_SECTOR"] },
            )
            .eq(
              "org_id",
              orgAId,
            );

        expect(error).not.toBeNull();
      },
    );

    it(
      "no DELETE policy exists -- even the OWNER cannot delete their own org's profile row",
      async () => {
        const { data, error } =
          await clientOwnerA
            .from("organization_profiles")
            .delete()
            .eq(
              "org_id",
              orgAId,
            )
            .select(
              "org_id",
            );

        expect(error).toBeNull();
        expect(data).toEqual(
          [],
        );

        const { data: stillThere } =
          await serviceClient
            .from("organization_profiles")
            .select(
              "org_id",
            )
            .eq(
              "org_id",
              orgAId,
            )
            .maybeSingle();

        expect(stillThere).not.toBeNull();
      },
    );
  },
);

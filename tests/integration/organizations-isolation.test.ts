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
      "a user cannot INSERT into organizations directly (must go through the onboarding RPC)",
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

        // Deliberate: no direct INSERT policy exists for organizations
        // -- app.create_organization_with_owner() (20260828080000) is
        // the only sanctioned creation path, since a bare policy can't
        // also insert the matching OWNER membership row atomically.
        // This test locks in that posture so it fails loudly if a
        // future migration adds a too-permissive direct-insert policy
        // without updating this expectation.
        expect(error).not.toBeNull();
      },
    );

    it(
      "onboarding RPC atomically creates an organization and makes the caller its OWNER",
      async () => {
        const onboardingUserEmail =
          `isolation-onboarding-${runId}@example.com`;

        const onboardingPassword =
          `isolation-test-password-${runId}!`;

        const { data: onboardingUser, error: onboardingUserError } =
          await serviceClient.auth.admin.createUser(
            {
              email: onboardingUserEmail,
              password: onboardingPassword,
              email_confirm: true,
            },
          );

        if (onboardingUserError || !onboardingUser.user) {
          throw new Error(
            `Failed to create onboarding user: ${onboardingUserError?.message}`,
          );
        }

        const onboardingUserId =
          onboardingUser.user.id;

        const clientOnboarding =
          await signInAnonClient(
            onboardingUserEmail,
            onboardingPassword,
          );

        try {
          const { data: newOrg, error: rpcError } =
            await clientOnboarding.rpc(
              "create_organization_with_owner",
              {
                p_name: `Onboarding Test Org ${runId}`,
                p_slug: `onboarding-test-org-${runId}`,
                p_capabilities: ["IMPORTER_DECLARANT"],
              },
            );

          expect(rpcError).toBeNull();
          expect(newOrg?.id).toBeDefined();

          const newOrgId: string =
            newOrg.id;

          // The caller can now see the org they just created...
          const { data: visibleOrg, error: visibleOrgError } =
            await clientOnboarding
              .from("organizations")
              .select("id")
              .eq("id", newOrgId);

          expect(visibleOrgError).toBeNull();
          expect(visibleOrg).toHaveLength(1);

          // ...as its OWNER...
          const { data: membership, error: membershipError } =
            await clientOnboarding
              .from("memberships")
              .select("role")
              .eq("org_id", newOrgId)
              .eq("user_id", onboardingUserId)
              .single();

          expect(membershipError).toBeNull();
          expect(membership?.role).toBe("OWNER");

          // ...and the RPC recorded an organization.created audit
          // event for it, attributed to the caller
          // (20260828090000_audit_organization_creation.sql).
          const { data: auditEvent, error: auditEventError } =
            await clientOnboarding
              .from("audit_events")
              .select("actor_type, event_type, aggregate_type, aggregate_id, payload")
              .eq("org_id", newOrgId)
              .eq("event_type", "organization.created")
              .single();

          expect(auditEventError).toBeNull();
          expect(auditEvent?.actor_type).toBe("USER");
          expect(auditEvent?.aggregate_type).toBe("ORGANIZATION");
          expect(auditEvent?.aggregate_id).toBe(newOrgId);
          expect(auditEvent?.payload).toMatchObject(
            {
              slug: `onboarding-test-org-${runId}`,
            },
          );

          // ...and an unrelated user (A) still cannot see it (isolation
          // holds for orgs created via the RPC too, not just fixtures
          // inserted directly by the service role).
          const { data: fromA, error: fromAError } =
            await clientA
              .from("organizations")
              .select("id")
              .eq("id", newOrgId);

          expect(fromAError).toBeNull();
          expect(fromA).toHaveLength(0);

          // Cleanup: service role bypasses RLS for teardown.
          // audit_events.org_id is `on delete restrict`, so it must go
          // before organizations or the delete below fails.
          await serviceClient
            .from("audit_events")
            .delete()
            .eq("org_id", newOrgId);

          await serviceClient
            .from("memberships")
            .delete()
            .eq("org_id", newOrgId);

          await serviceClient
            .from("organizations")
            .delete()
            .eq("id", newOrgId);
        } finally {
          await serviceClient.auth.admin.deleteUser(
            onboardingUserId,
          );
        }
      },
    );

    it(
      "OWNER/ADMIN can update their own org; a member of a different org cannot",
      async () => {
        const { error: ownUpdateError } =
          await clientA
            .from("organizations")
            .update(
              { name: `Isolation Test Org A ${runId} (renamed)` },
            )
            .eq("id", orgAId);

        expect(ownUpdateError).toBeNull();

        const { data: renamed, error: renamedReadError } =
          await clientA
            .from("organizations")
            .select("name")
            .eq("id", orgAId)
            .single();

        expect(renamedReadError).toBeNull();
        expect(renamed?.name).toBe(
          `Isolation Test Org A ${runId} (renamed)`,
        );

        // clientB is a member of org B only -- attempting to update org
        // A must affect zero rows (RLS filters it out of the UPDATE's
        // target set entirely; this is not a permission error, just no
        // matching row from B's perspective).
        const { data: crossOrgUpdateResult, error: crossOrgUpdateError } =
          await clientB
            .from("organizations")
            .update(
              { name: "Should not be renamed by org B" },
            )
            .eq("id", orgAId)
            .select("id");

        expect(crossOrgUpdateError).toBeNull();
        expect(crossOrgUpdateResult).toHaveLength(0);

        const { data: stillOriginal, error: stillOriginalError } =
          await serviceClient
            .from("organizations")
            .select("name")
            .eq("id", orgAId)
            .single();

        expect(stillOriginalError).toBeNull();
        expect(stillOriginal?.name).toBe(
          `Isolation Test Org A ${runId} (renamed)`,
        );
      },
    );

    describe(
      "membership management (20260828110000)",
      () => {
        it(
          "OWNER can change another member's role and remove them; a plain MEMBER and a different org's OWNER cannot",
          async () => {
            const password =
              `isolation-test-password-${runId}!`;

            // A fresh org (own OWNER) with one additional MEMBER, so
            // this test doesn't disturb the shared orgA/orgB fixtures
            // other tests in this file depend on.
            const { data: freshOrg, error: freshOrgError } =
              await serviceClient
                .from("organizations")
                .insert(
                  {
                    name: `Membership Mgmt Org ${runId}`,
                    slug: `membership-mgmt-org-${runId}`,
                    capabilities: ["IMPORTER_DECLARANT"],
                  },
                )
                .select("id")
                .single();

            if (freshOrgError || !freshOrg) {
              throw new Error(
                `Failed to create fresh org: ${freshOrgError?.message}`,
              );
            }

            const freshOrgId =
              freshOrg.id;

            const { data: ownerUser, error: ownerUserError } =
              await serviceClient.auth.admin.createUser(
                {
                  email: `mgmt-owner-${runId}@example.com`,
                  password,
                  email_confirm: true,
                },
              );

            // Two separate MEMBER-level users: promotedMember gets
            // promoted then removed (exercising the OWNER's UPDATE and
            // DELETE authorization); plainMember stays MEMBER the
            // entire test, specifically to prove a plain MEMBER cannot
            // delete SOMEONE ELSE's row -- reusing promotedMember for
            // that check would be wrong once they've actually been
            // promoted to ADMIN (a real bug in an earlier draft of
            // this test: it asserted "still MEMBER-level" about a user
            // this same test had just promoted to ADMIN two steps
            // earlier, so the "denied" expectation was never true).
            const { data: promotedMember, error: promotedMemberError } =
              await serviceClient.auth.admin.createUser(
                {
                  email: `mgmt-promoted-${runId}@example.com`,
                  password,
                  email_confirm: true,
                },
              );

            const { data: plainMember, error: plainMemberError } =
              await serviceClient.auth.admin.createUser(
                {
                  email: `mgmt-plain-${runId}@example.com`,
                  password,
                  email_confirm: true,
                },
              );

            if (
              ownerUserError || !ownerUser.user ||
              promotedMemberError || !promotedMember.user ||
              plainMemberError || !plainMember.user
            ) {
              throw new Error(
                `Failed to create membership-mgmt test users: ${ownerUserError?.message ?? promotedMemberError?.message ?? plainMemberError?.message}`,
              );
            }

            const { error: membershipInsertError } =
              await serviceClient
                .from("memberships")
                .insert(
                  [
                    {
                      org_id: freshOrgId,
                      user_id: ownerUser.user.id,
                      role: "OWNER",
                    },
                    {
                      org_id: freshOrgId,
                      user_id: promotedMember.user.id,
                      role: "MEMBER",
                    },
                    {
                      org_id: freshOrgId,
                      user_id: plainMember.user.id,
                      role: "MEMBER",
                    },
                  ],
                )
                .select("id, role");

            if (membershipInsertError) {
              throw new Error(
                `Failed to create memberships: ${membershipInsertError.message}`,
              );
            }

            const { data: membershipRows, error: membershipRowsError } =
              await serviceClient
                .from("memberships")
                .select("id, user_id")
                .eq("org_id", freshOrgId);

            if (membershipRowsError || !membershipRows) {
              throw new Error(
                `Failed to look up membership rows: ${membershipRowsError?.message}`,
              );
            }

            const promotedMembershipId =
              membershipRows.find(
                (row) => row.user_id === promotedMember.user.id,
              )?.id;

            const plainMembershipId =
              membershipRows.find(
                (row) => row.user_id === plainMember.user.id,
              )?.id;

            if (!promotedMembershipId || !plainMembershipId) {
              throw new Error(
                "Failed to resolve membership row ids for the test users.",
              );
            }

            try {
              const clientOwner =
                await signInAnonClient(
                  `mgmt-owner-${runId}@example.com`,
                  password,
                );

              const clientPromoted =
                await signInAnonClient(
                  `mgmt-promoted-${runId}@example.com`,
                  password,
                );

              const clientPlain =
                await signInAnonClient(
                  `mgmt-plain-${runId}@example.com`,
                  password,
                );

              // A MEMBER cannot promote themselves -- RLS filters the
              // row out of the UPDATE's target set (zero rows
              // affected), not a permission error.
              const { data: selfPromoteResult, error: selfPromoteError } =
                await clientPromoted
                  .from("memberships")
                  .update(
                    { role: "OWNER" },
                  )
                  .eq("id", promotedMembershipId)
                  .select("id");

              expect(selfPromoteError).toBeNull();
              expect(selfPromoteResult).toHaveLength(0);

              // A different org's OWNER (userA, from the shared
              // fixtures) cannot touch this org's memberships either.
              const { data: crossOrgResult, error: crossOrgError } =
                await clientA
                  .from("memberships")
                  .update(
                    { role: "ADMIN" },
                  )
                  .eq("id", promotedMembershipId)
                  .select("id");

              expect(crossOrgError).toBeNull();
              expect(crossOrgResult).toHaveLength(0);

              // The OWNER of THIS org can change a member's role.
              const { data: promoted, error: promoteError } =
                await clientOwner
                  .from("memberships")
                  .update(
                    { role: "ADMIN" },
                  )
                  .eq("id", promotedMembershipId)
                  .select("role")
                  .single();

              expect(promoteError).toBeNull();
              expect(promoted?.role).toBe("ADMIN");

              // A plain MEMBER (never promoted) cannot remove a
              // DIFFERENT member's row either.
              const { data: memberDeleteResult, error: memberDeleteError } =
                await clientPlain
                  .from("memberships")
                  .delete()
                  .eq("id", promotedMembershipId)
                  .select("id");

              expect(memberDeleteError).toBeNull();
              expect(memberDeleteResult).toHaveLength(0);

              // The OWNER can remove the (now-ADMIN) member.
              const { data: removed, error: removeError } =
                await clientOwner
                  .from("memberships")
                  .delete()
                  .eq("id", promotedMembershipId)
                  .select("id");

              expect(removeError).toBeNull();
              expect(removed).toHaveLength(1);

              // The plain member's own row is untouched throughout.
              const { data: plainStillMember, error: plainStillMemberError } =
                await serviceClient
                  .from("memberships")
                  .select("role")
                  .eq("id", plainMembershipId)
                  .single();

              expect(plainStillMemberError).toBeNull();
              expect(plainStillMember?.role).toBe("MEMBER");

              // list_org_members (20260828120000): a member of this
              // org sees the remaining two members (owner + plain --
              // promotedMember was just removed) with correct emails.
              const { data: memberList, error: memberListError } =
                await clientOwner.rpc(
                  "list_org_members",
                  { p_org_id: freshOrgId },
                );

              expect(memberListError).toBeNull();
              expect(
                memberList
                  ?.map(
                    (row: { email: string }) => row.email,
                  )
                  .sort(),
              ).toEqual(
                [
                  `mgmt-owner-${runId}@example.com`,
                  `mgmt-plain-${runId}@example.com`,
                ].sort(),
              );

              // A stranger to this org (userA, from the shared
              // fixtures) cannot call it for this org at all -- the
              // function raises, it doesn't just return an empty list.
              const { error: strangerListError } =
                await clientA.rpc(
                  "list_org_members",
                  { p_org_id: freshOrgId },
                );

              expect(strangerListError).not.toBeNull();
            } finally {
              await serviceClient
                .from("memberships")
                .delete()
                .eq("org_id", freshOrgId);

              await serviceClient
                .from("organizations")
                .delete()
                .eq("id", freshOrgId);

              await serviceClient.auth.admin.deleteUser(
                ownerUser.user.id,
              );

              await serviceClient.auth.admin.deleteUser(
                promotedMember.user.id,
              );

              await serviceClient.auth.admin.deleteUser(
                plainMember.user.id,
              );
            }
          },
        );
      },
    );
  },
);

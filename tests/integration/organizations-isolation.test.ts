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
  createHmac,
} from "node:crypto";

import {
  changeMemberRole,
  reactivateMember,
  removeMember,
} from "../../src/application/organizations/manage-membership";

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

// Same "the equally-public default local JWT_SECRET" the two keys
// above are already derived from (`supabase status` prints it
// verbatim for a fresh local project) -- not a secret, meaningless
// outside a local, unauthenticated Docker network. Used ONLY to mint a
// raw session token below for the email-confirmation test, which
// deliberately does NOT go through any GoTrue grant flow (signUp/
// signInWithPassword) -- see that test's own comment for why.
const LOCAL_JWT_SECRET =
  process.env.SUPABASE_LOCAL_JWT_SECRET ??
  "super-secret-jwt-token-with-at-least-32-characters-long";

function base64UrlEncode(
  input: string | Buffer,
): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Mints a validly-signed (HS256, LOCAL_JWT_SECRET) session token for
 * `userId`/`email` directly, in the same shape a real GoTrue-issued
 * access token carries (aud/role "authenticated", sub, email, iat/exp)
 * -- WITHOUT calling any Auth endpoint. Exists for exactly one test:
 * GoTrue's own password-grant sign-in already refuses to issue a
 * session for a genuinely unconfirmed user locally (live-confirmed:
 * "Email not confirmed", even with enable_confirmations = false, which
 * only auto-confirms the ordinary signUp flow -- it does not weaken
 * the password-grant login check for a user created any other way,
 * e.g. via the admin API with email_confirm: false). That is a real
 * wall, but it is a property of ONE specific grant flow, not something
 * Postgres/PostgREST itself enforces -- exactly why
 * create_organization_with_owner needs its OWN independent, DB-level
 * check (20260829460000), matching the P11 review's own "regardless of
 * what enable_confirmations is set to" reasoning. This function
 * constructs the artifact that check must defend against on its own:
 * a validly-signed token for a real, genuinely-unconfirmed user,
 * indistinguishable at the PostgREST/Postgres layer from a token
 * issued by any other current or future grant flow.
 */
function mintRawSessionJwt(
  userId: string,
  email: string,
): string {
  const header = {
    alg: "HS256",
    typ: "JWT",
  };

  const nowSeconds =
    Math.floor(
      Date.now() / 1000,
    );

  const payload = {
    aud: "authenticated",
    role: "authenticated",
    sub: userId,
    email,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  };

  const signingInput =
    `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;

  const signature =
    createHmac("sha256", LOCAL_JWT_SECRET)
      .update(signingInput)
      .digest();

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

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

    // P13 adversarial audit, live-reproduced against real Postgres (see
    // 20260829460000_p13_review_onboarding_email_confirmation_hardening.sql's
    // own header comment): create_organization_with_owner's ONLY
    // precondition used to be `auth.uid() is null`, so a caller who
    // signed up with an email they never proved control of could
    // become OWNER of a brand-new organization under that identity.
    // This proves BOTH sides live: an unconfirmed caller is rejected,
    // with no organization/membership/audit-event row left behind, and
    // the SAME caller, once their email is confirmed, succeeds exactly
    // as before -- via the SAME token, since app.user_confirmed_email()
    // reads auth.users.email_confirmed_at live on every call rather
    // than trusting anything baked into the JWT.
    //
    // Uses mintRawSessionJwt() rather than signInAnonClient()
    // (password-grant sign-in) -- live-checked while writing this test:
    // GoTrue's own password-grant login already refuses to issue a
    // session for a genuinely unconfirmed user ("Email not confirmed"),
    // even with enable_confirmations = false (that flag only
    // auto-confirms the ordinary public signUp flow; it does not
    // relax the login check for a user left unconfirmed any other
    // way, e.g. admin-created with email_confirm: false). That is a
    // real wall, but it is specific to ONE grant flow and is not
    // something Postgres/PostgREST itself enforces -- which is exactly
    // why this RPC needs its own independent, DB-level check
    // (matching the P11 review's "regardless of what
    // enable_confirmations is set to" reasoning, applied here to the
    // login gate itself rather than just the config flag). This test
    // constructs the artifact that check must defend against on its
    // own: a validly-signed session for a real, genuinely-unconfirmed
    // user, indistinguishable at the Postgres layer from a token any
    // other current or future grant flow might issue.
    it(
      "the onboarding RPC rejects a caller whose email was never confirmed, and accepts the same caller once it is",
      async () => {
        const unconfirmedEmail =
          `isolation-unconfirmed-${runId}@example.com`;

        const unconfirmedPassword =
          `isolation-test-password-${runId}!`;

        const { data: unconfirmedUser, error: unconfirmedUserError } =
          await serviceClient.auth.admin.createUser(
            {
              email: unconfirmedEmail,
              password: unconfirmedPassword,
              // false (not omitted): explicitly leaves
              // email_confirmed_at null -- live-verified against this
              // local project.
              email_confirm: false,
            },
          );

        if (unconfirmedUserError || !unconfirmedUser.user) {
          throw new Error(
            `Failed to create unconfirmed user: ${unconfirmedUserError?.message}`,
          );
        }

        const unconfirmedUserId =
          unconfirmedUser.user.id;

        try {
          const clientUnconfirmed =
            createClient(
              LOCAL_API_URL,
              LOCAL_ANON_KEY,
              {
                auth: { persistSession: false },
                global: {
                  headers: {
                    Authorization:
                      `Bearer ${mintRawSessionJwt(unconfirmedUserId, unconfirmedEmail)}`,
                  },
                },
              },
            );

          const attemptedSlug =
            `unconfirmed-onboarding-attempt-${runId}`;

          const { data: rejectedOrg, error: rejectedError } =
            await clientUnconfirmed.rpc(
              "create_organization_with_owner",
              {
                p_name: `Unconfirmed Onboarding Attempt ${runId}`,
                p_slug: attemptedSlug,
                p_capabilities: ["IMPORTER_DECLARANT"],
              },
            );

          expect(rejectedOrg).toBeNull();
          expect(rejectedError).not.toBeNull();
          expect(
            rejectedError?.message.toLowerCase(),
          ).toContain(
            "confirm",
          );

          // Nothing was left behind by the rejected attempt -- no
          // half-created org, no membership, no audit event (the whole
          // insert sequence never started; the check runs before the
          // first INSERT).
          const { data: orgAfterRejection } =
            await serviceClient
              .from("organizations")
              .select("id")
              .eq("slug", attemptedSlug);

          expect(orgAfterRejection).toHaveLength(0);

          // Now confirm the SAME user's email (service-role admin API
          // -- the same mechanism a real confirmation-link click drives
          // in production) and retry with the SAME already-signed-in
          // client. No fresh sign-in is needed: the RPC's guard reads
          // auth.users.email_confirmed_at live via
          // app.user_confirmed_email(), not a JWT claim.
          const { error: confirmError } =
            await serviceClient.auth.admin.updateUserById(
              unconfirmedUserId,
              { email_confirm: true },
            );

          if (confirmError) {
            throw new Error(
              `Failed to confirm test user's email: ${confirmError.message}`,
            );
          }

          const confirmedSlug =
            `confirmed-onboarding-attempt-${runId}`;

          const { data: acceptedOrg, error: acceptedError } =
            await clientUnconfirmed.rpc(
              "create_organization_with_owner",
              {
                p_name: `Confirmed Onboarding Attempt ${runId}`,
                p_slug: confirmedSlug,
                p_capabilities: ["IMPORTER_DECLARANT"],
              },
            );

          expect(acceptedError).toBeNull();
          expect(acceptedOrg?.id).toBeDefined();

          const acceptedOrgId: string =
            acceptedOrg.id;

          const { data: membership, error: membershipError } =
            await serviceClient
              .from("memberships")
              .select("role")
              .eq("org_id", acceptedOrgId)
              .eq("user_id", unconfirmedUserId)
              .single();

          expect(membershipError).toBeNull();
          expect(membership?.role).toBe("OWNER");

          await serviceClient
            .from("audit_events")
            .delete()
            .eq("org_id", acceptedOrgId);

          await serviceClient
            .from("memberships")
            .delete()
            .eq("org_id", acceptedOrgId);

          await serviceClient
            .from("organizations")
            .delete()
            .eq("id", acceptedOrgId);
        } finally {
          await serviceClient.auth.admin.deleteUser(
            unconfirmedUserId,
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

              // list_org_members' shape gained deactivated_at
              // (20260829360000) -- null for everyone here, since
              // nobody in this org is deactivated. Asserted so the
              // column's absence would fail loudly rather than
              // silently rendering every member as "active" on the
              // Team screen.
              expect(
                memberList?.every(
                  (row: { deactivated_at: string | null }) =>
                    row.deactivated_at === null,
                ),
              ).toBe(true);
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

    // P10 review response (2026-08-29): BLOCKING finding #1 (both the
    // correctness review and this phase's own mandatory authorization
    // review, each independently reproduced live) and its SHOULD-FIX
    // sibling. changeMemberRole, removeMember, and reactivateMember all
    // used to report {status:"OK"} -- plus, for the two that write one,
    // a FABRICATED audit event -- when RLS silently filtered their
    // UPDATE/DELETE to zero rows because the caller wasn't ADMIN/OWNER.
    // The block above already proves RLS itself denies the write; this
    // block proves the thing neither review found any existing test
    // covering: that the *application service functions* -- the actual
    // code every Server Action in app/team/actions.ts calls -- now
    // notice the denial and refuse, rather than lying about it.
    describe(
      "membership service-layer CAS guards against RLS-blocked writes (P10 review response)",
      () => {
        it(
          "changeMemberRole/removeMember/reactivateMember report a rejection and write no audit event when an unauthorized caller's write is silently filtered to zero rows -- and the legitimate OWNER path still works",
          async () => {
            const password =
              `isolation-test-password-${runId}!`;

            const { data: freshOrg, error: freshOrgError } =
              await serviceClient
                .from("organizations")
                .insert(
                  {
                    name: `CAS Guard Org ${runId}`,
                    slug: `cas-guard-org-${runId}`,
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
                  email: `cas-owner-${runId}@example.com`,
                  password,
                  email_confirm: true,
                },
              );

            const { data: targetUser, error: targetUserError } =
              await serviceClient.auth.admin.createUser(
                {
                  email: `cas-target-${runId}@example.com`,
                  password,
                  email_confirm: true,
                },
              );

            const { data: deactivatedAdminUser, error: deactivatedAdminUserError } =
              await serviceClient.auth.admin.createUser(
                {
                  email: `cas-deactivated-admin-${runId}@example.com`,
                  password,
                  email_confirm: true,
                },
              );

            const { data: attackerUser, error: attackerUserError } =
              await serviceClient.auth.admin.createUser(
                {
                  email: `cas-attacker-${runId}@example.com`,
                  password,
                  email_confirm: true,
                },
              );

            if (
              ownerUserError || !ownerUser.user ||
              targetUserError || !targetUser.user ||
              deactivatedAdminUserError || !deactivatedAdminUser.user ||
              attackerUserError || !attackerUser.user
            ) {
              throw new Error(
                `Failed to create CAS-guard test users: ${ownerUserError?.message ?? targetUserError?.message ?? deactivatedAdminUserError?.message ?? attackerUserError?.message}`,
              );
            }

            // deactivated_at is set directly on insert (service-role,
            // bypasses RLS) rather than via deactivateMember -- this
            // test is about changeMemberRole/removeMember/
            // reactivateMember, not about how a row GOT deactivated.
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
                      user_id: targetUser.user.id,
                      role: "MEMBER",
                    },
                    {
                      org_id: freshOrgId,
                      user_id: deactivatedAdminUser.user.id,
                      role: "ADMIN",
                      deactivated_at: new Date().toISOString(),
                    },
                    {
                      org_id: freshOrgId,
                      user_id: attackerUser.user.id,
                      role: "MEMBER",
                    },
                  ],
                );

            if (membershipInsertError) {
              throw new Error(
                `Failed to create memberships: ${membershipInsertError.message}`,
              );
            }

            const { data: membershipRows, error: membershipRowsError } =
              await serviceClient
                .from("memberships")
                .select("id, user_id, role, deactivated_at")
                .eq("org_id", freshOrgId);

            if (membershipRowsError || !membershipRows) {
              throw new Error(
                `Failed to look up membership rows: ${membershipRowsError?.message}`,
              );
            }

            const targetMembershipId =
              membershipRows.find(
                (row) => row.user_id === targetUser.user.id,
              )?.id;

            const deactivatedAdminMembershipId =
              membershipRows.find(
                (row) => row.user_id === deactivatedAdminUser.user.id,
              )?.id;

            if (!targetMembershipId || !deactivatedAdminMembershipId) {
              throw new Error(
                "Failed to resolve membership row ids for the CAS-guard test.",
              );
            }

            try {
              const clientAttacker =
                await signInAnonClient(
                  `cas-attacker-${runId}@example.com`,
                  password,
                );

              // changeMemberRole: manage-membership.ts:121-134 before
              // this fix. Now takes a full OrgContext (2026-08-29, P13
              // audit fix -- only an OWNER may grant OWNER) -- the
              // attacker's real role (MEMBER) is what RLS itself
              // enforces against below; this context object doesn't
              // change what's under test here (newRole "ADMIN", not
              // "OWNER", never reaches the new caller-role check).
              const changeRoleResult =
                await changeMemberRole(
                  clientAttacker,
                  {
                    org_id: freshOrgId,
                    user_id: attackerUser.user.id,
                    role: "MEMBER",
                    capabilities: ["IMPORTER_DECLARANT"],
                  } as never,
                  targetMembershipId as never,
                  "ADMIN",
                );

              expect(changeRoleResult).toEqual(
                { status: "REJECTED", reason: "PERSIST_FAILED" },
              );

              const { data: targetAfterRoleAttempt } =
                await serviceClient
                  .from("memberships")
                  .select("role")
                  .eq("id", targetMembershipId)
                  .single();

              expect(targetAfterRoleAttempt?.role).toBe(
                "MEMBER",
              );

              // removeMember: manage-membership.ts:209-220 before this
              // fix.
              const removeResult =
                await removeMember(
                  clientAttacker,
                  freshOrgId as never,
                  targetMembershipId as never,
                );

              expect(removeResult).toEqual(
                { status: "REJECTED", reason: "PERSIST_FAILED" },
              );

              const { data: targetStillExists } =
                await serviceClient
                  .from("memberships")
                  .select("id")
                  .eq("id", targetMembershipId)
                  .maybeSingle();

              expect(targetStillExists?.id).toBe(
                targetMembershipId,
              );

              // reactivateMember: BLOCKING finding #1 --
              // manage-membership.ts:420-433 before this fix.
              const reactivateResult =
                await reactivateMember(
                  clientAttacker,
                  freshOrgId as never,
                  deactivatedAdminMembershipId as never,
                );

              expect(reactivateResult).toEqual(
                { status: "REJECTED", reason: "NOT_DEACTIVATED" },
              );

              const { data: adminAfterReactivateAttempt } =
                await serviceClient
                  .from("memberships")
                  .select("deactivated_at")
                  .eq("id", deactivatedAdminMembershipId)
                  .single();

              expect(adminAfterReactivateAttempt?.deactivated_at).not.toBeNull();

              // None of the three attempted writes above may have left
              // a trace in the audit log -- the whole point of this fix
              // is that a blocked write records nothing claiming
              // otherwise.
              const { data: auditEvents, error: auditEventsError } =
                await serviceClient
                  .from("audit_events")
                  .select("event_type")
                  .eq("org_id", freshOrgId)
                  .in(
                    "event_type",
                    [
                      "membership.role_changed",
                      "membership.removed",
                      "membership.reactivated",
                    ],
                  );

              expect(auditEventsError).toBeNull();
              expect(auditEvents).toHaveLength(0);

              // Sanity check the fix didn't also break the legitimate
              // path: the real OWNER reactivating the same ADMIN still
              // succeeds, and DOES record its audit event.
              const clientOwner =
                await signInAnonClient(
                  `cas-owner-${runId}@example.com`,
                  password,
                );

              const ownerReactivateResult =
                await reactivateMember(
                  clientOwner,
                  freshOrgId as never,
                  deactivatedAdminMembershipId as never,
                );

              expect(ownerReactivateResult).toEqual(
                { status: "OK" },
              );

              const { data: adminAfterOwnerReactivate } =
                await serviceClient
                  .from("memberships")
                  .select("deactivated_at")
                  .eq("id", deactivatedAdminMembershipId)
                  .single();

              expect(adminAfterOwnerReactivate?.deactivated_at).toBeNull();

              const { data: reactivatedAuditEvents, error: reactivatedAuditEventsError } =
                await serviceClient
                  .from("audit_events")
                  .select("event_type")
                  .eq("org_id", freshOrgId)
                  .eq("event_type", "membership.reactivated");

              expect(reactivatedAuditEventsError).toBeNull();
              expect(reactivatedAuditEvents).toHaveLength(1);
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
                targetUser.user.id,
              );

              await serviceClient.auth.admin.deleteUser(
                deactivatedAdminUser.user.id,
              );

              await serviceClient.auth.admin.deleteUser(
                attackerUser.user.id,
              );
            }
          },
        );
      },
    );

    // Master plan §14's deactivation lifecycle, live against real
    // Postgres. The claim under test is not "one table's policy
    // changed" but "app.user_org_ids() and
    // app.user_is_admin_or_owner_of() changed, and everything built on
    // them inherited it" -- so each probe below deliberately reaches a
    // DIFFERENT policy or function that consults one of the two
    // helpers, rather than exercising memberships (or any single
    // table) repeatedly:
    //
    //   app.user_org_ids()             -- organizations_select_own_org,
    //                                     memberships_select_own_org,
    //                                     audit_events_select_own_org,
    //                                     shipments_select_own_org,
    //                                     shipments_insert_own_org (a
    //                                     WRITE, not just a read), and
    //                                     public.list_org_members
    //   app.user_is_admin_or_owner_of()-- organizations_update_admin_or_owner
    //                                     and memberships_update_admin_or_owner
    //
    // list_org_members is the closest thing to a direct call available
    // here: supabase/config.toml exposes only the `public` and
    // `graphql_public` schemas to PostgREST, so `app.user_org_ids()`
    // itself is not reachable over the Data API at all, and widening
    // that config to reach it in a test would be a real expansion of
    // the product's public API surface. Since 20260829360000 that RPC's
    // caller gate IS a call to app.user_org_ids() and nothing else, so
    // its "Not a member of this organization." is the helper's own
    // answer with one function call in between.
    describe(
      "membership deactivation (20260829360000)",
      () => {
        const password =
          `isolation-test-password-${runId}!`;

        const ownerEmail =
          `deact-owner-${runId}@example.com`;

        const adminEmail =
          `deact-admin-${runId}@example.com`;

        const memberEmail =
          `deact-member-${runId}@example.com`;

        const spareEmail =
          `deact-spare-${runId}@example.com`;

        let deactOrgId: string;

        let ownerUserId: string;
        let adminUserId: string;
        let memberUserId: string;
        let spareUserId: string;

        let adminMembershipId: string;
        let memberMembershipId: string;
        let spareMembershipId: string;

        let clientOwner: SupabaseClient;
        let clientAdmin: SupabaseClient;
        let clientMember: SupabaseClient;

        let seedShipmentId: string;

        async function createUser(
          email: string,
        ): Promise<string> {
          const { data, error } =
            await serviceClient.auth.admin.createUser(
              {
                email,
                password,
                email_confirm: true,
              },
            );

          if (error || !data.user) {
            throw new Error(
              `Failed to create ${email}: ${error?.message}`,
            );
          }

          return data.user.id;
        }

        /**
         * Deactivation and reactivation both go through the OWNER's own
         * session, never the service role: that is itself part of what
         * is under test. 20260829360000 deliberately adds NO new
         * memberships UPDATE policy, on the argument that
         * memberships_update_admin_or_owner (20260828110000) is a
         * whole-row policy and already covers a column added later. If
         * that argument were wrong these calls would affect zero rows.
         */
        async function setDeactivatedAt(
          membershipId: string,
          value: string | null,
        ): Promise<void> {
          const { data, error } =
            await clientOwner
              .from("memberships")
              .update(
                { deactivated_at: value },
              )
              .eq("id", membershipId)
              .select("id, deactivated_at");

          expect(error).toBeNull();
          expect(data).toHaveLength(1);

          if (value === null) {
            expect(data?.[0].deactivated_at).toBeNull();
          } else {
            // Compared as instants, not strings: Postgres renders
            // timestamptz with a +00:00 offset where Date#toISOString
            // renders Z, so a string comparison fails on spelling
            // alone.
            expect(
              new Date(
                data![0].deactivated_at as string,
              ).toISOString(),
            ).toBe(
              value,
            );
          }
        }

        beforeAll(async () => {
          const { data: org, error: orgError } =
            await serviceClient
              .from("organizations")
              .insert(
                {
                  name: `Deactivation Org ${runId}`,
                  slug: `deactivation-org-${runId}`,
                  capabilities: ["IMPORTER_DECLARANT"],
                },
              )
              .select("id")
              .single();

          if (orgError || !org) {
            throw new Error(
              `Failed to create deactivation org: ${orgError?.message}`,
            );
          }

          deactOrgId = org.id;

          ownerUserId = await createUser(ownerEmail);
          adminUserId = await createUser(adminEmail);
          memberUserId = await createUser(memberEmail);
          spareUserId = await createUser(spareEmail);

          const { data: membershipRows, error: membershipError } =
            await serviceClient
              .from("memberships")
              .insert(
                [
                  {
                    org_id: deactOrgId,
                    user_id: ownerUserId,
                    role: "OWNER",
                  },
                  {
                    org_id: deactOrgId,
                    user_id: adminUserId,
                    role: "ADMIN",
                  },
                  {
                    org_id: deactOrgId,
                    user_id: memberUserId,
                    role: "MEMBER",
                  },
                  {
                    org_id: deactOrgId,
                    user_id: spareUserId,
                    role: "MEMBER",
                  },
                ],
              )
              .select("id, user_id");

          if (membershipError || !membershipRows) {
            throw new Error(
              `Failed to create deactivation memberships: ${membershipError?.message}`,
            );
          }

          adminMembershipId =
            membershipRows.find(
              (row) => row.user_id === adminUserId,
            )!.id;

          memberMembershipId =
            membershipRows.find(
              (row) => row.user_id === memberUserId,
            )!.id;

          spareMembershipId =
            membershipRows.find(
              (row) => row.user_id === spareUserId,
            )!.id;

          // Something for each read probe to find (and then fail to
          // find): one shipment and one audit event in this org.
          const { data: shipment, error: shipmentError } =
            await serviceClient
              .from("shipments")
              .insert(
                {
                  org_id: deactOrgId,
                  reference: `SHIP-DEACT-${runId}`,
                  release_date: "2026-03-15",
                  reporting_period_kind: "ANNUAL",
                  reporting_period_year: 2026,
                  status: "DRAFT",
                },
              )
              .select("id")
              .single();

          if (shipmentError || !shipment) {
            throw new Error(
              `Failed to create deactivation shipment: ${shipmentError?.message}`,
            );
          }

          seedShipmentId = shipment.id;

          const { error: auditError } =
            await serviceClient
              .from("audit_events")
              .insert(
                {
                  org_id: deactOrgId,
                  actor_type: "SYSTEM",
                  event_type: "deactivation_test.fixture_created",
                  aggregate_type: "ORGANIZATION",
                  aggregate_id: deactOrgId,
                  payload: {},
                },
              );

          if (auditError) {
            throw new Error(
              `Failed to create deactivation audit event: ${auditError.message}`,
            );
          }

          clientOwner =
            await signInAnonClient(
              ownerEmail,
              password,
            );

          clientAdmin =
            await signInAnonClient(
              adminEmail,
              password,
            );

          clientMember =
            await signInAnonClient(
              memberEmail,
              password,
            );
        });

        afterAll(async () => {
          await serviceClient
            .from("organization_invitations")
            .delete()
            .eq("org_id", deactOrgId);

          await serviceClient
            .from("audit_events")
            .delete()
            .eq("org_id", deactOrgId);

          await serviceClient
            .from("shipments")
            .delete()
            .eq("org_id", deactOrgId);

          await serviceClient
            .from("memberships")
            .delete()
            .eq("org_id", deactOrgId);

          await serviceClient
            .from("organizations")
            .delete()
            .eq("id", deactOrgId);

          for (
            const id of [ownerUserId, adminUserId, memberUserId, spareUserId]
          ) {
            await serviceClient.auth.admin.deleteUser(
              id,
            );
          }
        });

        it(
          "a deactivated member loses every read and write app.user_org_ids() gates, and reactivation restores them",
          async () => {
            // --- baseline: an active MEMBER can reach all of it ---
            const { data: orgsBefore } =
              await clientMember
                .from("organizations")
                .select("id")
                .eq("id", deactOrgId);

            expect(orgsBefore).toHaveLength(1);

            const { data: membershipsBefore } =
              await clientMember
                .from("memberships")
                .select("id")
                .eq("org_id", deactOrgId);

            expect(
              (membershipsBefore?.length ?? 0) > 0,
            ).toBe(true);

            const { data: auditBefore } =
              await clientMember
                .from("audit_events")
                .select("id")
                .eq("org_id", deactOrgId);

            expect(
              (auditBefore?.length ?? 0) > 0,
            ).toBe(true);

            const { data: shipmentsBefore } =
              await clientMember
                .from("shipments")
                .select("id")
                .eq("id", seedShipmentId);

            expect(shipmentsBefore).toHaveLength(1);

            const { error: listBeforeError } =
              await clientMember.rpc(
                "list_org_members",
                { p_org_id: deactOrgId },
              );

            expect(listBeforeError).toBeNull();

            const { data: writeBefore, error: writeBeforeError } =
              await clientMember
                .from("shipments")
                .insert(
                  {
                    org_id: deactOrgId,
                    reference: `SHIP-DEACT-BEFORE-${runId}`,
                    release_date: "2026-04-15",
                    reporting_period_kind: "ANNUAL",
                    reporting_period_year: 2026,
                    status: "DRAFT",
                  },
                )
                .select("id");

            expect(writeBeforeError).toBeNull();
            expect(writeBefore).toHaveLength(1);

            // --- deactivate, through the OWNER's own session ---
            await setDeactivatedAt(
              memberMembershipId,
              new Date().toISOString(),
            );

            // --- every one of those doors is now shut ---
            const { data: orgsAfter, error: orgsAfterError } =
              await clientMember
                .from("organizations")
                .select("id")
                .eq("id", deactOrgId);

            expect(orgsAfterError).toBeNull();
            expect(orgsAfter).toHaveLength(0);

            // Including their OWN membership row: the row still exists
            // (that is the entire point of deactivation over deletion)
            // and an active admin can still see it -- asserted below --
            // but its holder cannot, because memberships_select_own_org
            // is itself written in terms of app.user_org_ids().
            const { data: membershipsAfter, error: membershipsAfterError } =
              await clientMember
                .from("memberships")
                .select("id");

            expect(membershipsAfterError).toBeNull();
            expect(membershipsAfter).toHaveLength(0);

            const { data: auditAfter, error: auditAfterError } =
              await clientMember
                .from("audit_events")
                .select("id");

            expect(auditAfterError).toBeNull();
            expect(auditAfter).toHaveLength(0);

            const { data: shipmentsAfter, error: shipmentsAfterError } =
              await clientMember
                .from("shipments")
                .select("id");

            expect(shipmentsAfterError).toBeNull();
            expect(shipmentsAfter).toHaveLength(0);

            // The write path, not just reads: shipments_insert_own_org's
            // WITH CHECK consults the same helper, so this is refused
            // outright rather than filtered to zero rows.
            const { error: writeAfterError } =
              await clientMember
                .from("shipments")
                .insert(
                  {
                    org_id: deactOrgId,
                    reference: `SHIP-DEACT-AFTER-${runId}`,
                    release_date: "2026-04-16",
                    reporting_period_kind: "ANNUAL",
                    reporting_period_year: 2026,
                    status: "DRAFT",
                  },
                );

            expect(writeAfterError).not.toBeNull();

            // The helper itself, one function call away: list_org_members
            // raises rather than returning an empty list, so this
            // distinguishes "the helper excluded them" from "a policy
            // filtered the rows".
            const { error: listAfterError } =
              await clientMember.rpc(
                "list_org_members",
                { p_org_id: deactOrgId },
              );

            expect(listAfterError).not.toBeNull();

            // Nothing leaked sideways: the shipment they inserted while
            // active is still there, and the org still has its rows --
            // deactivation removed this person's access, not the data.
            const { data: stillThere } =
              await serviceClient
                .from("shipments")
                .select("id")
                .eq("org_id", deactOrgId);

            expect(
              (stillThere?.length ?? 0),
            ).toBe(2);

            // --- reactivate: everything comes back ---
            await setDeactivatedAt(
              memberMembershipId,
              null,
            );

            const { data: orgsRestored } =
              await clientMember
                .from("organizations")
                .select("id")
                .eq("id", deactOrgId);

            expect(orgsRestored).toHaveLength(1);

            const { data: shipmentsRestored } =
              await clientMember
                .from("shipments")
                .select("id");

            expect(shipmentsRestored).toHaveLength(2);

            const { error: listRestoredError } =
              await clientMember.rpc(
                "list_org_members",
                { p_org_id: deactOrgId },
              );

            expect(listRestoredError).toBeNull();

            const { data: auditRestored } =
              await clientMember
                .from("audit_events")
                .select("id");

            expect(
              (auditRestored?.length ?? 0) > 0,
            ).toBe(true);

            await serviceClient
              .from("shipments")
              .delete()
              .eq("id", writeBefore![0].id);
          },
        );

        it(
          "a deactivated ADMIN loses app.user_is_admin_or_owner_of() authority over memberships",
          async () => {
            // --- baseline: an active ADMIN holds this power ---
            const { data: promoteBefore, error: promoteBeforeError } =
              await clientAdmin
                .from("memberships")
                .update(
                  { role: "ADMIN" },
                )
                .eq("id", spareMembershipId)
                .select("id");

            expect(promoteBeforeError).toBeNull();
            expect(promoteBefore).toHaveLength(1);

            // --- deactivate the ADMIN ---
            await setDeactivatedAt(
              adminMembershipId,
              new Date().toISOString(),
            );

            // memberships_update_admin_or_owner, via app.user_is_admin_or_owner_of().
            const { data: demoteAfter, error: demoteAfterError } =
              await clientAdmin
                .from("memberships")
                .update(
                  { role: "MEMBER" },
                )
                .eq("id", spareMembershipId)
                .select("id");

            expect(demoteAfterError).toBeNull();
            expect(demoteAfter).toHaveLength(0);

            // Which includes un-deactivating themselves: the deactivated
            // admin cannot clear their own deactivated_at, or the state
            // would be trivially reversible by the person it was applied
            // to.
            const { data: selfRestore, error: selfRestoreError } =
              await clientAdmin
                .from("memberships")
                .update(
                  { deactivated_at: null },
                )
                .eq("id", adminMembershipId)
                .select("id");

            expect(selfRestoreError).toBeNull();
            expect(selfRestore).toHaveLength(0);

            // --- reactivate: the power returns ---
            await setDeactivatedAt(
              adminMembershipId,
              null,
            );

            const { data: demoteRestored } =
              await clientAdmin
                .from("memberships")
                .update(
                  { role: "MEMBER" },
                )
                .eq("id", spareMembershipId)
                .select("id");

            expect(demoteRestored).toHaveLength(1);
          },
        );

        it(
          "an ACTIVE ADMIN cannot update the organization row -- org profile (name, EORI, declarant status, capabilities) is OWNER-only per the master plan's role matrix (section 14: 'OWNER -- org profile/danger zone'), enforced at the application layer since the P13 audit (organization-profile.ts's own role check) but, until 20260829550000, still ADMIN-or-OWNER at the RLS level -- a gap this closes so a direct PostgREST write can never do what updateOrganizationProfile's own guard already refuses",
          async () => {
            const { data: adminAttempt, error: adminAttemptError } =
              await clientAdmin
                .from("organizations")
                .update(
                  { name: "Renamed by an active (non-deactivated) admin" },
                )
                .eq("id", deactOrgId)
                .select("id");

            expect(adminAttemptError).toBeNull();
            expect(adminAttempt).toHaveLength(0);

            const { data: orgRow } =
              await serviceClient
                .from("organizations")
                .select("name")
                .eq("id", deactOrgId)
                .single();

            expect(orgRow?.name).toBe(
              `Deactivation Org ${runId}`,
            );

            const { data: ownerAttempt, error: ownerAttemptError } =
              await clientOwner
                .from("organizations")
                .update(
                  { name: `Deactivation Org ${runId}` },
                )
                .eq("id", deactOrgId)
                .select("id");

            expect(ownerAttemptError).toBeNull();
            expect(ownerAttempt).toHaveLength(1);
          },
        );

        it(
          "a deactivated member stays visible to the org's active members, with deactivated_at set",
          async () => {
            // The deliberate asymmetry: only the two authorization
            // helpers exclude deactivated rows. SELECT is untouched, so
            // the Team screen can render "deactivated" and offer
            // reactivation, and the Audit screen can keep resolving a
            // departed actor's events to a person instead of a bare
            // uuid.
            const deactivatedAt =
              new Date().toISOString();

            await setDeactivatedAt(
              memberMembershipId,
              deactivatedAt,
            );

            const { data: rowFromOwner, error: rowFromOwnerError } =
              await clientOwner
                .from("memberships")
                .select("id, role, deactivated_at")
                .eq("id", memberMembershipId)
                .single();

            expect(rowFromOwnerError).toBeNull();
            expect(rowFromOwner?.role).toBe("MEMBER");
            expect(rowFromOwner?.deactivated_at).not.toBeNull();

            const { data: memberList, error: memberListError } =
              await clientOwner.rpc(
                "list_org_members",
                { p_org_id: deactOrgId },
              );

            expect(memberListError).toBeNull();

            const listedMember =
              (memberList ?? []).find(
                (row: { email: string }) => row.email === memberEmail,
              );

            expect(listedMember).toBeDefined();
            expect(listedMember.deactivated_at).not.toBeNull();

            const listedOwner =
              (memberList ?? []).find(
                (row: { email: string }) => row.email === ownerEmail,
              );

            expect(listedOwner.deactivated_at).toBeNull();

            await setDeactivatedAt(
              memberMembershipId,
              null,
            );
          },
        );

        it(
          "accepting an invitation while deactivated reports MEMBERSHIP_DEACTIVATED and leaves the invitation PENDING",
          async () => {
            const { data: invitation, error: invitationError } =
              await serviceClient
                .from("organization_invitations")
                .insert(
                  {
                    org_id: deactOrgId,
                    email: memberEmail,
                    role: "MEMBER",
                    invited_by: ownerUserId,
                  },
                )
                .select("id")
                .single();

            if (invitationError || !invitation) {
              throw new Error(
                `Failed to create invitation: ${invitationError?.message}`,
              );
            }

            await setDeactivatedAt(
              memberMembershipId,
              new Date().toISOString(),
            );

            const { data: deactivatedAccept, error: deactivatedAcceptError } =
              await clientMember.rpc(
                "accept_organization_invitation",
                { p_invitation_id: invitation.id },
              );

            expect(deactivatedAcceptError).toBeNull();
            expect(
              deactivatedAccept?.[0]?.result_status,
            ).toBe(
              "MEMBERSHIP_DEACTIVATED",
            );

            // The invitation is NOT consumed. Before 20260829360000 the
            // `exists (...)` guard classified this as ALREADY_MEMBER and
            // marked the row ACCEPTED, burning a valid invitation to
            // return someone to a Snowkap they still could not see
            // anything in.
            const { data: stillPending } =
              await serviceClient
                .from("organization_invitations")
                .select("status, accepted_at, accepted_by")
                .eq("id", invitation.id)
                .single();

            expect(stillPending?.status).toBe("PENDING");
            expect(stillPending?.accepted_at).toBeNull();
            expect(stillPending?.accepted_by).toBeNull();

            // And no second membership row was smuggled in alongside
            // the dormant one (memberships_org_user_uq would have
            // raised 23505 if the RPC had reached its INSERT).
            const { data: membershipRows } =
              await serviceClient
                .from("memberships")
                .select("id")
                .eq("org_id", deactOrgId)
                .eq("user_id", memberUserId);

            expect(membershipRows).toHaveLength(1);

            // Once an admin reactivates them, the invitation they still
            // hold resolves the ordinary way.
            await setDeactivatedAt(
              memberMembershipId,
              null,
            );

            const { data: reactivatedAccept } =
              await clientMember.rpc(
                "accept_organization_invitation",
                { p_invitation_id: invitation.id },
              );

            expect(
              reactivatedAccept?.[0]?.result_status,
            ).toBe(
              "ALREADY_MEMBER",
            );
          },
        );
      },
    );

    // P10 capability-matrix audit: inviteMember/revokeInvitation
    // (src/application/organizations/invitations.ts) carry no
    // application-layer role check of their own -- both functions'
    // own doc comments say enforcement is RLS-only
    // (organization_invitations_insert_admin_or_owner /
    // _update_admin_or_owner, 20260828130000), matching
    // manage-membership.ts's identical RLS-only posture. That RLS-only
    // claim had no standing test anywhere in this repo proving it
    // actually holds -- this closes that gap, live against real
    // Postgres, the same way "membership management" above proves
    // memberships_update_admin_or_owner/_delete_admin_or_owner.
    describe(
      "organization invitations (20260828130000)",
      () => {
        it(
          "a plain MEMBER cannot create or revoke an invitation; an ADMIN can do both",
          async () => {
            const password =
              `isolation-test-password-${runId}!`;

            const { data: inviteOrg, error: inviteOrgError } =
              await serviceClient
                .from("organizations")
                .insert(
                  {
                    name: `Invitations Org ${runId}`,
                    slug: `invitations-org-${runId}`,
                    capabilities: ["IMPORTER_DECLARANT"],
                  },
                )
                .select("id")
                .single();

            if (inviteOrgError || !inviteOrg) {
              throw new Error(
                `Failed to create invitations org: ${inviteOrgError?.message}`,
              );
            }

            const inviteOrgId =
              inviteOrg.id;

            const { data: ownerUser, error: ownerUserError } =
              await serviceClient.auth.admin.createUser(
                {
                  email: `invite-owner-${runId}@example.com`,
                  password,
                  email_confirm: true,
                },
              );

            const { data: adminUser, error: adminUserError } =
              await serviceClient.auth.admin.createUser(
                {
                  email: `invite-admin-${runId}@example.com`,
                  password,
                  email_confirm: true,
                },
              );

            const { data: memberUser, error: memberUserError } =
              await serviceClient.auth.admin.createUser(
                {
                  email: `invite-member-${runId}@example.com`,
                  password,
                  email_confirm: true,
                },
              );

            if (
              ownerUserError || !ownerUser.user ||
              adminUserError || !adminUser.user ||
              memberUserError || !memberUser.user
            ) {
              throw new Error(
                `Failed to create invitations-test users: ${ownerUserError?.message ?? adminUserError?.message ?? memberUserError?.message}`,
              );
            }

            const { error: membershipError } =
              await serviceClient
                .from("memberships")
                .insert(
                  [
                    { org_id: inviteOrgId, user_id: ownerUser.user.id, role: "OWNER" },
                    { org_id: inviteOrgId, user_id: adminUser.user.id, role: "ADMIN" },
                    { org_id: inviteOrgId, user_id: memberUser.user.id, role: "MEMBER" },
                  ],
                );

            if (membershipError) {
              throw new Error(
                `Failed to create invitations-test memberships: ${membershipError.message}`,
              );
            }

            try {
              const clientAdmin =
                await signInAnonClient(
                  `invite-admin-${runId}@example.com`,
                  password,
                );

              const clientMember =
                await signInAnonClient(
                  `invite-member-${runId}@example.com`,
                  password,
                );

              // A plain MEMBER cannot INSERT an invitation -- unlike an
              // UPDATE/DELETE's USING clause (which silently filters to
              // zero affected rows), a failing INSERT WITH CHECK is a
              // hard Postgres error (42501), so this is a thrown/
              // returned error, not an empty result.
              const { error: memberInsertError } =
                await clientMember
                  .from("organization_invitations")
                  .insert(
                    {
                      org_id: inviteOrgId,
                      email: `invite-target-member-attempt-${runId}@example.com`,
                      role: "MEMBER",
                      invited_by: memberUser.user.id,
                    },
                  );

              expect(memberInsertError).not.toBeNull();

              // An ADMIN can.
              const { data: created, error: adminInsertError } =
                await clientAdmin
                  .from("organization_invitations")
                  .insert(
                    {
                      org_id: inviteOrgId,
                      email: `invite-target-${runId}@example.com`,
                      role: "MEMBER",
                      invited_by: adminUser.user.id,
                    },
                  )
                  .select("id, status")
                  .single();

              expect(adminInsertError).toBeNull();
              expect(created?.status).toBe("PENDING");

              const invitationId =
                created!.id;

              // The MEMBER cannot revoke it either -- USING excludes
              // the row from the UPDATE's target set entirely (zero
              // rows affected, no error), the same shape as every
              // other ADMIN/OWNER-gated UPDATE policy in this suite.
              const { data: memberRevokeResult, error: memberRevokeError } =
                await clientMember
                  .from("organization_invitations")
                  .update(
                    { status: "REVOKED" },
                  )
                  .eq("id", invitationId)
                  .select("id");

              expect(memberRevokeError).toBeNull();
              expect(memberRevokeResult).toHaveLength(0);

              const { data: stillPending } =
                await serviceClient
                  .from("organization_invitations")
                  .select("status")
                  .eq("id", invitationId)
                  .single();

              expect(stillPending?.status).toBe("PENDING");

              // The ADMIN who created it (or any ADMIN/OWNER of this
              // org) can revoke it.
              const { data: revoked, error: adminRevokeError } =
                await clientAdmin
                  .from("organization_invitations")
                  .update(
                    { status: "REVOKED" },
                  )
                  .eq("id", invitationId)
                  .select("id, status");

              expect(adminRevokeError).toBeNull();
              expect(revoked).toHaveLength(1);
              expect(revoked?.[0]?.status).toBe("REVOKED");
            } finally {
              await serviceClient
                .from("organization_invitations")
                .delete()
                .eq("org_id", inviteOrgId);

              await serviceClient
                .from("memberships")
                .delete()
                .eq("org_id", inviteOrgId);

              await serviceClient
                .from("organizations")
                .delete()
                .eq("id", inviteOrgId);

              for (
                const user of [ownerUser.user, adminUser.user, memberUser.user]
              ) {
                await serviceClient.auth.admin.deleteUser(
                  user.id,
                );
              }
            }
          },
        );
      },
    );
  },
);

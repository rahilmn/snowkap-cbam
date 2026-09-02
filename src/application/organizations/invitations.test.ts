import {
  describe,
  expect,
  it,
} from "vitest";

import {
  acceptInvitation,
  countMyPendingInvitations,
  inviteMember,
  listMyPendingInvitations,
  listPendingInvitationsForOrg,
  revokeInvitation,
} from "./invitations";

const orgId =
  "org-1" as never;

const invitationId =
  "inv-1" as never;

// 2026-09-03 (P14, F5). revokeInvitation now takes an OrgContext: it
// checks the caller's role, pins the write to the ACTIVE organization,
// and attributes the audit event it writes.
const adminContext =
  {
    org_id: "org-1",
    user_id: "u-1",
    role: "ADMIN",
    capabilities: ["IMPORTER_DECLARANT"],
  } as never;

const memberContext =
  {
    org_id: "org-1",
    user_id: "u-2",
    role: "MEMBER",
    capabilities: ["IMPORTER_DECLARANT"],
  } as never;

function mockUserScopedSupabase(
  {
    insertResult,
    updateError = null,
    updateRowsAffected = 1,
    selectResult,
  }: {
    insertResult?: { data: unknown; error: unknown };
    updateError?: unknown;
    updateRowsAffected?: number;
    selectResult?: { data: unknown[] | null; error: unknown };
    selectFilters?: [string, unknown][];
  },
) {
  const selectFilters =
    arguments[0].selectFilters ?? [];

  return {
    auth: {
      getUser: () =>
        Promise.resolve(
          { data: { user: { id: "u-1" } } },
        ),
    },

    from: () => (
      {
        insert: () => (
          {
            select: () => (
              {
                single: () =>
                  Promise.resolve(
                    insertResult,
                  ),
              }
            ),
          }
        ),

        // 2026-09-03 (P14, F5): three .eq() calls now -- id, org_id and
        // status -- because the update is pinned to the ACTIVE
        // organization as well as to the row.
        update: () => (
          {
            eq: () => (
              {
                eq: () => (
                  {
                    eq: () => (
                      {
                        select: () =>
                          Promise.resolve(
                            {
                              data:
                                updateError
                                  ? null
                                  : Array.from(
                                      { length: updateRowsAffected },
                                      () => (
                                        {
                                          id: "row",
                                          email: "invitee@example.com",
                                          role: "MEMBER",
                                        }
                                      ),
                                    ),
                              error: updateError,
                            },
                          ),
                      }
                    ),
                  }
                ),
              }
            ),
          }
        ),

        select: (
          _columns?: unknown,
          options?: { count?: string; head?: boolean },
        ) => {
          const chain: Record<string, unknown> = {
            eq: (column: string, value: unknown) => {
              selectFilters.push([column, value]);
              return chain;
            },

            order: () =>
              Promise.resolve(
                selectResult,
              ),

            // head + count (countMyPendingInvitations) resolves the
            // builder itself rather than going through .order().
            then: (
              resolve: (value: unknown) => unknown,
              reject: (reason: unknown) => unknown,
            ) =>
              Promise.resolve(
                options?.head
                  ? {
                      count:
                        Array.isArray(selectResult?.data)
                          ? selectResult.data.length
                          : 0,
                      error: selectResult?.error ?? null,
                    }
                  : selectResult,
              ).then(resolve, reject),
          };

          return chain;
        },
      }
    ),
  } as never;
}

function mockAdminSupabase(
  inviteError: unknown = null,
  options: {
    magicLinkError?: unknown;
    calls?: { signInWithOtp: unknown[] };
  } = {},
) {
  return {
    auth: {
      admin: {
        inviteUserByEmail: () =>
          Promise.resolve(
            { data: {}, error: inviteError },
          ),
      },

      signInWithOtp: (args: unknown) => {
        options.calls?.signInWithOtp.push(args);

        return Promise.resolve(
          { data: {}, error: options.magicLinkError ?? null },
        );
      },
    },
  } as never;
}

function mockRpcSupabase(
  rpcResult: { data: unknown; error: unknown },
) {
  return {
    rpc: () =>
      Promise.resolve(
        rpcResult,
      ),
  } as never;
}

describe(
  "inviteMember",
  () => {
    it(
      "creates the invitation and reports OK when the email sends",
      async () => {
        const result =
          await inviteMember(
            mockUserScopedSupabase(
              {
                insertResult: {
                  data: { id: invitationId },
                  error: null,
                },
              },
            ),
            mockAdminSupabase(),
            {
              orgId,
              email: "New.Member@Example.com",
              role: "MEMBER",
              redirectTo: "http://localhost:3000/accept-invitation",
            },
          );

        expect(result).toEqual(
          { status: "OK", invitationId },
        );
      },
    );

    it(
      "still reports the invitation as created when the email send fails",
      async () => {
        const result =
          await inviteMember(
            mockUserScopedSupabase(
              {
                insertResult: {
                  data: { id: invitationId },
                  error: null,
                },
              },
            ),
            mockAdminSupabase(
              { message: "user already registered" },
            ),
            {
              orgId,
              email: "existing@example.com",
              role: "MEMBER",
              redirectTo: "http://localhost:3000/accept-invitation",
            },
          );

        expect(result).toEqual(
          { status: "OK_EMAIL_NOT_SENT", invitationId },
        );
      },
    );

    it(
      "returns ALREADY_PENDING on a unique-constraint violation",
      async () => {
        const result =
          await inviteMember(
            mockUserScopedSupabase(
              {
                insertResult: {
                  data: null,
                  error: { code: "23505", message: "duplicate" },
                },
              },
            ),
            mockAdminSupabase(),
            {
              orgId,
              email: "pending@example.com",
              role: "MEMBER",
              redirectTo: "http://localhost:3000/accept-invitation",
            },
          );

        expect(result).toEqual(
          { status: "ALREADY_PENDING" },
        );
      },
    );

    it(
      "returns INSERT_FAILED on any other insert error (e.g. RLS denial)",
      async () => {
        const result =
          await inviteMember(
            mockUserScopedSupabase(
              {
                insertResult: {
                  data: null,
                  error: { code: "42501", message: "denied" },
                },
              },
            ),
            mockAdminSupabase(),
            {
              orgId,
              email: "nope@example.com",
              role: "MEMBER",
              redirectTo: "http://localhost:3000/accept-invitation",
            },
          );

        expect(result).toEqual(
          { status: "INSERT_FAILED" },
        );
      },
    );
  },
);

describe(
  "revokeInvitation",
  () => {
    it(
      "reports OK when the update succeeds",
      async () => {
        const result =
          await revokeInvitation(
            mockUserScopedSupabase(
              { updateError: null },
            ),
            adminContext,
            invitationId,
          );

        expect(result).toEqual(
          { status: "OK" },
        );
      },
    );

    it(
      "reports PERSIST_FAILED when the update errors",
      async () => {
        const result =
          await revokeInvitation(
            mockUserScopedSupabase(
              { updateError: { message: "denied" } },
            ),
            adminContext,
            invitationId,
          );

        expect(result).toEqual(
          { status: "PERSIST_FAILED" },
        );
      },
    );

    it(
      "refuses a MEMBER outright, rather than reporting a generic failure (P14, F5)",
      async () => {
        // RLS already blocked this, so it was never a security hole --
        // but a MEMBER got PERSIST_FAILED, which the UI renders as
        // "something went wrong. Please try again." for a refusal that
        // will never succeed on retry. Naming it lets the screen say
        // who actually can.
        const result =
          await revokeInvitation(
            mockUserScopedSupabase(
              { updateError: null },
            ),
            memberContext,
            invitationId,
          );

        expect(result).toEqual(
          { status: "PERMISSION_DENIED" },
        );
      },
    );

    it(
      "reports PERSIST_FAILED when the update affects zero rows (RLS blocked an unauthorized caller, or the invitation was no longer PENDING)",
      async () => {
        // P10 review, NIT #7, 2026-08-29: PostgREST reports no error
        // for an UPDATE silently filtered to zero rows, so this used to
        // report OK for a revoke that never happened.
        const result =
          await revokeInvitation(
            mockUserScopedSupabase(
              { updateError: null, updateRowsAffected: 0 },
            ),
            adminContext,
            invitationId,
          );

        expect(result).toEqual(
          { status: "PERSIST_FAILED" },
        );
      },
    );
  },
);

describe(
  "acceptInvitation",
  () => {
    it(
      "maps OK",
      async () => {
        const result =
          await acceptInvitation(
            mockRpcSupabase(
              {
                data: [{ result_status: "OK", result_org_id: orgId }],
                error: null,
              },
            ),
            invitationId,
          );

        expect(result).toEqual(
          { status: "OK", orgId },
        );
      },
    );

    it(
      "maps ALREADY_MEMBER",
      async () => {
        const result =
          await acceptInvitation(
            mockRpcSupabase(
              {
                data: [{ result_status: "ALREADY_MEMBER", result_org_id: orgId }],
                error: null,
              },
            ),
            invitationId,
          );

        expect(result).toEqual(
          { status: "ALREADY_MEMBER", orgId },
        );
      },
    );

    it(
      "maps MEMBERSHIP_DEACTIVATED to its own status, not to ALREADY_MEMBER or NOT_FOUND",
      async () => {
        // An unmapped status falls through to NOT_FOUND ("That
        // invitation could not be found"), which for this one would be
        // a lie -- the invitation is valid and the RPC deliberately
        // leaves it PENDING (20260829360000 §7).
        const result =
          await acceptInvitation(
            mockRpcSupabase(
              {
                data: [{ result_status: "MEMBERSHIP_DEACTIVATED", result_org_id: orgId }],
                error: null,
              },
            ),
            invitationId,
          );

        expect(result).toEqual(
          { status: "MEMBERSHIP_DEACTIVATED", orgId },
        );
      },
    );

    it(
      "maps EXPIRED",
      async () => {
        const result =
          await acceptInvitation(
            mockRpcSupabase(
              {
                data: [{ result_status: "EXPIRED", result_org_id: orgId }],
                error: null,
              },
            ),
            invitationId,
          );

        expect(result).toEqual(
          { status: "EXPIRED" },
        );
      },
    );

    it(
      "maps EMAIL_MISMATCH",
      async () => {
        const result =
          await acceptInvitation(
            mockRpcSupabase(
              {
                data: [{ result_status: "EMAIL_MISMATCH", result_org_id: orgId }],
                error: null,
              },
            ),
            invitationId,
          );

        expect(result).toEqual(
          { status: "EMAIL_MISMATCH" },
        );
      },
    );

    it(
      "maps NOT_FOUND when the RPC errors",
      async () => {
        const result =
          await acceptInvitation(
            mockRpcSupabase(
              { data: null, error: { message: "boom" } },
            ),
            invitationId,
          );

        expect(result).toEqual(
          { status: "NOT_FOUND" },
        );
      },
    );
  },
);

describe(
  "listPendingInvitationsForOrg",
  () => {
    it(
      "maps rows to Invitation objects",
      async () => {
        const result =
          await listPendingInvitationsForOrg(
            mockUserScopedSupabase(
              {
                selectResult: {
                  data: [
                    {
                      id: invitationId,
                      org_id: orgId,
                      email: "member@example.com",
                      role: "MEMBER",
                      status: "PENDING",
                      invited_by: "u-1",
                      created_at: "2026-01-01T00:00:00Z",
                      expires_at: "2026-01-08T00:00:00Z",
                    },
                  ],
                  error: null,
                },
              },
            ),
            orgId,
          );

        expect(result).toEqual(
          [
            {
              id: invitationId,
              org_id: orgId,
              email: "member@example.com",
              role: "MEMBER",
              status: "PENDING",
              invited_by: "u-1",
              created_at: "2026-01-01T00:00:00Z",
              expires_at: "2026-01-08T00:00:00Z",
            },
          ],
        );
      },
    );

    it(
      "returns an empty array on error",
      async () => {
        const result =
          await listPendingInvitationsForOrg(
            mockUserScopedSupabase(
              {
                selectResult: { data: null, error: { message: "boom" } },
              },
            ),
            orgId,
          );

        expect(result).toEqual(
          [],
        );
      },
    );
  },
);

describe(
  "inviteMember when the address already has an account (P14)",
  () => {
    /**
     * admin.inviteUserByEmail exists to PROVISION accounts, so it refuses
     * an address that already has a confirmed one (422 email_exists).
     * Until 2026-09-03 that meant the invitation row was created and the
     * invitee was told nothing at all -- no mail was sent, and the only
     * way they would learn of the invitation was somebody telling them
     * out of band to visit a URL.
     *
     * Confirmed against real GoTrue in
     * tests/integration/auth-email-links.test.ts, which asserts both the
     * email_exists refusal and that the magic link that replaces it
     * verifies into a session.
     */
    it(
      "sends a magic link instead, scoped so it can never provision an account",
      async () => {
        const calls =
          { signInWithOtp: [] as unknown[] };

        const result =
          await inviteMember(
            mockUserScopedSupabase(
              {
                insertResult: { data: { id: invitationId }, error: null },
              },
            ),
            mockAdminSupabase(
              { code: "email_exists" },
              { calls },
            ),
            {
              orgId,
              email: "existing@example.com",
              role: "MEMBER",
              redirectTo: "http://localhost:3000/auth/callback?next=/accept-invitation",
            },
          );

        expect(result).toEqual(
          { status: "OK_MAGIC_LINK_SENT", invitationId },
        );

        expect(calls.signInWithOtp).toEqual(
          [
            {
              email: "existing@example.com",
              options: {
                emailRedirectTo:
                  "http://localhost:3000/auth/callback?next=/accept-invitation",
                shouldCreateUser: false,
              },
            },
          ],
        );
      },
    );

    it(
      "does NOT send a magic link for any other send failure -- this is a specific remedy, not a general fallback",
      async () => {
        // Mailing a sign-in credential is a real capability handed to an
        // org admin. It is warranted when the invitee demonstrably has an
        // account and would otherwise hear nothing; it is not warranted
        // because the mail server hiccuped.
        const calls =
          { signInWithOtp: [] as unknown[] };

        const result =
          await inviteMember(
            mockUserScopedSupabase(
              {
                insertResult: { data: { id: invitationId }, error: null },
              },
            ),
            mockAdminSupabase(
              { code: "unexpected_failure" },
              { calls },
            ),
            {
              orgId,
              email: "someone@example.com",
              role: "MEMBER",
              redirectTo: "http://localhost:3000/auth/callback",
            },
          );

        expect(result).toEqual(
          { status: "OK_EMAIL_NOT_SENT", invitationId },
        );

        expect(calls.signInWithOtp).toEqual(
          [],
        );
      },
    );

    it(
      "falls back to OK_EMAIL_NOT_SENT when the magic link itself is refused, e.g. by the hosted per-address interval",
      async () => {
        const result =
          await inviteMember(
            mockUserScopedSupabase(
              {
                insertResult: { data: { id: invitationId }, error: null },
              },
            ),
            mockAdminSupabase(
              { code: "email_exists" },
              { magicLinkError: { code: "over_email_send_rate_limit" } },
            ),
            {
              orgId,
              email: "existing@example.com",
              role: "MEMBER",
              redirectTo: "http://localhost:3000/auth/callback",
            },
          );

        expect(result).toEqual(
          { status: "OK_EMAIL_NOT_SENT", invitationId },
        );
      },
    );
  },
);

describe(
  "listMyPendingInvitations",
  () => {
    it(
      "maps rows including the embedded organization name",
      async () => {
        const result =
          await listMyPendingInvitations(
            mockUserScopedSupabase(
              {
                selectResult: {
                  data: [
                    {
                      id: invitationId,
                      org_id: orgId,
                      email: "me@example.com",
                      role: "ADMIN",
                      status: "PENDING",
                      invited_by: "u-1",
                      created_at: "2026-01-01T00:00:00Z",
                      expires_at: "2026-01-08T00:00:00Z",
                      organizations: { name: "Acme Importers" },
                    },
                  ],
                  error: null,
                },
              },
            ),
            "me@example.com",
          );

        expect(result).toEqual(
          [
            {
              invitation: {
                id: invitationId,
                org_id: orgId,
                email: "me@example.com",
                role: "ADMIN",
                status: "PENDING",
                invited_by: "u-1",
                created_at: "2026-01-01T00:00:00Z",
                expires_at: "2026-01-08T00:00:00Z",
              },
              organizationName: "Acme Importers",
            },
          ],
        );
      },
    );

    /**
     * 2026-09-03 (P14). This table carries TWO permissive SELECT
     * policies, and Postgres OR-combines them: one for invitations
     * addressed to the caller, one for invitations issued by an org the
     * caller administers. Leaving the scoping to RLS therefore showed an
     * ADMIN or OWNER every PENDING invitation their OWN organization had
     * sent to other people, rendered on /accept-invitation as though
     * addressed to them, behind an Accept button that can only ever fail
     * EMAIL_MISMATCH.
     *
     * Verified against real RLS on 2026-09-03 with a rolled-back probe:
     * an org OWNER querying status = 'PENDING' saw an invitation
     * addressed to someone-else@example.com. Observable in production --
     * ABC's owner sees a phantom row for the invitation addressed to
     * rahil.naik@powerweave.com.
     *
     * The sibling listMyPendingSharingGrantInvitations
     * (manage-sharing-grants.ts) already documents and fixes this exact
     * class; these pin the same fix here.
     */
    it(
      "filters on the caller's own email explicitly, so an admin never sees their own org's outgoing invitations as if addressed to them",
      async () => {
        const selectFilters: [string, unknown][] =
          [];

        await listMyPendingInvitations(
          mockUserScopedSupabase(
            {
              selectResult: { data: [], error: null },
              selectFilters,
            },
          ),
          "Me@Example.com  ",
        );

        expect(selectFilters).toContainEqual(
          ["status", "PENDING"],
        );

        // Normalized: invitations are stored lower-cased by inviteMember,
        // and the RLS policy compares lower(email) to the caller's
        // confirmed email.
        expect(selectFilters).toContainEqual(
          ["email", "me@example.com"],
        );
      },
    );

    it(
      "returns nothing, without querying, when the caller has no confirmed email",
      async () => {
        const selectFilters: [string, unknown][] =
          [];

        const result =
          await listMyPendingInvitations(
            mockUserScopedSupabase(
              {
                selectResult: { data: [], error: null },
                selectFilters,
              },
            ),
            "",
          );

        expect(result).toEqual(
          [],
        );

        expect(selectFilters).toEqual(
          [],
        );
      },
    );
  },
);

describe(
  "countMyPendingInvitations",
  () => {
    it(
      "counts only invitations addressed to the caller",
      async () => {
        const selectFilters: [string, unknown][] =
          [];

        const count =
          await countMyPendingInvitations(
            mockUserScopedSupabase(
              {
                selectResult: {
                  data: [{ id: "a" }, { id: "b" }],
                  error: null,
                },
                selectFilters,
              },
            ),
            "me@example.com",
          );

        expect(count).toBe(
          2,
        );

        expect(selectFilters).toContainEqual(
          ["email", "me@example.com"],
        );

        expect(selectFilters).toContainEqual(
          ["status", "PENDING"],
        );
      },
    );

    it(
      "reports zero rather than throwing when the count query fails, so a shell badge can never break the page",
      async () => {
        const count =
          await countMyPendingInvitations(
            mockUserScopedSupabase(
              {
                selectResult: {
                  data: null,
                  error: { message: "boom" },
                },
              },
            ),
            "me@example.com",
          );

        expect(count).toBe(
          0,
        );
      },
    );

    it(
      "reports zero, without querying, when the caller has no confirmed email",
      async () => {
        const selectFilters: [string, unknown][] =
          [];

        const count =
          await countMyPendingInvitations(
            mockUserScopedSupabase(
              {
                selectResult: { data: [{ id: "a" }], error: null },
                selectFilters,
              },
            ),
            "   ",
          );

        expect(count).toBe(
          0,
        );

        expect(selectFilters).toEqual(
          [],
        );
      },
    );
  },
);

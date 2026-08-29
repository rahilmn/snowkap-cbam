import {
  describe,
  expect,
  it,
} from "vitest";

import {
  acceptInvitation,
  inviteMember,
  listMyPendingInvitations,
  listPendingInvitationsForOrg,
  revokeInvitation,
} from "./invitations";

const orgId =
  "org-1" as never;

const invitationId =
  "inv-1" as never;

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
    selectResult?: { data: unknown; error: unknown };
  },
) {
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

        update: () => (
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
                                  () => ({ id: "row" }),
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

        select: () => (
          {
            eq: () => (
              {
                eq: () => (
                  {
                    order: () =>
                      Promise.resolve(
                        selectResult,
                      ),
                  }
                ),

                order: () =>
                  Promise.resolve(
                    selectResult,
                  ),
              }
            ),
          }
        ),
      }
    ),
  } as never;
}

function mockAdminSupabase(
  inviteError: unknown = null,
) {
  return {
    auth: {
      admin: {
        inviteUserByEmail: () =>
          Promise.resolve(
            { data: {}, error: inviteError },
          ),
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
            invitationId,
          );

        expect(result).toEqual(
          { status: "PERSIST_FAILED" },
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
  },
);

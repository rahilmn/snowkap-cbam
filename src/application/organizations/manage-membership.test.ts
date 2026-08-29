import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  changeMemberRole,
  deactivateMember,
  reactivateMember,
  removeMember,
} from "./manage-membership";

function chainableSelect(
  result: { data: unknown; error: unknown },
) {
  return {
    eq: () => Promise.resolve(result),
  };
}

/**
 * A thenable that is ALSO chainable via .is().select(), .not().select(),
 * or a bare .select() -- all four membership services now end their
 * UPDATE with a .select("id") row-count guard (P10 review response,
 * 2026-08-29: changeMemberRole and reactivateMember previously stopped
 * at .eq(), which is exactly the false-OK-on-a-blocked-write gap that
 * review found), and deactivateMember/reactivateMember additionally CAS
 * on deactivated_at via .is()/.not() respectively. All three shapes
 * have to be exercised here, or the mock would be testing a simplified
 * stand-in for the real call chain rather than the chain itself.
 *
 * `casRowsAffected: 0` is the lost-race / blocked-write case: PostgREST
 * reports no error for an UPDATE that matched nothing, so the empty
 * array is the only signal the guard fired.
 */
function chainableUpdate(
  error: unknown,
  casRowsAffected: number,
) {
  const selectResult = () =>
    Promise.resolve(
      {
        data:
          error
            ? null
            : Array.from(
                { length: casRowsAffected },
                () => ({ id: "updated-row" }),
              ),
        error,
      },
    );

  return Object.assign(
    Promise.resolve(
      { error },
    ),
    {
      is: () => (
        {
          select: selectResult,
        }
      ),
      not: () => (
        {
          select: selectResult,
        }
      ),
      select: selectResult,
    },
  );
}

/**
 * Same shape as chainableUpdate above, for removeMember's DELETE --
 * that call gained the identical .select("id") + zero-rows guard in the
 * same fix (P10 review response, 2026-08-29).
 */
function chainableDelete(
  error: unknown,
  rowsAffected: number,
) {
  return Object.assign(
    Promise.resolve(
      { error },
    ),
    {
      select: () =>
        Promise.resolve(
          {
            data:
              error
                ? null
                : Array.from(
                    { length: rowsAffected },
                    () => ({ id: "deleted-row" }),
                  ),
            error,
          },
        ),
    },
  );
}

function mockSupabase(
  {
    selectResult,
    updateError = null,
    deleteError = null,
    casRowsAffected = 1,
    deleteRowsAffected = 1,
    onAuditInsert,
    onUpdate,
  }: {
    selectResult: { data: unknown; error: unknown };
    updateError?: unknown;
    deleteError?: unknown;
    casRowsAffected?: number;
    deleteRowsAffected?: number;
    onAuditInsert?: (payload: unknown) => void;
    onUpdate?: (patch: unknown) => void;
  },
) {
  return {
    auth: {
      getUser: () =>
        Promise.resolve(
          { data: { user: { id: "actor-1" } } },
        ),
    },

    from: (
      table: string,
    ) => (
      table === "audit_events"
        ? {
            insert: (
              payload: unknown,
            ) => {
              onAuditInsert?.(
                payload,
              );

              return Promise.resolve(
                { error: null },
              );
            },
          }
        : {
            select: () =>
              chainableSelect(
                selectResult,
              ),

            update: (
              patch: unknown,
            ) => (
              {
                eq: () => {
                  onUpdate?.(
                    patch,
                  );

                  return chainableUpdate(
                    updateError,
                    casRowsAffected,
                  );
                },
              }
            ),

            delete: () => (
              {
                eq: () =>
                  chainableDelete(
                    deleteError,
                    deleteRowsAffected,
                  ),
              }
            ),
          }
    ),
  } as never;
}

const orgId =
  "org-1" as never;

const twoOwners =
  {
    data: [
      {
        id: "m-1",
        org_id: "org-1",
        user_id: "u-1",
        role: "OWNER",
        created_at: "2026-01-01T00:00:00Z",
        deactivated_at: null,
      },
      {
        id: "m-2",
        org_id: "org-1",
        user_id: "u-2",
        role: "OWNER",
        created_at: "2026-01-01T00:00:00Z",
        deactivated_at: null,
      },
    ],
    error: null,
  };

const oneOwnerOneMember =
  {
    data: [
      {
        id: "m-1",
        org_id: "org-1",
        user_id: "u-1",
        role: "OWNER",
        created_at: "2026-01-01T00:00:00Z",
        deactivated_at: null,
      },
      {
        id: "m-2",
        org_id: "org-1",
        user_id: "u-2",
        role: "MEMBER",
        created_at: "2026-01-01T00:00:00Z",
        deactivated_at: null,
      },
    ],
    error: null,
  };

const oneOwnerOneDeactivatedMember =
  {
    data: [
      {
        id: "m-1",
        org_id: "org-1",
        user_id: "u-1",
        role: "OWNER",
        created_at: "2026-01-01T00:00:00Z",
        deactivated_at: null,
      },
      {
        id: "m-2",
        org_id: "org-1",
        user_id: "u-2",
        role: "MEMBER",
        created_at: "2026-01-01T00:00:00Z",
        deactivated_at: "2026-05-01T00:00:00Z",
      },
    ],
    error: null,
  };

describe(
  "changeMemberRole",
  () => {
    it(
      "persists a valid role change",
      async () => {
        const result =
          await changeMemberRole(
            mockSupabase(
              { selectResult: twoOwners },
            ),
            orgId,
            "m-2" as never,
            "ADMIN",
          );

        expect(result).toEqual(
          { status: "OK" },
        );
      },
    );

    it(
      "records a membership.role_changed audit event on success",
      async () => {
        let auditPayload: unknown;

        await changeMemberRole(
          mockSupabase(
            {
              selectResult: twoOwners,
              onAuditInsert: (payload) => {
                auditPayload = payload;
              },
            },
          ),
          orgId,
          "m-2" as never,
          "ADMIN",
        );

        expect(auditPayload).toMatchObject(
          {
            org_id: orgId,
            actor_user_id: "actor-1",
            event_type: "membership.role_changed",
            aggregate_type: "MEMBERSHIP",
            aggregate_id: "m-2",
            payload: {
              target_user_id: "u-2",
              old_role: "OWNER",
              new_role: "ADMIN",
            },
          },
        );
      },
    );

    it(
      "rejects demoting the last OWNER without persisting",
      async () => {
        const supabase =
          mockSupabase(
            { selectResult: oneOwnerOneMember },
          );

        const result =
          await changeMemberRole(
            supabase,
            orgId,
            "m-1" as never,
            "MEMBER",
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "LAST_OWNER" },
        );
      },
    );

    it(
      "returns FETCH_FAILED when the memberships query errors",
      async () => {
        const result =
          await changeMemberRole(
            mockSupabase(
              {
                selectResult: {
                  data: null,
                  error: { message: "boom" },
                },
              },
            ),
            orgId,
            "m-2" as never,
            "ADMIN",
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "FETCH_FAILED" },
        );
      },
    );

    it(
      "returns PERSIST_FAILED when the update itself errors",
      async () => {
        const result =
          await changeMemberRole(
            mockSupabase(
              {
                selectResult: twoOwners,
                updateError: { message: "db error" },
              },
            ),
            orgId,
            "m-2" as never,
            "ADMIN",
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "PERSIST_FAILED" },
        );
      },
    );

    it(
      "reports PERSIST_FAILED, and records nothing, when the update affects zero rows",
      async () => {
        // P10 review response (correctness review SHOULD-FIX, auth
        // review SHOULD-FIX #2, 2026-08-29): PostgREST reports no error
        // for an UPDATE that RLS silently filters to zero rows -- e.g.
        // a plain MEMBER attempting to change someone else's role.
        // Before this fix, that got {status:"OK"} plus a fabricated
        // membership.role_changed audit event even though the row never
        // changed.
        let auditCalled = false;

        const result =
          await changeMemberRole(
            mockSupabase(
              {
                selectResult: twoOwners,
                casRowsAffected: 0,
                onAuditInsert: () => {
                  auditCalled = true;
                },
              },
            ),
            orgId,
            "m-2" as never,
            "ADMIN",
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "PERSIST_FAILED" },
        );

        expect(auditCalled).toBe(false);
      },
    );
  },
);

describe(
  "removeMember",
  () => {
    it(
      "persists a valid removal",
      async () => {
        const result =
          await removeMember(
            mockSupabase(
              { selectResult: twoOwners },
            ),
            orgId,
            "m-2" as never,
          );

        expect(result).toEqual(
          { status: "OK" },
        );
      },
    );

    it(
      "records a membership.removed audit event on success",
      async () => {
        let auditPayload: unknown;

        await removeMember(
          mockSupabase(
            {
              selectResult: twoOwners,
              onAuditInsert: (payload) => {
                auditPayload = payload;
              },
            },
          ),
          orgId,
          "m-2" as never,
        );

        expect(auditPayload).toMatchObject(
          {
            event_type: "membership.removed",
            aggregate_type: "MEMBERSHIP",
            aggregate_id: "m-2",
            payload: {
              target_user_id: "u-2",
              removed_role: "OWNER",
            },
          },
        );
      },
    );

    it(
      "rejects removing the last OWNER without persisting",
      async () => {
        const result =
          await removeMember(
            mockSupabase(
              { selectResult: oneOwnerOneMember },
            ),
            orgId,
            "m-1" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "LAST_OWNER" },
        );
      },
    );

    it(
      "returns PERSIST_FAILED when the delete itself errors",
      async () => {
        const result =
          await removeMember(
            mockSupabase(
              {
                selectResult: twoOwners,
                deleteError: { message: "db error" },
              },
            ),
            orgId,
            "m-2" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "PERSIST_FAILED" },
        );
      },
    );

    it(
      "reports PERSIST_FAILED, and records nothing, when the delete affects zero rows",
      async () => {
        // Same gap, same fix, as changeMemberRole's equivalent test
        // above -- a plain MEMBER's DELETE of someone else's row is
        // filtered to zero rows by RLS with no error, and previously
        // still reported OK plus a fabricated membership.removed audit
        // event.
        let auditCalled = false;

        const result =
          await removeMember(
            mockSupabase(
              {
                selectResult: twoOwners,
                deleteRowsAffected: 0,
                onAuditInsert: () => {
                  auditCalled = true;
                },
              },
            ),
            orgId,
            "m-2" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "PERSIST_FAILED" },
        );

        expect(auditCalled).toBe(false);
      },
    );
  },
);

describe(
  "deactivateMember",
  () => {
    it(
      "persists a deactivated_at timestamp rather than deleting the row",
      async () => {
        let patch: unknown;

        const result =
          await deactivateMember(
            mockSupabase(
              {
                selectResult: twoOwners,
                onUpdate: (value) => {
                  patch = value;
                },
              },
            ),
            orgId,
            "m-2" as never,
          );

        expect(result).toEqual(
          { status: "OK" },
        );

        // The whole point of deactivation over removal: the row is
        // updated, never deleted, so audit_events written by this
        // person still resolve to them.
        expect(
          (patch as { deactivated_at?: string })?.deactivated_at,
        ).toEqual(
          expect.any(String),
        );
      },
    );

    it(
      "records a membership.deactivated audit event carrying the severed role",
      async () => {
        let auditPayload: unknown;

        await deactivateMember(
          mockSupabase(
            {
              selectResult: twoOwners,
              onAuditInsert: (payload) => {
                auditPayload = payload;
              },
            },
          ),
          orgId,
          "m-2" as never,
        );

        expect(auditPayload).toMatchObject(
          {
            org_id: orgId,
            actor_user_id: "actor-1",
            event_type: "membership.deactivated",
            aggregate_type: "MEMBERSHIP",
            aggregate_id: "m-2",
            payload: {
              target_user_id: "u-2",
              deactivated_role: "OWNER",
            },
          },
        );
      },
    );

    it(
      "writes the same timestamp to the row and to the audit event",
      async () => {
        // The service reads the clock once and reuses that reading for
        // the invariant, the UPDATE, and the audit payload -- these
        // must not be three separate `now()`s that disagree.
        let patch: unknown;
        let auditPayload: unknown;

        await deactivateMember(
          mockSupabase(
            {
              selectResult: twoOwners,
              onUpdate: (value) => {
                patch = value;
              },
              onAuditInsert: (payload) => {
                auditPayload = payload;
              },
            },
          ),
          orgId,
          "m-2" as never,
        );

        expect(
          (auditPayload as { payload: { deactivated_at: string } }).payload
            .deactivated_at,
        ).toBe(
          (patch as { deactivated_at: string }).deactivated_at,
        );
      },
    );

    it(
      "rejects deactivating the last OWNER without persisting",
      async () => {
        let updateCalled = false;

        const result =
          await deactivateMember(
            mockSupabase(
              {
                selectResult: oneOwnerOneMember,
                onUpdate: () => {
                  updateCalled = true;
                },
              },
            ),
            orgId,
            "m-1" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "LAST_OWNER" },
        );

        expect(updateCalled).toBe(false);
      },
    );

    it(
      "rejects deactivating a member who is already deactivated",
      async () => {
        const result =
          await deactivateMember(
            mockSupabase(
              { selectResult: oneOwnerOneDeactivatedMember },
            ),
            orgId,
            "m-2" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "ALREADY_DEACTIVATED" },
        );
      },
    );

    it(
      "rejects deactivating the last ACTIVE owner even when a deactivated OWNER row exists",
      async () => {
        // The cross-check that matters most here: the service must
        // hand deactivated_at through to the domain, or
        // isLastActiveOwner cannot tell that the second OWNER row is
        // already offboarded and this deactivation would leave the org
        // with nobody able to administer it.
        const oneActiveOwnerOneDeactivatedOwner =
          {
            data: [
              {
                id: "m-1",
                org_id: "org-1",
                user_id: "u-1",
                role: "OWNER",
                created_at: "2026-01-01T00:00:00Z",
                deactivated_at: null,
              },
              {
                id: "m-2",
                org_id: "org-1",
                user_id: "u-2",
                role: "OWNER",
                created_at: "2026-01-01T00:00:00Z",
                deactivated_at: "2026-05-01T00:00:00Z",
              },
            ],
            error: null,
          };

        const result =
          await deactivateMember(
            mockSupabase(
              { selectResult: oneActiveOwnerOneDeactivatedOwner },
            ),
            orgId,
            "m-1" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "LAST_OWNER" },
        );
      },
    );

    it(
      "reports ALREADY_DEACTIVATED, and records nothing, when the compare-and-swap loses the race",
      async () => {
        // A concurrent deactivation landed between the fetch and the
        // UPDATE: the row is no longer `deactivated_at is null`, the
        // UPDATE matches zero rows, and PostgREST reports no error for
        // that. Returning OK here would leave an audit event naming a
        // timestamp the row does not carry.
        let auditCalled = false;

        const result =
          await deactivateMember(
            mockSupabase(
              {
                selectResult: twoOwners,
                casRowsAffected: 0,
                onAuditInsert: () => {
                  auditCalled = true;
                },
              },
            ),
            orgId,
            "m-2" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "ALREADY_DEACTIVATED" },
        );

        expect(auditCalled).toBe(false);
      },
    );

    it(
      "returns FETCH_FAILED when the memberships query errors",
      async () => {
        const result =
          await deactivateMember(
            mockSupabase(
              {
                selectResult: {
                  data: null,
                  error: { message: "boom" },
                },
              },
            ),
            orgId,
            "m-2" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "FETCH_FAILED" },
        );
      },
    );

    it(
      "returns PERSIST_FAILED when the update itself errors",
      async () => {
        const result =
          await deactivateMember(
            mockSupabase(
              {
                selectResult: twoOwners,
                updateError: { message: "db error" },
              },
            ),
            orgId,
            "m-2" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "PERSIST_FAILED" },
        );
      },
    );
  },
);

describe(
  "reactivateMember",
  () => {
    it(
      "clears deactivated_at",
      async () => {
        let patch: unknown;

        const result =
          await reactivateMember(
            mockSupabase(
              {
                selectResult: oneOwnerOneDeactivatedMember,
                onUpdate: (value) => {
                  patch = value;
                },
              },
            ),
            orgId,
            "m-2" as never,
          );

        expect(result).toEqual(
          { status: "OK" },
        );

        expect(patch).toEqual(
          { deactivated_at: null },
        );
      },
    );

    it(
      "records a membership.reactivated audit event carrying the restored role",
      async () => {
        let auditPayload: unknown;

        await reactivateMember(
          mockSupabase(
            {
              selectResult: oneOwnerOneDeactivatedMember,
              onAuditInsert: (payload) => {
                auditPayload = payload;
              },
            },
          ),
          orgId,
          "m-2" as never,
        );

        expect(auditPayload).toMatchObject(
          {
            org_id: orgId,
            actor_user_id: "actor-1",
            event_type: "membership.reactivated",
            aggregate_type: "MEMBERSHIP",
            aggregate_id: "m-2",
            payload: {
              target_user_id: "u-2",
              reactivated_role: "MEMBER",
            },
          },
        );
      },
    );

    it(
      "rejects reactivating a member who is already active, without persisting",
      async () => {
        let updateCalled = false;

        const result =
          await reactivateMember(
            mockSupabase(
              {
                selectResult: oneOwnerOneMember,
                onUpdate: () => {
                  updateCalled = true;
                },
              },
            ),
            orgId,
            "m-2" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "NOT_DEACTIVATED" },
        );

        expect(updateCalled).toBe(false);
      },
    );

    it(
      "rejects an unknown membership id",
      async () => {
        const result =
          await reactivateMember(
            mockSupabase(
              { selectResult: oneOwnerOneMember },
            ),
            orgId,
            "m-missing" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "MEMBERSHIP_NOT_FOUND" },
        );
      },
    );

    it(
      "returns FETCH_FAILED when the memberships query errors",
      async () => {
        const result =
          await reactivateMember(
            mockSupabase(
              {
                selectResult: {
                  data: null,
                  error: { message: "boom" },
                },
              },
            ),
            orgId,
            "m-2" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "FETCH_FAILED" },
        );
      },
    );

    it(
      "returns PERSIST_FAILED when the update itself errors",
      async () => {
        const result =
          await reactivateMember(
            mockSupabase(
              {
                selectResult: oneOwnerOneDeactivatedMember,
                updateError: { message: "db error" },
              },
            ),
            orgId,
            "m-2" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "PERSIST_FAILED" },
        );
      },
    );

    it(
      "reports NOT_DEACTIVATED, and records nothing, when the CAS guard finds zero rows",
      async () => {
        // P10 review response (BLOCKING finding #1, both the
        // correctness review and the phase's own mandatory
        // authorization review, 2026-08-29, each independently
        // reproduced this live against real Postgres): before this fix,
        // reactivateMember's UPDATE had no .select() and no row-count
        // check, so an unauthorized caller (a plain MEMBER reactivating
        // someone else) OR a lost race against a concurrent
        // reactivation got {status:"OK"} plus a fabricated
        // membership.reactivated audit event even though the row never
        // changed. Mirrors deactivateMember's own
        // "loses the race" test above -- same guard, same shape,
        // opposite direction.
        let auditCalled = false;

        const result =
          await reactivateMember(
            mockSupabase(
              {
                selectResult: oneOwnerOneDeactivatedMember,
                casRowsAffected: 0,
                onAuditInsert: () => {
                  auditCalled = true;
                },
              },
            ),
            orgId,
            "m-2" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "NOT_DEACTIVATED" },
        );

        expect(auditCalled).toBe(false);
      },
    );
  },
);

import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  changeMemberRole,
  removeMember,
} from "./manage-membership";

function chainableSelect(
  result: { data: unknown; error: unknown },
) {
  return {
    eq: () => Promise.resolve(result),
  };
}

function mockSupabase(
  {
    selectResult,
    updateError = null,
    deleteError = null,
  }: {
    selectResult: { data: unknown; error: unknown };
    updateError?: unknown;
    deleteError?: unknown;
  },
) {
  return {
    from: () => (
      {
        select: () =>
          chainableSelect(
            selectResult,
          ),

        update: () => (
          {
            eq: () =>
              Promise.resolve(
                { error: updateError },
              ),
          }
        ),

        delete: () => (
          {
            eq: () =>
              Promise.resolve(
                { error: deleteError },
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
      },
      {
        id: "m-2",
        org_id: "org-1",
        user_id: "u-2",
        role: "OWNER",
        created_at: "2026-01-01T00:00:00Z",
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
      },
      {
        id: "m-2",
        org_id: "org-1",
        user_id: "u-2",
        role: "MEMBER",
        created_at: "2026-01-01T00:00:00Z",
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
  },
);

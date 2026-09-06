import {
  describe,
  expect,
  it,
} from "vitest";

import {
  listOrgMembers,
} from "./list-org-members";

function mockSupabase(
  {
    data = null,
    error = null,
  }: { data?: unknown; error?: unknown } = {},
) {
  let capturedArgs:
    unknown;

  return {
    client: {
      rpc: (
        fn: string,
        args: unknown,
      ) => {
        capturedArgs =
          { fn, args };

        return Promise.resolve(
          { data, error },
        );
      },
    } as never,

    getCapturedArgs: () =>
      capturedArgs as { fn: string; args: { p_org_id: string } },
  };
}

describe(
  "listOrgMembers",
  () => {
    it(
      "calls list_org_members with the org id",
      async () => {
        const { client, getCapturedArgs } =
          mockSupabase(
            { data: [] },
          );

        await listOrgMembers(
          client,
          "org-1" as never,
        );

        expect(getCapturedArgs()).toEqual(
          {
            fn: "list_org_members",
            args: { p_org_id: "org-1" },
          },
        );
      },
    );

    it(
      "maps RPC rows to OrgMember",
      async () => {
        const { client } =
          mockSupabase(
            {
              data: [
                {
                  membership_id: "m-1",
                  user_id: "u-1",
                  email: "owner@example.com",
                  role: "OWNER",
                  deactivated_at: null,
                },
              ],
            },
          );

        const result =
          await listOrgMembers(
            client,
            "org-1" as never,
          );

        expect(result).toEqual(
          [
            {
              membership_id: "m-1",
              user_id: "u-1",
              email: "owner@example.com",
              role: "OWNER",
              deactivated_at: null,
            },
          ],
        );
      },
    );

    it(
      "2026-09-07 (S5 review round 3, finding S5R3-EMPTY-B2): throws on a fetch error rather than degrading to [] -- app/team/page.tsx has no try/catch of its own, so this now reaches app/error.tsx instead of a false 'no team members'",
      async () => {
        const { client } =
          mockSupabase(
            { error: { message: "denied" } },
          );

        await expect(
          listOrgMembers(
            client,
            "org-1" as never,
          ),
        ).rejects.toThrow(
          "denied",
        );
      },
    );

    it(
      "returns an empty array when data is null even without an error",
      async () => {
        const { client } =
          mockSupabase(
            { data: null, error: null },
          );

        const result =
          await listOrgMembers(
            client,
            "org-1" as never,
          );

        expect(result).toEqual(
          [],
        );
      },
    );
  },
);

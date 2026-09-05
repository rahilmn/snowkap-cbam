import {
  describe,
  expect,
  it,
} from "vitest";

import {
  listGuidanceDismissals,
} from "./list-guidance-dismissals";

function mockSupabase(
  {
    rows = [],
    selectError = null,
  }: {
    rows?: { item_key: string }[];
    selectError?: unknown;
  } = {},
) {
  return {
    from: (
      table: string,
    ) => (
      {
        select: () => (
          {
            eq: () => {
              expect(table).toBe(
                "guidance_dismissals",
              );

              return Promise.resolve(
                { data: selectError ? null : rows, error: selectError },
              );
            },
          }
        ),
      }
    ),
  } as never;
}

describe(
  "listGuidanceDismissals",
  () => {
    it(
      "returns the set of dismissed item keys for the org (RLS already scopes rows to the caller's own user)",
      async () => {
        const client =
          mockSupabase(
            {
              rows: [
                { item_key: "I19:ship-1" },
                { item_key: "I19:ship-2" },
              ],
            },
          );

        const result =
          await listGuidanceDismissals(
            client,
            "org-1" as never,
          );

        expect(result).toEqual(
          new Set(["I19:ship-1", "I19:ship-2"]),
        );
      },
    );

    it(
      "returns an empty set when there are no dismissals",
      async () => {
        const client =
          mockSupabase(
            {
              rows: [],
            },
          );

        expect(
          await listGuidanceDismissals(client, "org-1" as never),
        ).toEqual(
          new Set(),
        );
      },
    );

    it(
      "fails closed to an empty set (never shows an error as a crash) when the read errors -- worst case, dismissals are temporarily ineffective, not a broken dashboard",
      async () => {
        const client =
          mockSupabase(
            {
              selectError: { message: "connection reset" },
            },
          );

        expect(
          await listGuidanceDismissals(client, "org-1" as never),
        ).toEqual(
          new Set(),
        );
      },
    );
  },
);

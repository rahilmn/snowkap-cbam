import {
  describe,
  expect,
  it,
} from "vitest";

import {
  dismissGuidanceItem,
} from "./dismiss-guidance-item";

const context =
  {
    org_id: "org-1",
    user_id: "user-1",
    role: "MEMBER",
    capabilities: ["IMPORTER_DECLARANT"],
  } as never;

function mockSupabase(
  {
    insertError = null,
  }: { insertError?: { code: string; message: string } | null } = {},
) {
  let capturedPayload:
    unknown;

  return {
    client: {
      from: (
        table: string,
      ) => (
        {
          insert: (
            payload: unknown,
          ) => {
            capturedPayload =
              payload;

            expect(table).toBe(
              "guidance_dismissals",
            );

            return Promise.resolve(
              { error: insertError },
            );
          },
        }
      ),
    } as never,

    getCapturedPayload: () =>
      capturedPayload,
  };
}

describe(
  "dismissGuidanceItem",
  () => {
    it(
      "inserts org_id and item_key -- never a user_id (the table's own trigger pins it from auth.uid())",
      async () => {
        const { client, getCapturedPayload } =
          mockSupabase();

        const result =
          await dismissGuidanceItem(
            client,
            context,
            "I19:shipment-1",
          );

        expect(result).toEqual(
          { status: "OK" },
        );

        expect(
          getCapturedPayload(),
        ).toEqual(
          {
            org_id: "org-1",
            item_key: "I19:shipment-1",
          },
        );
      },
    );

    it(
      "treats a duplicate dismissal (23505, the unique constraint) as success, not an error -- re-dismissing is idempotent",
      async () => {
        const { client } =
          mockSupabase(
            {
              insertError: { code: "23505", message: "duplicate key" },
            },
          );

        const result =
          await dismissGuidanceItem(
            client,
            context,
            "I19:shipment-1",
          );

        expect(result).toEqual(
          { status: "OK" },
        );
      },
    );

    it(
      "reports PERSIST_FAILED for any other error",
      async () => {
        const { client } =
          mockSupabase(
            {
              insertError: { code: "42501", message: "insufficient_privilege" },
            },
          );

        const result =
          await dismissGuidanceItem(
            client,
            context,
            "I19:shipment-1",
          );

        expect(result).toEqual(
          { status: "PERSIST_FAILED" },
        );
      },
    );
  },
);

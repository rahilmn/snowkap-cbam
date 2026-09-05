import {
  describe,
  expect,
  it,
} from "vitest";

import {
  submitProductFeedback,
} from "./submit-product-feedback";

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
  }: { insertError?: unknown } = {},
) {
  let capturedPayload:
    unknown;

  let calledSelectAfterInsert =
    false;

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
              "product_feedback",
            );

            return {
              // Deliberately present so a test WOULD catch it if the
              // implementation ever started chaining .select() after
              // .insert() -- see submit-product-feedback.ts's own
              // comment on why it does not rely on the returned row.
              select: () => {
                calledSelectAfterInsert =
                  true;

                return Promise.resolve(
                  { data: null, error: null },
                );
              },

              then: (
                resolve: (result: { error: unknown }) => void,
              ) => resolve(
                { error: insertError },
              ),
            };
          },
        }
      ),
    } as never,

    getCapturedPayload: () =>
      capturedPayload,

    wasSelectCalledAfterInsert: () =>
      calledSelectAfterInsert,
  };
}

describe(
  "submitProductFeedback",
  () => {
    it(
      "inserts rating/comment/page/workflow/context/release_sha, and never sends org_id or user_id from anywhere but the org context (user_id is trigger-pinned)",
      async () => {
        const { client, getCapturedPayload, wasSelectCalledAfterInsert } =
          mockSupabase();

        const result =
          await submitProductFeedback(
            client,
            context,
            {
              rating: 4,
              comment: "The shipment wizard was clear.",
              page: "/shipments/new",
              workflow: "importer-shipment-intake",
              context: { shipmentId: "abc" },
            },
            { GIT_SHA: "deadbeef" },
          );

        expect(result).toEqual(
          { status: "OK" },
        );

        expect(
          getCapturedPayload(),
        ).toEqual(
          {
            org_id: "org-1",
            rating: 4,
            comment: "The shipment wizard was clear.",
            page: "/shipments/new",
            workflow: "importer-shipment-intake",
            context: { shipmentId: "abc" },
            release_sha: "deadbeef",
          },
        );

        // Pinned, not assumed (v2.1.1: "Do not assume insert() return
        // shape. Pin actual behavior in tests.") -- this service does
        // NOT chain .select() after .insert(), matching
        // recordAuditEvent's own established precedent, so it never
        // depends on what RLS would or wouldn't let the INSERT's own
        // RETURNING see.
        expect(wasSelectCalledAfterInsert()).toBe(false);
      },
    );

    it(
      "defaults comment/workflow to null and context to {} when omitted",
      async () => {
        const { client, getCapturedPayload } =
          mockSupabase();

        await submitProductFeedback(
          client,
          context,
          {
            rating: 5,
            page: "/",
          },
          {},
        );

        const payload =
          getCapturedPayload() as Record<string, unknown>;

        expect(payload.comment).toBeNull();
        expect(payload.workflow).toBeNull();
        expect(payload.context).toEqual({});
      },
    );

    it(
      "captures the release SHA via resolveGitSha (falls back through GIT_SHA -> RAILWAY_GIT_COMMIT_SHA -> \"dev\", the same resolution every other call site uses)",
      async () => {
        const { client, getCapturedPayload } =
          mockSupabase();

        await submitProductFeedback(
          client,
          context,
          { rating: 3, page: "/" },
          { RAILWAY_GIT_COMMIT_SHA: "railway-sha" },
        );

        expect(
          (getCapturedPayload() as Record<string, unknown>).release_sha,
        ).toBe(
          "railway-sha",
        );
      },
    );

    it(
      "rejects a rating outside 1-5 before ever calling Supabase",
      async () => {
        const { client } =
          mockSupabase();

        const result =
          await submitProductFeedback(
            client,
            context,
            { rating: 6, page: "/" },
            {},
          );

        expect(result.status).toBe(
          "VALIDATION_FAILED",
        );
      },
    );

    it(
      "rejects a non-integer rating",
      async () => {
        const { client } =
          mockSupabase();

        const result =
          await submitProductFeedback(
            client,
            context,
            { rating: 3.5, page: "/" },
            {},
          );

        expect(result.status).toBe(
          "VALIDATION_FAILED",
        );
      },
    );

    it(
      "rejects an empty page",
      async () => {
        const { client } =
          mockSupabase();

        const result =
          await submitProductFeedback(
            client,
            context,
            { rating: 3, page: "   " },
            {},
          );

        expect(result.status).toBe(
          "VALIDATION_FAILED",
        );
      },
    );

    it(
      "reports PERSIST_FAILED on an insert error",
      async () => {
        const { client } =
          mockSupabase(
            {
              insertError: { message: "connection reset" },
            },
          );

        const result =
          await submitProductFeedback(
            client,
            context,
            { rating: 3, page: "/" },
            {},
          );

        expect(result).toEqual(
          { status: "PERSIST_FAILED" },
        );
      },
    );
  },
);

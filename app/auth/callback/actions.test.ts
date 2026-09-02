import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Same "mock at the module boundary, dynamic-import after" shape
// app/(auth)/actions.test.ts already uses.
const setSessionMock =
  vi.fn();

const getServerSupabaseClientMock =
  vi.fn(
    () => (
      {
        auth: {
          setSession: setSessionMock,
        },
      }
    ),
  );

vi.mock(
  "../../../src/infrastructure/supabase/server-client",
  () => (
    {
      getServerSupabaseClient: () => getServerSupabaseClientMock(),
    }
  ),
);

const { establishSessionAction } =
  await import(
    "./actions"
  );

afterEach(() => {
  vi.clearAllMocks();
});

describe(
  "establishSessionAction",
  () => {
    it(
      "sets the session via the SERVER client -- not the browser client -- so the resulting cookie write is a real Set-Cookie response header the browser cannot refuse (P13 adversarial audit: the browser client's own document.cookie write is silently dropped once an httpOnly cookie of the same name already exists)",
      async () => {
        setSessionMock.mockResolvedValueOnce(
          { error: null },
        );

        const result =
          await establishSessionAction(
            "real-access-token",
            "real-refresh-token",
          );

        expect(result).toEqual(
          { status: "ok" },
        );

        expect(setSessionMock).toHaveBeenCalledWith(
          {
            access_token: "real-access-token",
            refresh_token: "real-refresh-token",
          },
        );
      },
    );

    it(
      "returns an error status, not a thrown exception, when Supabase rejects the tokens",
      async () => {
        setSessionMock.mockResolvedValueOnce(
          { error: { message: "invalid JWT" } },
        );

        const result =
          await establishSessionAction(
            "expired-access-token",
            "expired-refresh-token",
          );

        expect(result).toEqual(
          // 2026-09-03 (P14): the result now carries GoTrue's own error
          // code so the callback can explain WHICH failure occurred
          // rather than rendering one sentence for all of them. Null here
          // because these fixtures supply an error without a code.
          { status: "error", code: null },
        );
      },
    );

    it(
      "returns an error status when setSession itself throws",
      async () => {
        setSessionMock.mockRejectedValueOnce(
          new Error(
            "network error",
          ),
        );

        const result =
          await establishSessionAction(
            "access-token",
            "refresh-token",
          );

        expect(result).toEqual(
          // 2026-09-03 (P14): the result now carries GoTrue's own error
          // code so the callback can explain WHICH failure occurred
          // rather than rendering one sentence for all of them. Null here
          // because these fixtures supply an error without a code.
          { status: "error", code: null },
        );
      },
    );
  },
);

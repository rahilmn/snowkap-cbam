import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Same "mock at the module boundary, dynamic-import after" shape
// app/(auth)/actions.test.ts already uses.
const resetPasswordForEmailMock =
  vi.fn();

const getServerSupabaseClientMock =
  vi.fn(
    () => (
      {
        auth: {
          resetPasswordForEmail: resetPasswordForEmailMock,
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

const checkMock =
  vi.fn();

vi.mock(
  "../../../src/infrastructure/rate-limit/rate-limiter",
  () => (
    {
      createInMemoryRateLimiter:
        () => (
          { check: checkMock }
        ),
    }
  ),
);

vi.mock(
  "../../../components/shell/get-client-ip",
  () => (
    {
      getClientIp: async () => "203.0.113.1",
    }
  ),
);

vi.mock(
  "../../team/actions",
  () => (
    {
      getAppOrigin: async () => "https://app.example.com",
    }
  ),
);

const { requestPasswordResetAction } =
  await import(
    "./actions"
  );

afterEach(() => {
  vi.clearAllMocks();
});

function formData(
  fields: Record<string, string>,
): FormData {
  const data =
    new FormData();

  for (
    const [key, value] of Object.entries(fields)
  ) {
    data.set(
      key,
      value,
    );
  }

  return data;
}

describe(
  "requestPasswordResetAction",
  () => {
    it(
      "returns a too-many-attempts error, in whole seconds, without ever calling Supabase, when the limiter rejects",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: false, retryAfterMs: 42_100 },
        );

        const result =
          await requestPasswordResetAction(
            { status: "idle" },
            formData(
              { email: "buyer@example.com" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Too many attempts. Try again in 43 seconds.",
          },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
        expect(resetPasswordForEmailMock).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects a malformed email without ever calling Supabase",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        const result =
          await requestPasswordResetAction(
            { status: "idle" },
            formData(
              { email: "not-an-email" },
            ),
          );

        expect(result).toEqual(
          { status: "error", message: "Enter a valid email address." },
        );

        expect(resetPasswordForEmailMock).not.toHaveBeenCalled();
      },
    );

    it(
      "reports check-email once the request is well-formed and within the rate limit, calling Supabase with the /reset-password redirect target",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        resetPasswordForEmailMock.mockResolvedValueOnce(
          { error: null },
        );

        const result =
          await requestPasswordResetAction(
            { status: "idle" },
            formData(
              { email: "buyer@example.com" },
            ),
          );

        expect(result).toEqual(
          { status: "check-email" },
        );

        expect(resetPasswordForEmailMock).toHaveBeenCalledWith(
          "buyer@example.com",
          {
            redirectTo: "https://app.example.com/auth/callback?next=/reset-password",
          },
        );
      },
    );

    it(
      "reports check-email even when Supabase reports the address doesn't exist -- anti-enumeration",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        // Supabase's own resetPasswordForEmail does not error for a
        // nonexistent address (by design) -- error is null here to
        // model that, distinct from the genuine-failure test below.
        resetPasswordForEmailMock.mockResolvedValueOnce(
          { error: null },
        );

        const result =
          await requestPasswordResetAction(
            { status: "idle" },
            formData(
              { email: "no-such-account@example.com" },
            ),
          );

        expect(result).toEqual(
          { status: "check-email" },
        );
      },
    );

    it(
      "reports a generic error, not check-email, on a genuine Supabase failure",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        resetPasswordForEmailMock.mockResolvedValueOnce(
          { error: { message: "rate limit exceeded" } },
        );

        const result =
          await requestPasswordResetAction(
            { status: "idle" },
            formData(
              { email: "buyer@example.com" },
            ),
          );

        expect(result).toEqual(
          { status: "error", message: "Something went wrong. Please try again." },
        );
      },
    );
  },
);

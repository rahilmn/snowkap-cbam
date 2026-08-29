import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Same "mock at the module boundary, dynamic-import after" shape
// app/(auth)/actions.test.ts already uses. The success path
// (updatePasswordAction calling next/navigation's redirect()) is
// deliberately not exercised here, matching signInAction's/
// signUpAction's own test file, which likewise never asserts on their
// redirect("/")/redirect("/onboarding") success paths -- redirect()
// throws a Next-internal signal outside a real request context, which
// this codebase's existing action tests consistently work around by
// only covering the guard-rail paths (rate limit, validation, no
// session, generic failure), not the terminal redirect itself.
const getUserMock =
  vi.fn();

const updateUserMock =
  vi.fn();

const getServerSupabaseClientMock =
  vi.fn(
    () => (
      {
        auth: {
          getUser: getUserMock,
          updateUser: updateUserMock,
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

const { updatePasswordAction } =
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
  "updatePasswordAction",
  () => {
    it(
      "returns a too-many-attempts error, in whole seconds, without ever calling Supabase, when the limiter rejects",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: false, retryAfterMs: 42_100 },
        );

        const result =
          await updatePasswordAction(
            { status: "idle" },
            formData(
              { password: "correct-horse-battery", confirmPassword: "correct-horse-battery" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Too many attempts. Try again in 43 seconds.",
          },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects a too-short password without ever calling Supabase",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        const result =
          await updatePasswordAction(
            { status: "idle" },
            formData(
              { password: "short", confirmPassword: "short" },
            ),
          );

        expect(result).toEqual(
          { status: "error", message: "Password must be at least 8 characters." },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects mismatched password/confirmPassword without ever calling Supabase",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        const result =
          await updatePasswordAction(
            { status: "idle" },
            formData(
              { password: "correct-horse-battery", confirmPassword: "different-password" },
            ),
          );

        expect(result).toEqual(
          { status: "error", message: "Passwords do not match." },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects with an actionable message, never calling updateUser, when there is no valid session (an expired or already-used recovery link)",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getUserMock.mockResolvedValueOnce(
          { data: { user: null } },
        );

        const result =
          await updatePasswordAction(
            { status: "idle" },
            formData(
              { password: "correct-horse-battery", confirmPassword: "correct-horse-battery" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "This link is invalid or has expired. Request a new password reset link.",
          },
        );

        expect(updateUserMock).not.toHaveBeenCalled();
      },
    );

    it(
      "reports a generic error on a genuine updateUser failure",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getUserMock.mockResolvedValueOnce(
          { data: { user: { id: "user-1" } } },
        );

        updateUserMock.mockResolvedValueOnce(
          { error: { message: "New password should be different from the old password." } },
        );

        const result =
          await updatePasswordAction(
            { status: "idle" },
            formData(
              { password: "correct-horse-battery", confirmPassword: "correct-horse-battery" },
            ),
          );

        expect(result).toEqual(
          { status: "error", message: "Something went wrong. Please try again." },
        );
      },
    );

    it(
      "reports the specific complexity requirement on Supabase's own weak_password rejection, not the generic fallback -- live-confirmed against a real local Supabase instance: an all-lowercase-plus-digits 24-character password (well past the 8-char minLength) is rejected with this exact code",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getUserMock.mockResolvedValueOnce(
          { data: { user: { id: "user-1" } } },
        );

        updateUserMock.mockResolvedValueOnce(
          {
            error: {
              code: "weak_password",
              message:
                "Password should contain at least one character of each: abcdefghijklmnopqrstuvwxyz, ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789.",
            },
          },
        );

        const result =
          await updatePasswordAction(
            { status: "idle" },
            formData(
              { password: "brand-new-password-456", confirmPassword: "brand-new-password-456" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Password must include a lowercase letter, an uppercase letter, and a number.",
          },
        );
      },
    );
  },
);

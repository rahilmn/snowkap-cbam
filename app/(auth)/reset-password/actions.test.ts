import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Same "mock at the module boundary, dynamic-import after" shape
// app/(auth)/actions.test.ts already uses.
//
// 2026-09-03 (P14): the success path IS now exercised. It used to be
// skipped on the grounds that redirect() throws a Next-internal signal
// outside a real request context -- true, and worked around here by
// mocking next/navigation so the throw carries its target, the same
// technique app/accept-invitation/actions.test.ts already uses. It has
// to be covered now, because the success path acquired two behaviours
// worth pinning: it signs OTHER sessions out, and it carries an invited
// user onward to their invitation.
const getUserMock =
  vi.fn();

const updateUserMock =
  vi.fn();

const signOutMock =
  vi.fn();

const getServerSupabaseClientMock =
  vi.fn(
    () => (
      {
        auth: {
          getUser: getUserMock,
          updateUser: updateUserMock,
          signOut: signOutMock,
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

const REDIRECT_SENTINEL =
  "NEXT_REDIRECT";

vi.mock(
  "next/navigation",
  () => (
    {
      redirect: (target: string) => {
        throw Object.assign(
          new Error(REDIRECT_SENTINEL),
          { target },
        );
      },
    }
  ),
);

async function redirectTargetOfUpdate(
  fields: Record<string, string>,
): Promise<string> {
  const data =
    new FormData();

  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }

  try {
    await updatePasswordAction(
      { status: "idle" },
      data,
    );
  } catch (error) {
    if ((error as Error).message === REDIRECT_SENTINEL) {
      return (error as { target: string }).target;
    }

    throw error;
  }

  throw new Error(
    "expected a redirect",
  );
}

describe(
  "updatePasswordAction success path (P14)",
  () => {
    function allowEverything() {
      checkMock.mockReturnValue(
        { allowed: true, retryAfterMs: 0 },
      );

      getUserMock.mockResolvedValue(
        { data: { user: { id: "u-1" } } },
      );

      updateUserMock.mockResolvedValue(
        { error: null },
      );

      signOutMock.mockResolvedValue(
        { error: null },
      );
    }

    it(
      "signs OTHER sessions out after the password changes, and never the current one",
      async () => {
        // A password change should end every session the old password
        // could have established. `others` is the only scope that does
        // that without ending the session the user is standing in --
        // which matters especially here, because an invited user is
        // mid-journey to accepting an invitation.
        allowEverything();

        await redirectTargetOfUpdate(
          { password: "Sup3rSecret", confirmPassword: "Sup3rSecret" },
        );

        expect(signOutMock).toHaveBeenCalledWith(
          { scope: "others" },
        );

        expect(signOutMock).not.toHaveBeenCalledWith(
          { scope: "global" },
        );

        expect(signOutMock).not.toHaveBeenCalledWith();
      },
    );

    it(
      "carries an invited user onward to their invitation",
      async () => {
        allowEverything();

        expect(
          await redirectTargetOfUpdate(
            {
              password: "Sup3rSecret",
              confirmPassword: "Sup3rSecret",
              next: "/accept-invitation",
            },
          ),
        ).toBe(
          "/accept-invitation",
        );
      },
    );

    it(
      "re-validates the next it was handed, because a hidden field is client-controlled at POST time",
      async () => {
        allowEverything();

        expect(
          await redirectTargetOfUpdate(
            {
              password: "Sup3rSecret",
              confirmPassword: "Sup3rSecret",
              next: "//evil.example",
            },
          ),
        ).toBe(
          "/",
        );
      },
    );

    it(
      "still redirects when signing other sessions out fails, carrying a notice instead of stranding the user on a form whose password already changed",
      async () => {
        // The password HAS changed by this point. Returning an error
        // state here would leave an invited user on the reset form with
        // nothing useful to retry and their invitation one screen away.
        allowEverything();

        signOutMock.mockResolvedValueOnce(
          { error: { message: "boom" } },
        );

        expect(
          await redirectTargetOfUpdate(
            {
              password: "Sup3rSecret",
              confirmPassword: "Sup3rSecret",
              next: "/accept-invitation",
            },
          ),
        ).toBe(
          "/accept-invitation?password_change=others_not_signed_out",
        );
      },
    );

    it(
      "does not sign anything out when the password update itself failed",
      async () => {
        allowEverything();

        updateUserMock.mockResolvedValueOnce(
          { error: { message: "boom" } },
        );

        const result =
          await updatePasswordAction(
            { status: "idle" },
            (() => {
              const data = new FormData();
              data.set("password", "Sup3rSecret");
              data.set("confirmPassword", "Sup3rSecret");
              return data;
            })(),
          );

        expect(result.status).toBe(
          "error",
        );

        expect(signOutMock).not.toHaveBeenCalled();
      },
    );
  },
);

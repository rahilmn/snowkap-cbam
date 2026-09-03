import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

/**
 * 2026-09-04 (P14, AUTH-1). The attack matrix at the action boundary.
 *
 * Same "mock at the module boundary, dynamic-import after" shape the
 * other auth action suites use. The live half of this matrix -- real
 * GoTrue, real passwords, a real stolen session -- is
 * tests/integration/password-change-current-password-proof.test.ts;
 * these cases pin the branching that no live test can enumerate
 * cheaply, and in particular that NOTHING reaches updateUser without a
 * VERIFIED verdict.
 */
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

const verifyCurrentPasswordMock =
  vi.fn();

vi.mock(
  "../../../src/infrastructure/supabase/password-verification-client",
  () => (
    {
      verifyCurrentPassword: (
        args: unknown,
      ) => verifyCurrentPasswordMock(args),
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

// 2026-09-04 (P14, AUTH-1). The action reads the opaque session cookie
// so that ending "every other session" spares the one in hand.
const cookieGetMock =
  vi.fn(
    () => (
      { value: "opaque-session-in-hand" }
    ),
  );

vi.mock(
  "next/headers",
  () => (
    {
      cookies: async () => (
        { get: cookieGetMock }
      ),
    }
  ),
);

// The application's own other sessions are ended directly after a
// proven change, rather than waiting up to an hour for the provider's
// refresh tokens to lapse.
const revokeOtherAppSessionsMock =
  vi.fn(
    async (_args: unknown) => 0,
  );

vi.mock(
  "../../../src/infrastructure/auth/app-session-store",
  () => (
    {
      revokeOtherAppSessions: (
        args: unknown,
      ) => revokeOtherAppSessionsMock(args),
    }
  ),
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

const { changePasswordAction } =
  await import(
    "./actions"
  );

afterEach(() => {
  vi.clearAllMocks();
});

const CURRENT = "OldPassword1";
const NEXT_PASSWORD = "Sup3rSecretNew";

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

function wellFormed(
  overrides: Record<string, string> = {},
): FormData {
  return formData(
    {
      currentPassword: CURRENT,
      password: NEXT_PASSWORD,
      confirmPassword: NEXT_PASSWORD,
      ...overrides,
    },
  );
}

function signedIn() {
  checkMock.mockReturnValue(
    { allowed: true, retryAfterMs: 0 },
  );

  getUserMock.mockResolvedValue(
    {
      data: {
        user: {
          id: "victim-user-id",
          email: "victim@example.com",
        },
      },
    },
  );

  updateUserMock.mockResolvedValue(
    { error: null },
  );

  signOutMock.mockResolvedValue(
    { error: null },
  );
}

async function redirectTarget(
  data: FormData,
): Promise<string> {
  try {
    await changePasswordAction(
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
  "changePasswordAction -- current-password proof",
  () => {
    it(
      "1. accepts a correct current password and changes the password",
      async () => {
        signedIn();

        verifyCurrentPasswordMock.mockResolvedValue(
          "VERIFIED",
        );

        expect(
          await redirectTarget(
            wellFormed(),
          ),
        ).toBe(
          "/account/password?changed=1",
        );

        expect(verifyCurrentPasswordMock).toHaveBeenCalledWith(
          {
            email: "victim@example.com",
            password: CURRENT,
            expectedUserId: "victim-user-id",
          },
        );

        expect(updateUserMock).toHaveBeenCalledWith(
          { password: NEXT_PASSWORD },
        );

        // The session in hand is read and carried through, so that
        // ending the user's other sessions does not end this one.
        expect(cookieGetMock).toHaveBeenCalledWith(
          "sb_app_session",
        );

        expect(revokeOtherAppSessionsMock).toHaveBeenCalledWith(
          {
            userId: "victim-user-id",
            keepToken: "opaque-session-in-hand",
          },
        );
      },
    );

    it(
      "2. refuses a wrong current password, and never calls updateUser",
      async () => {
        signedIn();

        verifyCurrentPasswordMock.mockResolvedValue(
          "INCORRECT",
        );

        const result =
          await changePasswordAction(
            { status: "idle" },
            wellFormed(),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Your current password is incorrect.",
          },
        );

        expect(updateUserMock).not.toHaveBeenCalled();

        expect(signOutMock).not.toHaveBeenCalled();

        // Nobody is signed out on a refused change -- not the
        // provider's sessions, and not this application's.
        expect(revokeOtherAppSessionsMock).not.toHaveBeenCalled();
      },
    );

    it(
      "3. refuses an omitted or empty current password before any network call",
      async () => {
        signedIn();

        for (
          const data of [
            formData(
              {
                password: NEXT_PASSWORD,
                confirmPassword: NEXT_PASSWORD,
              },
            ),
            wellFormed(
              { currentPassword: "" },
            ),
          ]
        ) {
          const result =
            await changePasswordAction(
              { status: "idle" },
              data,
            );

          expect(result).toEqual(
            {
              status: "error",
              message: "Enter your current password.",
            },
          );
        }

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();

        expect(verifyCurrentPasswordMock).not.toHaveBeenCalled();

        expect(updateUserMock).not.toHaveBeenCalled();
      },
    );

    it(
      "4/6. a valid session, called directly with no current-password proof, changes nothing -- the stolen-session attack",
      async () => {
        // There is no UI in this test. This IS the direct invocation:
        // a Server Action called with a valid session and a form body
        // the attacker composed. Session age is irrelevant to the
        // outcome, which is the point -- see the integration suite for
        // the fresh-vs-aged measurement against real GoTrue.
        signedIn();

        verifyCurrentPasswordMock.mockResolvedValue(
          "INCORRECT",
        );

        for (
          const data of [
            // No current-password field at all.
            formData(
              {
                password: NEXT_PASSWORD,
                confirmPassword: NEXT_PASSWORD,
              },
            ),
            // A guess.
            wellFormed(
              { currentPassword: "not-the-password" },
            ),
            // An empty string, which a naive check might treat as
            // "supplied".
            wellFormed(
              { currentPassword: "" },
            ),
          ]
        ) {
          const result =
            await changePasswordAction(
              { status: "idle" },
              data,
            );

          expect(result.status).toBe(
            "error",
          );
        }

        expect(updateUserMock).not.toHaveBeenCalled();
      },
    );

    it(
      "refuses when there is no session at all, without attempting verification",
      async () => {
        checkMock.mockReturnValue(
          { allowed: true, retryAfterMs: 0 },
        );

        getUserMock.mockResolvedValue(
          { data: { user: null } },
        );

        const result =
          await changePasswordAction(
            { status: "idle" },
            wellFormed(),
          );

        expect(result.status).toBe(
          "error",
        );

        expect(verifyCurrentPasswordMock).not.toHaveBeenCalled();

        expect(updateUserMock).not.toHaveBeenCalled();
      },
    );

    it(
      "refuses a session whose user carries no email, rather than verifying against an empty address",
      async () => {
        checkMock.mockReturnValue(
          { allowed: true, retryAfterMs: 0 },
        );

        getUserMock.mockResolvedValue(
          { data: { user: { id: "u-1", email: null } } },
        );

        const result =
          await changePasswordAction(
            { status: "idle" },
            wellFormed(),
          );

        expect(result.status).toBe(
          "error",
        );

        expect(verifyCurrentPasswordMock).not.toHaveBeenCalled();
      },
    );

    it(
      "does not treat an unavailable verifier as proof",
      async () => {
        // Fail closed: if Supabase cannot answer, the answer is not
        // "probably fine".
        signedIn();

        verifyCurrentPasswordMock.mockResolvedValue(
          "UNAVAILABLE",
        );

        const result =
          await changePasswordAction(
            { status: "idle" },
            wellFormed(),
          );

        expect(result.status).toBe(
          "error",
        );

        expect(updateUserMock).not.toHaveBeenCalled();
      },
    );

    it(
      "bounds guessing: a rejected limiter answers without reaching Supabase or the verifier",
      async () => {
        checkMock.mockReturnValue(
          { allowed: false, retryAfterMs: 42_100 },
        );

        const result =
          await changePasswordAction(
            { status: "idle" },
            wellFormed(),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Too many attempts. Try again in 43 seconds.",
          },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();

        expect(verifyCurrentPasswordMock).not.toHaveBeenCalled();
      },
    );

    it(
      "never verifies a password that failed validation, so the form cannot be used as an unbounded oracle",
      async () => {
        signedIn();

        for (
          const data of [
            wellFormed(
              { password: "short", confirmPassword: "short" },
            ),
            wellFormed(
              { confirmPassword: "something-else" },
            ),
          ]
        ) {
          const result =
            await changePasswordAction(
              { status: "idle" },
              data,
            );

          expect(result.status).toBe(
            "error",
          );
        }

        expect(verifyCurrentPasswordMock).not.toHaveBeenCalled();
      },
    );

    it(
      "refuses a new password identical to the current one",
      async () => {
        signedIn();

        const result =
          await changePasswordAction(
            { status: "idle" },
            wellFormed(
              {
                password: CURRENT,
                confirmPassword: CURRENT,
              },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "The new password must be different from the current one.",
          },
        );

        expect(verifyCurrentPasswordMock).not.toHaveBeenCalled();
      },
    );
  },
);

describe(
  "changePasswordAction -- after a legitimate change",
  () => {
    it(
      "8. signs OTHER sessions out, and never the current one",
      async () => {
        // This is what evicts an attacker who was holding a stolen
        // cookie -- and it happens only on the far side of a proven
        // current password, never before it.
        signedIn();

        verifyCurrentPasswordMock.mockResolvedValue(
          "VERIFIED",
        );

        await redirectTarget(
          wellFormed(),
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
      "orders the eviction AFTER the change, so a refused change never signs anyone out",
      async () => {
        signedIn();

        verifyCurrentPasswordMock.mockResolvedValue(
          "VERIFIED",
        );

        updateUserMock.mockResolvedValue(
          { error: { message: "boom" } },
        );

        const result =
          await changePasswordAction(
            { status: "idle" },
            wellFormed(),
          );

        expect(result.status).toBe(
          "error",
        );

        expect(signOutMock).not.toHaveBeenCalled();
      },
    );

    it(
      "never reports failure once the password has actually changed",
      async () => {
        // The trap this avoids: telling a user "that didn't work" when
        // their password is already different sends them round again
        // with a current password that is no longer current, and the
        // second attempt fails for a reason the first one caused.
        signedIn();

        verifyCurrentPasswordMock.mockResolvedValue(
          "VERIFIED",
        );

        signOutMock.mockResolvedValue(
          { error: { message: "boom" } },
        );

        expect(
          await redirectTarget(
            wellFormed(),
          ),
        ).toBe(
          "/account/password?changed=1&others=failed",
        );
      },
    );

    it(
      "surfaces GoTrue's own weak_password and reauthentication_needed rather than a generic failure",
      async () => {
        signedIn();

        verifyCurrentPasswordMock.mockResolvedValue(
          "VERIFIED",
        );

        updateUserMock.mockResolvedValue(
          { error: { code: "weak_password" } },
        );

        expect(
          (
            await changePasswordAction(
              { status: "idle" },
              wellFormed(),
            )
          ).message,
        ).toContain(
          "lowercase letter",
        );

        updateUserMock.mockResolvedValue(
          { error: { code: "reauthentication_needed" } },
        );

        expect(
          (
            await changePasswordAction(
              { status: "idle" },
              wellFormed(),
            )
          ).message,
        ).toContain(
          "recent sign-in",
        );
      },
    );
  },
);

describe(
  "changePasswordAction -- the current password does not leak",
  () => {
    it(
      "never puts the current password in a redirect target or an error message",
      async () => {
        signedIn();

        // Refused.
        verifyCurrentPasswordMock.mockResolvedValue(
          "INCORRECT",
        );

        const refused =
          await changePasswordAction(
            { status: "idle" },
            wellFormed(),
          );

        expect(
          JSON.stringify(refused),
        ).not.toContain(
          CURRENT,
        );

        // Accepted.
        verifyCurrentPasswordMock.mockResolvedValue(
          "VERIFIED",
        );

        const target =
          await redirectTarget(
            wellFormed(),
          );

        expect(target).not.toContain(
          CURRENT,
        );

        expect(target).not.toContain(
          NEXT_PASSWORD,
        );

        // And nothing but the verifier was ever handed the credential.
        expect(updateUserMock).toHaveBeenCalledWith(
          { password: NEXT_PASSWORD },
        );

        expect(
          JSON.stringify(
            updateUserMock.mock.calls,
          ),
        ).not.toContain(
          CURRENT,
        );
      },
    );
  },
);

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Mocked before importing actions.ts, the same "mock at the module
// boundary, dynamic-import after" shape app/api/health/route.test.ts
// and proxy.test.ts already use -- this exercises only the rate-limit
// short-circuit at the top of each action, never a real Supabase call
// or a real clock/header read.
const signInWithPasswordMock =
  vi.fn();

const signUpMock =
  vi.fn();

const signOutMock =
  vi.fn();

const getServerSupabaseClientMock =
  vi.fn(
    () => (
      {
        auth: {
          signInWithPassword: signInWithPasswordMock,
          signUp: signUpMock,
          signOut: signOutMock,
        },
      }
    ),
  );

// signOutAction's own real work is entirely "sign out, then redirect" --
// redirect() throws a Next-internal signal outside a real request
// context (see this file's header comment), so this sentinel lets the
// test assert signOut() was actually called BEFORE that throw, without
// needing a real Next request/response cycle.
const REDIRECT_SENTINEL =
  Symbol(
    "next/navigation redirect() called",
  );

const redirectMock =
  vi.fn(
    (..._args: unknown[]) => {
      throw REDIRECT_SENTINEL;
    },
  );

vi.mock(
  "next/navigation",
  () => (
    {
      redirect: (...args: unknown[]) => redirectMock(...args),
    }
  ),
);

vi.mock(
  "../../src/infrastructure/supabase/server-client",
  () => (
    {
      getServerSupabaseClient: () => getServerSupabaseClientMock(),
    }
  ),
);

const checkMock =
  vi.fn();

vi.mock(
  "../../src/infrastructure/rate-limit/rate-limiter",
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
  "../../components/shell/get-client-ip",
  () => (
    {
      getClientIp: async () => "203.0.113.1",
    }
  ),
);

vi.mock(
  "../team/actions",
  () => (
    {
      getAppOrigin: async () => "https://app.example.com",
    }
  ),
);

const { signInAction, signUpAction, signOutAction } =
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
  "signInAction",
  () => {
    it(
      "returns a too-many-attempts error, in whole seconds, without ever calling Supabase, when the limiter rejects",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: false, retryAfterMs: 42_100 },
        );

        const result =
          await signInAction(
            { status: "idle" },
            formData(
              { email: "buyer@example.com", password: "correct-horse" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Too many attempts. Try again in 43 seconds.",
          },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
        expect(signInWithPasswordMock).not.toHaveBeenCalled();
      },
    );

    it(
      "proceeds to Supabase when the limiter allows the attempt",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        signInWithPasswordMock.mockResolvedValueOnce(
          { error: { message: "Invalid login credentials" } },
        );

        const result =
          await signInAction(
            { status: "idle" },
            formData(
              { email: "buyer@example.com", password: "wrong" },
            ),
          );

        expect(result).toEqual(
          { status: "error", message: "Incorrect email or password." },
        );

        expect(signInWithPasswordMock).toHaveBeenCalledTimes(1);
      },
    );

    it(
      "returns the zod validation message and never calls Supabase, for an invalid email or an empty password",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        const invalidEmailResult =
          await signInAction(
            { status: "idle" },
            formData(
              { email: "not-an-email", password: "correct-horse" },
            ),
          );

        expect(invalidEmailResult).toEqual(
          {
            status: "error",
            message: "Enter a valid email address.",
          },
        );

        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        const emptyPasswordResult =
          await signInAction(
            { status: "idle" },
            formData(
              { email: "buyer@example.com", password: "" },
            ),
          );

        expect(emptyPasswordResult).toEqual(
          {
            status: "error",
            message: "Enter your password.",
          },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
        expect(signInWithPasswordMock).not.toHaveBeenCalled();
      },
    );

    it(
      "returns the confirm-your-email message when Supabase reports the account is unconfirmed",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        signInWithPasswordMock.mockResolvedValueOnce(
          { error: { message: "Email not confirmed" } },
        );

        const result =
          await signInAction(
            { status: "idle" },
            formData(
              { email: "buyer@example.com", password: "correct-horse" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message:
              "Confirm your email address before signing in -- check your inbox for the confirmation link.",
          },
        );

        expect(signInWithPasswordMock).toHaveBeenCalledTimes(1);
      },
    );

    it(
      "calls signInWithPassword and then redirects to / on success",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        signInWithPasswordMock.mockResolvedValueOnce(
          { error: null },
        );

        await expect(
          signInAction(
            { status: "idle" },
            formData(
              { email: "buyer@example.com", password: "correct-horse" },
            ),
          ),
        ).rejects.toBe(
          REDIRECT_SENTINEL,
        );

        expect(signInWithPasswordMock).toHaveBeenCalledTimes(1);
        expect(redirectMock).toHaveBeenCalledWith(
          "/",
        );
      },
    );
  },
);

describe(
  "signUpAction",
  () => {
    it(
      "returns a too-many-attempts error without ever calling Supabase, when the limiter rejects",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: false, retryAfterMs: 5_000 },
        );

        const result =
          await signUpAction(
            { status: "idle" },
            formData(
              { email: "buyer@example.com", password: "correct-horse-battery" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Too many attempts. Try again in 5 seconds.",
          },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
        expect(signUpMock).not.toHaveBeenCalled();
      },
    );

    it(
      "returns the zod validation message and never calls Supabase, when the password is under 8 characters",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        const result =
          await signUpAction(
            { status: "idle" },
            formData(
              { email: "buyer@example.com", password: "short1" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Password must be at least 8 characters.",
          },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
        expect(signUpMock).not.toHaveBeenCalled();
      },
    );

    it(
      "returns the generic account-exists message when Supabase reports the email is already registered",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        signUpMock.mockResolvedValueOnce(
          {
            data: { session: null },
            error: { message: "User already registered" },
          },
        );

        const result =
          await signUpAction(
            { status: "idle" },
            formData(
              { email: "buyer@example.com", password: "correct-horse-battery" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message:
              "Something went wrong creating your account. If you already have one, try signing in instead.",
          },
        );

        expect(signUpMock).toHaveBeenCalledTimes(1);
      },
    );

    it(
      "sends an explicit emailRedirectTo so the confirmation link never depends on the dashboard Site URL",
      async () => {
        // 2026-08-31 (first real-external-user release gate): signUp was
        // called with only {email, password}. With no `emailRedirectTo`,
        // GoTrue builds the confirmation link from the PROJECT'S OWN
        // dashboard "Site URL" -- so a project still pointing at
        // http://localhost:3000 mails every new user a link to a host
        // that does not exist for them, and email confirmation silently
        // cannot be completed by anyone. Nothing in this repository
        // could detect that; the failure lives entirely in remote
        // config. Sending the redirect explicitly makes the deployment
        // that serves the request decide where its own users land, which
        // is the only party that actually knows.
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        signUpMock.mockResolvedValueOnce(
          {
            data: { session: null },
            error: null,
          },
        );

        await signUpAction(
          { status: "idle" },
          formData(
            { email: "buyer@example.com", password: "correct-horse-battery" },
          ),
        );

        expect(signUpMock).toHaveBeenCalledWith(
          {
            email: "buyer@example.com",
            password: "correct-horse-battery",
            options: {
              emailRedirectTo:
                "https://app.example.com/auth/callback?next=/onboarding",
            },
          },
        );
      },
    );

    it(
      "returns the generic failure message for an unrelated Supabase error",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        signUpMock.mockResolvedValueOnce(
          {
            data: { session: null },
            error: { message: "Unexpected error" },
          },
        );

        const result =
          await signUpAction(
            { status: "idle" },
            formData(
              { email: "buyer@example.com", password: "correct-horse-battery" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Something went wrong creating your account. Please try again.",
          },
        );

        expect(signUpMock).toHaveBeenCalledTimes(1);
      },
    );

    it(
      "returns check-email status when sign-up succeeds but Supabase returns no session (email confirmation pending)",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        signUpMock.mockResolvedValueOnce(
          {
            data: { session: null },
            error: null,
          },
        );

        const result =
          await signUpAction(
            { status: "idle" },
            formData(
              { email: "buyer@example.com", password: "correct-horse-battery" },
            ),
          );

        expect(result).toEqual(
          { status: "check-email" },
        );

        expect(redirectMock).not.toHaveBeenCalled();
      },
    );

    it(
      "calls signUp and then redirects to /onboarding when a session comes back immediately",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        signUpMock.mockResolvedValueOnce(
          {
            data: { session: { access_token: "token" } },
            error: null,
          },
        );

        await expect(
          signUpAction(
            { status: "idle" },
            formData(
              { email: "buyer@example.com", password: "correct-horse-battery" },
            ),
          ),
        ).rejects.toBe(
          REDIRECT_SENTINEL,
        );

        expect(signUpMock).toHaveBeenCalledTimes(1);
        expect(redirectMock).toHaveBeenCalledWith(
          "/onboarding",
        );
      },
    );
  },
);

// 2026-08-30 (P13 final non-blocked-work audit): this action previously
// had zero test coverage at all -- signOut() could stop being called
// before the redirect and no test would fail.
describe(
  "signOutAction",
  () => {
    it(
      "calls supabase.auth.signOut() before redirecting to /sign-in",
      async () => {
        signOutMock.mockResolvedValueOnce(
          { error: null },
        );

        await expect(
          signOutAction(),
        ).rejects.toBe(
          REDIRECT_SENTINEL,
        );

        expect(signOutMock).toHaveBeenCalledTimes(1);
        expect(redirectMock).toHaveBeenCalledWith(
          "/sign-in",
        );

        const signOutOrder =
          signOutMock.mock.invocationCallOrder[0];

        const redirectOrder =
          redirectMock.mock.invocationCallOrder[0];

        expect(signOutOrder).toBeLessThan(
          redirectOrder,
        );
      },
    );
  },
);

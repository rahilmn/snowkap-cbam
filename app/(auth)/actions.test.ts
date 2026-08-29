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

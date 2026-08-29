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

const getServerSupabaseClientMock =
  vi.fn(
    () => (
      {
        auth: {
          signInWithPassword: signInWithPasswordMock,
          signUp: signUpMock,
        },
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

const { signInAction, signUpAction } =
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

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// 2026-08-29 (P13 audit response): app/onboarding/actions.ts previously
// had zero test coverage. Same "mock at the module boundary, dynamic-
// import after" shape app/(auth)/actions.test.ts and
// app/team/actions.test.ts already use -- this exercises the new
// rate-limit short-circuit and the new confirm-email error mapping
// (20260829460000_p13_review_onboarding_email_confirmation_hardening.sql)
// without a real Supabase call or a real clock/header read.

const getUserMock =
  vi.fn();

const rpcMock =
  vi.fn();

const getServerSupabaseClientMock =
  vi.fn(
    () => (
      {
        auth: {
          getUser: getUserMock,
        },
        rpc: rpcMock,
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

const { createOrganizationAction } =
  await import(
    "./actions"
  );

afterEach(() => {
  vi.clearAllMocks();
});

function formData(
  fields: Record<string, string | string[]>,
): FormData {
  const data =
    new FormData();

  for (
    const [key, value] of Object.entries(fields)
  ) {
    if (Array.isArray(value)) {
      for (const item of value) {
        data.append(key, item);
      }
    } else {
      data.set(key, value);
    }
  }

  return data;
}

function validFormData(): FormData {
  return formData(
    {
      name: "Acme Imports",
      slug: "acme-imports",
      capabilities: ["IMPORTER_DECLARANT"],
    },
  );
}

describe(
  "createOrganizationAction",
  () => {
    it(
      "returns a too-many-attempts error, without ever calling Supabase, when the limiter rejects",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: false, retryAfterMs: 42_100 },
        );

        const result =
          await createOrganizationAction(
            { status: "idle" },
            validFormData(),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Too many attempts. Try again in 43 seconds.",
          },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
        expect(rpcMock).not.toHaveBeenCalled();
      },
    );

    it(
      "returns a specific, honest error when the RPC rejects an unconfirmed caller's email (20260829460000)",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getUserMock.mockResolvedValueOnce(
          { data: { user: { id: "user-1" } } },
        );

        rpcMock.mockResolvedValueOnce(
          {
            data: null,
            error: {
              message:
                "Confirm your email address before creating an organization.",
            },
          },
        );

        const result =
          await createOrganizationAction(
            { status: "idle" },
            validFormData(),
          );

        expect(result).toEqual(
          {
            status: "error",
            message:
              "Confirm your email address before creating an organization -- check your inbox for the confirmation link.",
          },
        );
      },
    );

    it(
      "still maps a duplicate-slug rejection to its own message once the limiter allows the attempt",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getUserMock.mockResolvedValueOnce(
          { data: { user: { id: "user-1" } } },
        );

        rpcMock.mockResolvedValueOnce(
          {
            data: null,
            error: {
              message: "duplicate key value violates unique constraint",
              code: "23505",
            },
          },
        );

        const result =
          await createOrganizationAction(
            { status: "idle" },
            validFormData(),
          );

        expect(result).toEqual(
          {
            status: "error",
            message:
              "That organization URL is already taken -- try a different one.",
          },
        );
      },
    );
  },
);

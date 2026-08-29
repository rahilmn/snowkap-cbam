import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Same mock-at-the-module-boundary shape as app/(auth)/actions.test.ts
// -- these tests only exercise the rate-limit short-circuit at the
// top of each action, so getServerSupabaseClient is mocked purely to
// prove it's never CALLED on the rejected path, never to simulate a
// real response.
const getUserMock =
  vi.fn();

const getServerSupabaseClientMock =
  vi.fn(
    () => (
      {
        auth: { getUser: getUserMock },
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

const { acceptInvitationAction, acceptSharingGrantInvitationAction } =
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
  "acceptInvitationAction",
  () => {
    it(
      "returns a too-many-attempts error, in whole seconds, without ever calling Supabase, when the limiter rejects",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: false, retryAfterMs: 9_500 },
        );

        const result =
          await acceptInvitationAction(
            { status: "idle" },
            formData(
              { invitationId: "invitation-1" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Too many attempts. Try again in 10 seconds.",
          },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
        expect(getUserMock).not.toHaveBeenCalled();
      },
    );
  },
);

describe(
  "acceptSharingGrantInvitationAction",
  () => {
    it(
      "returns a too-many-attempts error without ever calling Supabase, when the limiter rejects",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: false, retryAfterMs: 200 },
        );

        const result =
          await acceptSharingGrantInvitationAction(
            { status: "idle" },
            formData(
              { grantId: "grant-1" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Too many attempts. Try again in 1 second.",
          },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
        expect(getUserMock).not.toHaveBeenCalled();
      },
    );
  },
);

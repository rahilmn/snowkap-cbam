import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Same "mock at the module boundary, dynamic-import after" shape
// app/auth/callback/actions.test.ts already uses.
const verifyOtpMock =
  vi.fn();

const getUserMock =
  vi.fn(
    (): Promise<{ data: { user: { email: string } | null } }> =>
      Promise.resolve(
        { data: { user: null } },
      ),
  );

vi.mock(
  "../../../src/infrastructure/supabase/server-client",
  () => (
    {
      getServerSupabaseClient: () =>
        Promise.resolve(
          {
            auth: {
              verifyOtp: verifyOtpMock,
              getUser: getUserMock,
            },
          },
        ),
    }
  ),
);

const checkMock =
  vi.fn(
    () => (
      { allowed: true, retryAfterMs: 0 }
    ),
  );

vi.mock(
  "../../../src/infrastructure/rate-limit/rate-limiter",
  () => (
    {
      createInMemoryRateLimiter: () => (
        { check: checkMock }
      ),
    }
  ),
);

vi.mock(
  "../../../components/shell/get-client-ip",
  () => (
    {
      getClientIp: () => Promise.resolve("127.0.0.1"),
    }
  ),
);

const REDIRECT_SENTINEL =
  "NEXT_REDIRECT";

const redirectMock =
  vi.fn(
    (target: string) => {
      throw Object.assign(
        new Error(REDIRECT_SENTINEL),
        { target },
      );
    },
  );

vi.mock(
  "next/navigation",
  () => (
    {
      redirect: (target: string) => redirectMock(target),
    }
  ),
);

const { confirmEmailLinkAction } =
  await import(
    "./actions"
  );

function formData(
  fields: Record<string, string>,
): FormData {
  const data =
    new FormData();

  for (const [key, value] of Object.entries(fields)) {
    data.set(
      key,
      value,
    );
  }

  return data;
}

async function redirectTargetOf(
  fields: Record<string, string>,
): Promise<string> {
  try {
    await confirmEmailLinkAction(
      { status: "idle" },
      formData(fields),
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

afterEach(() => {
  vi.clearAllMocks();

  checkMock.mockReturnValue(
    { allowed: true, retryAfterMs: 0 },
  );

  getUserMock.mockResolvedValue(
    { data: { user: null } },
  );
});

describe(
  "confirmEmailLinkAction",
  () => {
    it(
      "exchanges the token only on an explicit submission, with exactly the token_hash and type from the form",
      async () => {
        verifyOtpMock.mockResolvedValueOnce(
          { error: null },
        );

        const target =
          await redirectTargetOf(
            { token_hash: "hash-abc", type: "recovery", next: "/shipments" },
          );

        expect(verifyOtpMock).toHaveBeenCalledWith(
          {
            token_hash: "hash-abc",
            type: "recovery",
          },
        );

        expect(target).toBe(
          "/shipments",
        );
      },
    );

    it(
      "sends an invitation to the set-password step, ignoring any next the form carries",
      async () => {
        // GoTrue's invite verification confirms the account without the
        // invitee ever choosing a password, so skipping this step leaves
        // a real user with no way back in once the session lapses. A
        // hidden field must not be able to skip it.
        verifyOtpMock.mockResolvedValueOnce(
          { error: null },
        );

        expect(
          await redirectTargetOf(
            {
              token_hash: "hash-abc",
              type: "invite",
              next: "/accept-invitation",
            },
          ),
        ).toBe(
          "/reset-password?next=/accept-invitation",
        );
      },
    );

    it(
      "re-validates the next it was handed, because a hidden field is client-controlled at POST time",
      async () => {
        verifyOtpMock.mockResolvedValueOnce(
          { error: null },
        );

        expect(
          await redirectTargetOf(
            {
              token_hash: "hash-abc",
              type: "recovery",
              next: "//evil.example",
            },
          ),
        ).toBe(
          "/reset-password",
        );
      },
    );

    it(
      "rejects a type outside the allowlist without touching Supabase",
      async () => {
        const result =
          await confirmEmailLinkAction(
            { status: "idle" },
            formData(
              { token_hash: "hash-abc", type: "phone_change" },
            ),
          );

        expect(result.status).toBe(
          "error",
        );

        expect(verifyOtpMock).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects a missing token_hash without touching Supabase",
      async () => {
        const result =
          await confirmEmailLinkAction(
            { status: "idle" },
            formData(
              { type: "invite" },
            ),
          );

        expect(result.status).toBe(
          "error",
        );

        expect(verifyOtpMock).not.toHaveBeenCalled();
      },
    );

    it(
      "short-circuits on the rate limiter without touching Supabase, and reports it as a rate limit rather than an expired link",
      async () => {
        // Telling a user their link is invalid when the service is busy
        // sends them to request another one, which makes the limit worse
        // and throws away a link that would still have worked.
        checkMock.mockReturnValueOnce(
          { allowed: false, retryAfterMs: 30_000 },
        );

        const result =
          await confirmEmailLinkAction(
            { status: "idle" },
            formData(
              { token_hash: "hash-abc", type: "invite" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            code: "over_request_rate_limit",
            kind: "invite",
            signedInEmail: null,
          },
        );

        expect(verifyOtpMock).not.toHaveBeenCalled();
      },
    );

    it(
      "surfaces GoTrue's own code for a spent link, so the panel can explain the actual cause",
      async () => {
        verifyOtpMock.mockResolvedValueOnce(
          { error: { code: "otp_expired", message: "Email link is invalid or has expired" } },
        );

        const result =
          await confirmEmailLinkAction(
            { status: "idle" },
            formData(
              { token_hash: "hash-abc", type: "invite" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            code: "otp_expired",
            kind: "invite",
            signedInEmail: null,
          },
        );
      },
    );

    it(
      "names the already-signed-in identity when a spent link is opened in a browser that still holds a session",
      async () => {
        // The ordinary second click of an invitation whose first click
        // worked. Offering to carry on is right; doing it silently is
        // not, because the session may belong to a different person.
        verifyOtpMock.mockResolvedValueOnce(
          { error: { code: "otp_expired" } },
        );

        getUserMock.mockResolvedValueOnce(
          { data: { user: { email: "invitee@example.com" } } },
        );

        const result =
          await confirmEmailLinkAction(
            { status: "idle" },
            formData(
              { token_hash: "hash-abc", type: "invite" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            code: "otp_expired",
            kind: "invite",
            signedInEmail: "invitee@example.com",
          },
        );
      },
    );

    it(
      "reports a null code when GoTrue returns an error without one, rather than inventing a cause",
      async () => {
        verifyOtpMock.mockResolvedValueOnce(
          { error: { message: "boom" } },
        );

        const result =
          await confirmEmailLinkAction(
            { status: "idle" },
            formData(
              { token_hash: "hash-abc", type: "signup" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            code: null,
            kind: "signup",
            signedInEmail: null,
          },
        );
      },
    );
  },
);

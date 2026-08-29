import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// 2026-08-29 (P11 mandatory security review, finding #12 / N4): this
// file previously did not exist -- app/team/actions.ts had zero test
// coverage. Same "mock at the module boundary, dynamic-import after"
// shape app/(auth)/actions.test.ts already uses.

let mockHostHeader: string | null =
  "app.snowkap.example";

let mockForwardedHostHeader: string | null =
  null;

let mockForwardedProtoHeader: string | null =
  null;

vi.mock(
  "next/headers",
  () => (
    {
      headers: async () => (
        {
          get: (name: string) => {
            switch (name.toLowerCase()) {
              case "host":
                return mockHostHeader;
              case "x-forwarded-host":
                return mockForwardedHostHeader;
              case "x-forwarded-proto":
                return mockForwardedProtoHeader;
              default:
                return null;
            }
          },
        }
      ),
    }
  ),
);

vi.mock(
  "next/cache",
  () => (
    { revalidatePath: () => undefined }
  ),
);

const getServerSupabaseClientMock =
  vi.fn(
    () => ({}),
  );

vi.mock(
  "../../src/infrastructure/supabase/server-client",
  () => (
    {
      getServerSupabaseClient: () => getServerSupabaseClientMock(),
    }
  ),
);

const getSupabaseAdminClientMock =
  vi.fn(
    () => ({}),
  );

vi.mock(
  "../../src/infrastructure/supabase/admin-client",
  () => (
    {
      getSupabaseAdminClient: () => getSupabaseAdminClientMock(),
    }
  ),
);

const getCurrentOrgSummaryMock =
  vi.fn();

vi.mock(
  "../../src/application/organizations/get-current-org-context",
  () => (
    {
      getCurrentOrgSummary: (...args: unknown[]) => getCurrentOrgSummaryMock(...args),
    }
  ),
);

const inviteMemberMock =
  vi.fn();

vi.mock(
  "../../src/application/organizations/invitations",
  () => (
    {
      inviteMember: (...args: unknown[]) => inviteMemberMock(...args),
      revokeInvitation: vi.fn(),
    }
  ),
);

vi.mock(
  "../../components/shell/get-preferred-org-id",
  () => (
    { getPreferredOrgId: async () => "preferred-org-id" }
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
    { getClientIp: async () => "203.0.113.1" }
  ),
);

const { getAppOrigin, inviteMemberAction } =
  await import(
    "./actions"
  );

afterEach(() => {
  vi.clearAllMocks();
  mockHostHeader = "app.snowkap.example";
  mockForwardedHostHeader = null;
  mockForwardedProtoHeader = null;
  delete process.env.APP_URL;
});

function formData(
  fields: Record<string, string>,
): FormData {
  const data =
    new FormData();

  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }

  return data;
}

describe(
  "getAppOrigin",
  () => {
    it(
      "prefers a configured APP_URL, unconditionally, over any request header",
      async () => {
        process.env.APP_URL =
          "https://app.snowkap.com/";

        mockHostHeader =
          "attacker.example";

        expect(await getAppOrigin()).toBe(
          "https://app.snowkap.com",
        );
      },
    );

    it(
      "derives the origin from headers for a trusted local host (localhost:3000)",
      async () => {
        mockHostHeader =
          "localhost:3000";

        expect(await getAppOrigin()).toBe(
          "http://localhost:3000",
        );
      },
    );

    it(
      "derives the origin from headers for a trusted local host (127.0.0.1)",
      async () => {
        mockHostHeader =
          "127.0.0.1:3000";

        expect(await getAppOrigin()).toBe(
          "http://127.0.0.1:3000",
        );
      },
    );

    it(
      // 2026-08-29 (P11 finding #12, live-reproduced): an ADMIN
      // inviting a real person while sending
      // `X-Forwarded-Host: attacker.example` used to produce an
      // invite email whose redirect link pointed at that host. This
      // is the regression test for that exploit.
      "falls back to the safe default rather than trusting an untrusted x-forwarded-host, with no APP_URL configured",
      async () => {
        mockForwardedHostHeader =
          "attacker.example";

        expect(await getAppOrigin()).toBe(
          "http://localhost:3000",
        );
      },
    );

    it(
      "falls back to the safe default rather than trusting an untrusted bare host header",
      async () => {
        mockHostHeader =
          "attacker.example";

        expect(await getAppOrigin()).toBe(
          "http://localhost:3000",
        );
      },
    );
  },
);

describe(
  "inviteMemberAction",
  () => {
    it(
      "returns a too-many-invitations error, without ever calling Supabase, when the limiter rejects (P11 finding N4)",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: false, retryAfterMs: 61_000 },
        );

        const result =
          await inviteMemberAction(
            { status: "idle" },
            formData(
              { email: "colleague@example.com", role: "MEMBER" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Too many invitations sent. Try again in 61 seconds.",
          },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
        expect(getCurrentOrgSummaryMock).not.toHaveBeenCalled();
        expect(inviteMemberMock).not.toHaveBeenCalled();
      },
    );

    it(
      "proceeds to the real invite flow when the limiter allows",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: "org-1" } },
        );

        inviteMemberMock.mockResolvedValueOnce(
          { status: "OK" },
        );

        const result =
          await inviteMemberAction(
            { status: "idle" },
            formData(
              { email: "colleague@example.com", role: "MEMBER" },
            ),
          );

        expect(result).toEqual(
          { status: "idle" },
        );

        expect(inviteMemberMock).toHaveBeenCalledTimes(1);
      },
    );
  },
);

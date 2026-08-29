import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// 2026-08-29 (P11 mandatory security review, N4): this file previously
// did not exist. Same mock-at-the-module-boundary shape as
// app/team/actions.test.ts -- these tests exercise only the rate-limit
// short-circuit each action now has, never real Supabase I/O.
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
  "../../../src/infrastructure/supabase/server-client",
  () => (
    {
      getServerSupabaseClient: () => getServerSupabaseClientMock(),
    }
  ),
);

const getCurrentOrgSummaryMock =
  vi.fn();

vi.mock(
  "../../../src/application/organizations/get-current-org-context",
  () => (
    {
      getCurrentOrgSummary: (...args: unknown[]) => getCurrentOrgSummaryMock(...args),
    }
  ),
);

vi.mock(
  "../../../components/shell/get-preferred-org-id",
  () => (
    { getPreferredOrgId: async () => "preferred-org-id" }
  ),
);

const issueSharingGrantMock =
  vi.fn();

const revokeSharingGrantMock =
  vi.fn();

vi.mock(
  "../../../src/application/sharing/manage-sharing-grants",
  () => (
    {
      issueSharingGrant: (...args: unknown[]) => issueSharingGrantMock(...args),
      revokeSharingGrant: (...args: unknown[]) => revokeSharingGrantMock(...args),
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
    { getClientIp: async () => "203.0.113.1" }
  ),
);

const { inviteByEmailAction, revokeSharingGrantAction } =
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

  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }

  return data;
}

describe(
  "inviteByEmailAction",
  () => {
    it(
      "returns a too-many-invitations error, without ever calling Supabase, when the limiter rejects",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: false, retryAfterMs: 30_000 },
        );

        const result =
          await inviteByEmailAction(
            { status: "idle" },
            formData(
              { installationId: "installation-1", email: "buyer@example.com" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Too many invitations sent. Try again in 30 seconds.",
          },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
        expect(issueSharingGrantMock).not.toHaveBeenCalled();
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

        issueSharingGrantMock.mockResolvedValueOnce(
          { status: "OK", grant: {} },
        );

        const result =
          await inviteByEmailAction(
            { status: "idle" },
            formData(
              { installationId: "installation-1", email: "buyer@example.com" },
            ),
          );

        expect(result).toEqual(
          { status: "idle" },
        );

        expect(issueSharingGrantMock).toHaveBeenCalledTimes(1);
      },
    );
  },
);

describe(
  "revokeSharingGrantAction",
  () => {
    it(
      "returns a too-many-attempts error, without ever calling Supabase, when the limiter rejects",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: false, retryAfterMs: 15_000 },
        );

        const result =
          await revokeSharingGrantAction(
            { status: "idle" },
            formData(
              { grantId: "grant-1" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Too many attempts. Try again in 15 seconds.",
          },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
        expect(revokeSharingGrantMock).not.toHaveBeenCalled();
      },
    );

    it(
      "proceeds to the real revoke flow when the limiter allows",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: "org-1" } },
        );

        revokeSharingGrantMock.mockResolvedValueOnce(
          { status: "OK", grant: {} },
        );

        const result =
          await revokeSharingGrantAction(
            { status: "idle" },
            formData(
              { grantId: "grant-1" },
            ),
          );

        expect(result).toEqual(
          { status: "idle" },
        );

        expect(revokeSharingGrantMock).toHaveBeenCalledTimes(1);
      },
    );
  },
);

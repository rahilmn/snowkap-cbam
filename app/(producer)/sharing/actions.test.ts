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

// 2026-08-30 (test-coverage audit): the tests above only exercise the
// rate-limit short-circuit and the OK happy path for each action.
// Untested: the zod validation-failure branch for both actions,
// requireOrgContext's "not a member of an organization" branch, and
// the full REJECTED-reason message mapping each action's
// switch/if-chain applies. These tests close that gap; they don't
// touch any test above.
describe(
  "inviteByEmailAction validation",
  () => {
    it(
      "returns the schema's email message when the email fails validation",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        const result =
          await inviteByEmailAction(
            { status: "idle" },
            formData(
              { installationId: "installation-1", email: "not-an-email" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Enter a valid email address.",
          },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
        expect(issueSharingGrantMock).not.toHaveBeenCalled();
      },
    );

    it(
      "returns the schema's installationId message when installationId is empty",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        const result =
          await inviteByEmailAction(
            { status: "idle" },
            formData(
              { installationId: "", email: "buyer@example.com" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Choose an installation.",
          },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
        expect(issueSharingGrantMock).not.toHaveBeenCalled();
      },
    );

    it(
      "returns the not-a-member error when the caller has no current org context",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          null,
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
            message: "You are not a member of an organization.",
          },
        );

        expect(issueSharingGrantMock).not.toHaveBeenCalled();
      },
    );
  },
);

describe(
  "inviteByEmailAction REJECTED-reason mapping",
  () => {
    it(
      "maps PERMISSION_DENIED to the ADMIN/OWNER message",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: "org-1" } },
        );

        issueSharingGrantMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "PERMISSION_DENIED" },
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
            message: "Only an ADMIN or OWNER can share data.",
          },
        );
      },
    );

    it(
      "maps CAPABILITY_NOT_HELD to the not-a-producer message",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: "org-1" } },
        );

        issueSharingGrantMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "CAPABILITY_NOT_HELD" },
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
            message: "Your organization is not set up as a CBAM producer/operator.",
          },
        );
      },
    );

    it(
      "maps INSTALLATION_NOT_FOUND to the choose-a-valid-installation message",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: "org-1" } },
        );

        issueSharingGrantMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "INSTALLATION_NOT_FOUND" },
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
            message: "Choose a valid installation.",
          },
        );
      },
    );

    it(
      "maps INVALID_INPUT to the valid-email message",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: "org-1" } },
        );

        issueSharingGrantMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "INVALID_INPUT" },
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
            message: "Enter a valid email address.",
          },
        );
      },
    );

    it(
      "falls back to the generic error message for an unmapped REJECTED reason",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: "org-1" } },
        );

        issueSharingGrantMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "SOME_UNMAPPED_REASON" },
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
            message: "Something went wrong. Please try again.",
          },
        );
      },
    );
  },
);

describe(
  "revokeSharingGrantAction validation",
  () => {
    it(
      "returns a generic invalid-request error when grantId is empty",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        const result =
          await revokeSharingGrantAction(
            { status: "idle" },
            formData(
              { grantId: "" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Invalid request.",
          },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
        expect(revokeSharingGrantMock).not.toHaveBeenCalled();
      },
    );

    it(
      "returns the not-a-member error when the caller has no current org context",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          undefined,
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
            message: "You are not a member of an organization.",
          },
        );

        expect(revokeSharingGrantMock).not.toHaveBeenCalled();
      },
    );

    it(
      "tells a MEMBER who can revoke, rather than showing a generic failure (P14, F7)",
      async () => {
        // 2026-09-03. This asserted the generic
        // "Something went wrong. Please try again." for
        // PERMISSION_DENIED -- which sends a MEMBER round the retry loop
        // for a refusal that will never succeed. The assertion is
        // retargeted, not weakened: the generic message still covers
        // every reason that genuinely is unexpected, asserted below.
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: "org-1" } },
        );

        revokeSharingGrantMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "PERMISSION_DENIED" },
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
            message: "Only an ADMIN or OWNER can revoke a sharing grant.",
          },
        );
      },
    );

    it(
      "still falls back to the generic message for a genuinely unexpected rejection",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: "org-1" } },
        );

        revokeSharingGrantMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "PERSIST_FAILED" },
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
            message: "Something went wrong. Please try again.",
          },
        );
      },
    );
  },
);

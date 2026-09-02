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

const revokeInvitationMock =
  vi.fn();

vi.mock(
  "../../src/application/organizations/invitations",
  () => (
    {
      inviteMember: (...args: unknown[]) => inviteMemberMock(...args),
      revokeInvitation: (...args: unknown[]) => revokeInvitationMock(...args),
    }
  ),
);

const changeMemberRoleMock =
  vi.fn();

const removeMemberMock =
  vi.fn();

const deactivateMemberMock =
  vi.fn();

const reactivateMemberMock =
  vi.fn();

vi.mock(
  "../../src/application/organizations/manage-membership",
  () => (
    {
      changeMemberRole: (...args: unknown[]) => changeMemberRoleMock(...args),
      removeMember: (...args: unknown[]) => removeMemberMock(...args),
      deactivateMember: (...args: unknown[]) => deactivateMemberMock(...args),
      reactivateMember: (...args: unknown[]) => reactivateMemberMock(...args),
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

const {
  getAppOrigin,
  inviteMemberAction,
  changeRoleAction,
  removeMemberAction,
  deactivateMemberAction,
  reactivateMemberAction,
  revokeInvitationAction,
} =
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

// 2026-08-30 (P13 final non-blocked-work audit, confirmed via
// adversarial verify): changeRoleAction, removeMemberAction,
// deactivateMemberAction, reactivateMemberAction, and
// revokeInvitationAction had zero rate limiting -- inconsistent with
// every comparable mutation/revoke action elsewhere in this codebase
// (inviteMemberAction above, and revokeSharingGrantAction in
// app/(producer)/sharing/actions.ts, which this file's revoke test
// deliberately mirrors: same 30/10min shape, same "reject before
// touching Supabase" assertion style).
describe(
  "rate limiting (P13 final audit finding, missing-rate-limit)",
  () => {
    it(
      "changeRoleAction rejects without calling changeMemberRole when the limiter rejects",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: false, retryAfterMs: 30_000 },
        );

        const result =
          await changeRoleAction(
            { status: "idle" },
            formData(
              { membershipId: "membership-1", role: "ADMIN" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Too many attempts. Try again in 30 seconds.",
          },
        );

        expect(getCurrentOrgSummaryMock).not.toHaveBeenCalled();
        expect(changeMemberRoleMock).not.toHaveBeenCalled();
      },
    );

    it(
      "removeMemberAction rejects without calling removeMember when the limiter rejects",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: false, retryAfterMs: 30_000 },
        );

        const result =
          await removeMemberAction(
            { status: "idle" },
            formData(
              { membershipId: "membership-1" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Too many attempts. Try again in 30 seconds.",
          },
        );

        expect(getCurrentOrgSummaryMock).not.toHaveBeenCalled();
        expect(removeMemberMock).not.toHaveBeenCalled();
      },
    );

    it(
      "deactivateMemberAction rejects without calling deactivateMember when the limiter rejects",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: false, retryAfterMs: 30_000 },
        );

        const result =
          await deactivateMemberAction(
            { status: "idle" },
            formData(
              { membershipId: "membership-1" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Too many attempts. Try again in 30 seconds.",
          },
        );

        expect(getCurrentOrgSummaryMock).not.toHaveBeenCalled();
        expect(deactivateMemberMock).not.toHaveBeenCalled();
      },
    );

    it(
      "reactivateMemberAction rejects without calling reactivateMember when the limiter rejects",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: false, retryAfterMs: 30_000 },
        );

        const result =
          await reactivateMemberAction(
            { status: "idle" },
            formData(
              { membershipId: "membership-1" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Too many attempts. Try again in 30 seconds.",
          },
        );

        expect(getCurrentOrgSummaryMock).not.toHaveBeenCalled();
        expect(reactivateMemberMock).not.toHaveBeenCalled();
      },
    );

    it(
      "revokeInvitationAction rejects without calling revokeInvitation when the limiter rejects",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: false, retryAfterMs: 30_000 },
        );

        const result =
          await revokeInvitationAction(
            { status: "idle" },
            formData(
              { invitationId: "invitation-1" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Too many attempts. Try again in 30 seconds.",
          },
        );

        expect(revokeInvitationMock).not.toHaveBeenCalled();
      },
    );

    it(
      "still performs the real mutation when the limiter allows (changeRoleAction, as a representative case)",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: "org-1" } },
        );

        changeMemberRoleMock.mockResolvedValueOnce(
          { status: "OK" },
        );

        const result =
          await changeRoleAction(
            { status: "idle" },
            formData(
              { membershipId: "membership-1", role: "ADMIN" },
            ),
          );

        expect(result).toEqual(
          { status: "idle" },
        );

        expect(changeMemberRoleMock).toHaveBeenCalledTimes(1);
      },
    );
  },
);

// 2026-08-30: the P13 final audit round above added rate-limit-rejection
// coverage for all five actions but only one happy-path assertion
// (changeRoleAction, "as a representative case"). removeMemberAction,
// deactivateMemberAction, and reactivateMemberAction's own calls into
// their respective mocked application functions were never actually
// exercised on the allowed-through path.
describe(
  "membership mutation actions (happy path, limiter allows)",
  () => {
    it(
      "removeMemberAction calls removeMember and returns idle",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: "org-1" } },
        );

        removeMemberMock.mockResolvedValueOnce(
          { status: "OK" },
        );

        const result =
          await removeMemberAction(
            { status: "idle" },
            formData(
              { membershipId: "membership-1" },
            ),
          );

        expect(result).toEqual(
          { status: "idle" },
        );

        expect(removeMemberMock).toHaveBeenCalledTimes(1);
      },
    );

    it(
      "deactivateMemberAction calls deactivateMember and returns idle",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: "org-1" } },
        );

        deactivateMemberMock.mockResolvedValueOnce(
          { status: "OK" },
        );

        const result =
          await deactivateMemberAction(
            { status: "idle" },
            formData(
              { membershipId: "membership-1" },
            ),
          );

        expect(result).toEqual(
          { status: "idle" },
        );

        expect(deactivateMemberMock).toHaveBeenCalledTimes(1);
      },
    );

    it(
      "reactivateMemberAction calls reactivateMember and returns idle",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: "org-1" } },
        );

        reactivateMemberMock.mockResolvedValueOnce(
          { status: "OK" },
        );

        const result =
          await reactivateMemberAction(
            { status: "idle" },
            formData(
              { membershipId: "membership-1" },
            ),
          );

        expect(result).toEqual(
          { status: "idle" },
        );

        expect(reactivateMemberMock).toHaveBeenCalledTimes(1);
      },
    );
  },
);

// 2026-08-30: messageFor() (app/team/actions.ts) maps each REJECTED
// result's `reason` to a user-facing message, but no existing test ever
// drove any action down its REJECTED branch -- every prior test either
// hit the rate limiter or the OK path. One test per action below,
// each with a reason relevant to that action's own invariant, asserting
// the exact message string messageFor() returns for it.
describe(
  "REJECTED result -> messageFor() message mapping",
  () => {
    it(
      "changeRoleAction surfaces the ONLY_OWNER_CAN_GRANT_OWNERSHIP message",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: "org-1" } },
        );

        changeMemberRoleMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "ONLY_OWNER_CAN_GRANT_OWNERSHIP" },
        );

        const result =
          await changeRoleAction(
            { status: "idle" },
            formData(
              { membershipId: "membership-1", role: "OWNER" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Only an OWNER can grant OWNER to another member.",
          },
        );
      },
    );

    it(
      "removeMemberAction surfaces the LAST_OWNER message",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: "org-1" } },
        );

        removeMemberMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "LAST_OWNER" },
        );

        const result =
          await removeMemberAction(
            { status: "idle" },
            formData(
              { membershipId: "membership-1" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "This organization must always have at least one OWNER.",
          },
        );
      },
    );

    it(
      "deactivateMemberAction surfaces the LAST_OWNER message",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: "org-1" } },
        );

        deactivateMemberMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "LAST_OWNER" },
        );

        const result =
          await deactivateMemberAction(
            { status: "idle" },
            formData(
              { membershipId: "membership-1" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "This organization must always have at least one OWNER.",
          },
        );
      },
    );

    it(
      "reactivateMemberAction surfaces the NOT_DEACTIVATED message",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: "org-1" } },
        );

        reactivateMemberMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "NOT_DEACTIVATED" },
        );

        const result =
          await reactivateMemberAction(
            { status: "idle" },
            formData(
              { membershipId: "membership-1" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "That member is already active.",
          },
        );
      },
    );
  },
);

// 2026-08-30: revokeInvitationAction's own error handling doesn't go
// through messageFor() at all -- it checks result.status ===
// "PERSIST_FAILED" directly (see app/team/actions.ts) -- and neither
// that branch nor its own OK/happy path had ever been exercised.
describe(
  "revokeInvitationAction",
  () => {
    it(
      "returns a generic error message when revokeInvitation reports PERSIST_FAILED",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        // 2026-09-03 (P14, F5): the action resolves an OrgContext now,
        // so revokeInvitation can check the caller's role, pin the write
        // to the ACTIVE organization, and attribute the audit event it
        // writes.
        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: "org-1", user_id: "u-1", role: "ADMIN" } },
        );

        revokeInvitationMock.mockResolvedValueOnce(
          { status: "PERSIST_FAILED" },
        );

        const result =
          await revokeInvitationAction(
            { status: "idle" },
            formData(
              { invitationId: "invitation-1" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Something went wrong. Please try again.",
          },
        );

        expect(revokeInvitationMock).toHaveBeenCalledTimes(1);
      },
    );

    it(
      "tells a MEMBER who can revoke, rather than showing a generic failure (P14, F5)",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: "org-1", user_id: "u-1", role: "ADMIN" } },
        );

        revokeInvitationMock.mockResolvedValueOnce(
          { status: "PERMISSION_DENIED" },
        );

        const result =
          await revokeInvitationAction(
            { status: "idle" },
            formData(
              { invitationId: "invitation-1" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Only an ADMIN or OWNER can revoke an invitation.",
          },
        );
      },
    );

    it(
      "calls revokeInvitation and returns idle when it succeeds",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        // 2026-09-03 (P14, F5): the action resolves an OrgContext now,
        // so revokeInvitation can check the caller's role, pin the write
        // to the ACTIVE organization, and attribute the audit event it
        // writes.
        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: "org-1", user_id: "u-1", role: "ADMIN" } },
        );

        revokeInvitationMock.mockResolvedValueOnce(
          { status: "OK" },
        );

        const result =
          await revokeInvitationAction(
            { status: "idle" },
            formData(
              { invitationId: "invitation-1" },
            ),
          );

        expect(result).toEqual(
          { status: "idle" },
        );

        expect(revokeInvitationMock).toHaveBeenCalledTimes(1);
      },
    );
  },
);

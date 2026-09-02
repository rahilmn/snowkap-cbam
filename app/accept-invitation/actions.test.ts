import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Same mock-at-the-module-boundary shape as app/(auth)/actions.test.ts
// -- covers both actions' rate-limit short-circuit (getServerSupabaseClient
// mocked purely to prove it's never CALLED on the rejected path) and,
// below, every real outcome branch (validation failure, the
// unauthenticated redirect, and each case of both status switches),
// with acceptInvitation/acceptSharingGrantInvitation mocked since
// those application functions already have their own unit tests --
// this file is only testing the Server Actions' own gating and
// status-to-message mapping.
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

// next/navigation's redirect() throws a Next-internal signal outside a
// real request context (see app/(auth)/actions.test.ts's own header
// comment for the same technique) -- this sentinel lets the
// unauthenticated-user and OK/ALREADY_MEMBER redirect tests below
// assert redirect() was actually reached, and with which path, without
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

const revalidatePathMock =
  vi.fn();

vi.mock(
  "next/cache",
  () => (
    {
      revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
    }
  ),
);

const acceptInvitationMock =
  vi.fn();

vi.mock(
  "../../src/application/organizations/invitations",
  () => (
    {
      acceptInvitation: (...args: unknown[]) => acceptInvitationMock(...args),
    }
  ),
);

const acceptSharingGrantInvitationMock =
  vi.fn();

vi.mock(
  "../../src/application/sharing/manage-sharing-grants",
  () => (
    {
      acceptSharingGrantInvitation: (...args: unknown[]) => acceptSharingGrantInvitationMock(...args),
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

vi.mock(
  "../../components/shell/get-preferred-org-id",
  () => (
    { getPreferredOrgId: async () => "preferred-org-id" }
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

    it(
      "returns an invalid-request error, without calling Supabase, when invitationId fails validation",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        const result =
          await acceptInvitationAction(
            { status: "idle" },
            formData(
              { invitationId: "" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Invalid request.",
          },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
        expect(acceptInvitationMock).not.toHaveBeenCalled();
      },
    );

    it(
      "redirects to /sign-in without calling acceptInvitation, when there is no authenticated user",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getUserMock.mockResolvedValueOnce(
          { data: { user: null } },
        );

        await expect(
          acceptInvitationAction(
            { status: "idle" },
            formData(
              { invitationId: "invitation-1" },
            ),
          ),
        ).rejects.toBe(
          REDIRECT_SENTINEL,
        );

        expect(redirectMock).toHaveBeenCalledWith(
          "/sign-in",
        );

        expect(acceptInvitationMock).not.toHaveBeenCalled();
      },
    );

    it(
      "revalidates /team and redirects to / when acceptInvitation returns OK",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getUserMock.mockResolvedValueOnce(
          { data: { user: { id: "user-1" } } },
        );

        acceptInvitationMock.mockResolvedValueOnce(
          { status: "OK" },
        );

        await expect(
          acceptInvitationAction(
            { status: "idle" },
            formData(
              { invitationId: "invitation-1" },
            ),
          ),
        ).rejects.toBe(
          REDIRECT_SENTINEL,
        );

        expect(revalidatePathMock).toHaveBeenCalledWith(
          "/team",
        );

        expect(redirectMock).toHaveBeenCalledWith(
          "/",
        );
      },
    );

    it(
      "revalidates /team and redirects to / when acceptInvitation returns ALREADY_MEMBER",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getUserMock.mockResolvedValueOnce(
          { data: { user: { id: "user-1" } } },
        );

        acceptInvitationMock.mockResolvedValueOnce(
          { status: "ALREADY_MEMBER" },
        );

        await expect(
          acceptInvitationAction(
            { status: "idle" },
            formData(
              { invitationId: "invitation-1" },
            ),
          ),
        ).rejects.toBe(
          REDIRECT_SENTINEL,
        );

        expect(revalidatePathMock).toHaveBeenCalledWith(
          "/team",
        );

        expect(redirectMock).toHaveBeenCalledWith(
          "/",
        );
      },
    );

    it(
      "returns an expired-invitation error when acceptInvitation returns EXPIRED",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getUserMock.mockResolvedValueOnce(
          { data: { user: { id: "user-1" } } },
        );

        acceptInvitationMock.mockResolvedValueOnce(
          { status: "EXPIRED" },
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
            message: "This invitation has expired. Ask the organization to send a new one.",
          },
        );
      },
    );

    it(
      "returns an email-mismatch error when acceptInvitation returns EMAIL_MISMATCH",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getUserMock.mockResolvedValueOnce(
          { data: { user: { id: "user-1" } } },
        );

        acceptInvitationMock.mockResolvedValueOnce(
          { status: "EMAIL_MISMATCH" },
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
            message: "This invitation was sent to a different email address than the one you're signed in with.",
          },
        );
      },
    );

    it(
      "returns an already-used error when acceptInvitation returns NOT_PENDING",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getUserMock.mockResolvedValueOnce(
          { data: { user: { id: "user-1" } } },
        );

        acceptInvitationMock.mockResolvedValueOnce(
          { status: "NOT_PENDING" },
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
            message: "This invitation is no longer valid -- it was already used or has been revoked. Ask the organization to send a new one.",
          },
        );
      },
    );

    it(
      "returns a membership-deactivated error when acceptInvitation returns MEMBERSHIP_DEACTIVATED",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getUserMock.mockResolvedValueOnce(
          { data: { user: { id: "user-1" } } },
        );

        acceptInvitationMock.mockResolvedValueOnce(
          { status: "MEMBERSHIP_DEACTIVATED" },
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
            message: "Your access to this organization was deactivated. Ask an administrator there to reactivate you — this invitation stays valid until they do.",
          },
        );
      },
    );

    it(
      "returns a not-found error for any unrecognized acceptInvitation status",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getUserMock.mockResolvedValueOnce(
          { data: { user: { id: "user-1" } } },
        );

        acceptInvitationMock.mockResolvedValueOnce(
          { status: "NOT_FOUND" },
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
            message: "That invitation could not be found.",
          },
        );
      },
    );
  },
);

/**
 * 2026-09-03 (P14). The organization a sharing grant is accepted into is
 * submitted by the user, not read from the active-organization cookie,
 * so these cases have to supply it -- and one of them has to prove the
 * action refuses a value the caller is not a member of.
 */
const ACCEPTING_ORG_ID =
  "11111111-1111-4111-8111-111111111111";

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
              { grantId: "grant-1", orgId: ACCEPTING_ORG_ID },
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

    it(
      "returns an invalid-request error, without calling Supabase, when grantId fails validation",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        const result =
          await acceptSharingGrantInvitationAction(
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
        expect(acceptSharingGrantInvitationMock).not.toHaveBeenCalled();
      },
    );

    it(
      "returns a need-an-organization error, without calling acceptSharingGrantInvitation, when the caller has no current org",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          null,
        );

        const result =
          await acceptSharingGrantInvitationAction(
            { status: "idle" },
            formData(
              { grantId: "grant-1", orgId: ACCEPTING_ORG_ID },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "You need to belong to an organization before you can accept a data-sharing invitation.",
          },
        );

        expect(acceptSharingGrantInvitationMock).not.toHaveBeenCalled();
      },
    );

    it(
      "revalidates /accept-invitation and returns idle when acceptSharingGrantInvitation returns OK",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: ACCEPTING_ORG_ID } },
        );

        acceptSharingGrantInvitationMock.mockResolvedValueOnce(
          { status: "OK" },
        );

        const result =
          await acceptSharingGrantInvitationAction(
            { status: "idle" },
            formData(
              { grantId: "grant-1", orgId: ACCEPTING_ORG_ID },
            ),
          );

        expect(result).toEqual(
          { status: "idle" },
        );

        expect(revalidatePathMock).toHaveBeenCalledWith(
          "/accept-invitation",
        );
      },
    );

    it(
      "returns an expired-invitation error when acceptSharingGrantInvitation returns EXPIRED",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: ACCEPTING_ORG_ID } },
        );

        acceptSharingGrantInvitationMock.mockResolvedValueOnce(
          { status: "EXPIRED" },
        );

        const result =
          await acceptSharingGrantInvitationAction(
            { status: "idle" },
            formData(
              { grantId: "grant-1", orgId: ACCEPTING_ORG_ID },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "This invitation has expired. Ask the producer to send a new one.",
          },
        );
      },
    );

    it(
      "returns an email-mismatch error when acceptSharingGrantInvitation returns EMAIL_MISMATCH",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: ACCEPTING_ORG_ID } },
        );

        acceptSharingGrantInvitationMock.mockResolvedValueOnce(
          { status: "EMAIL_MISMATCH" },
        );

        const result =
          await acceptSharingGrantInvitationAction(
            { status: "idle" },
            formData(
              { grantId: "grant-1", orgId: ACCEPTING_ORG_ID },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "This invitation was sent to a different email address than the one you're signed in with.",
          },
        );
      },
    );

    it(
      "returns an already-used-or-revoked error when acceptSharingGrantInvitation returns NOT_PENDING",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: ACCEPTING_ORG_ID } },
        );

        acceptSharingGrantInvitationMock.mockResolvedValueOnce(
          { status: "NOT_PENDING" },
        );

        const result =
          await acceptSharingGrantInvitationAction(
            { status: "idle" },
            formData(
              { grantId: "grant-1", orgId: ACCEPTING_ORG_ID },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "This invitation has already been used or revoked.",
          },
        );
      },
    );

    it(
      "returns a self-grant-not-allowed error when acceptSharingGrantInvitation returns SELF_GRANT_NOT_ALLOWED",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: ACCEPTING_ORG_ID } },
        );

        acceptSharingGrantInvitationMock.mockResolvedValueOnce(
          { status: "SELF_GRANT_NOT_ALLOWED" },
        );

        const result =
          await acceptSharingGrantInvitationAction(
            { status: "idle" },
            formData(
              { grantId: "grant-1", orgId: ACCEPTING_ORG_ID },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "You can't accept an invitation into the organization that issued it.",
          },
        );
      },
    );

    it(
      "returns a not-a-member error when acceptSharingGrantInvitation returns NOT_A_MEMBER",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: ACCEPTING_ORG_ID } },
        );

        acceptSharingGrantInvitationMock.mockResolvedValueOnce(
          { status: "NOT_A_MEMBER" },
        );

        const result =
          await acceptSharingGrantInvitationAction(
            { status: "idle" },
            formData(
              { grantId: "grant-1", orgId: ACCEPTING_ORG_ID },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "You are not a member of your currently active organization.",
          },
        );
      },
    );

    it(
      "returns an already-granted error when acceptSharingGrantInvitation returns ALREADY_GRANTED",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: ACCEPTING_ORG_ID } },
        );

        acceptSharingGrantInvitationMock.mockResolvedValueOnce(
          { status: "ALREADY_GRANTED" },
        );

        const result =
          await acceptSharingGrantInvitationAction(
            { status: "idle" },
            formData(
              { grantId: "grant-1", orgId: ACCEPTING_ORG_ID },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Your organization already has access to this installation's data through another grant.",
          },
        );
      },
    );

    it(
      "returns a not-found error for any unrecognized acceptSharingGrantInvitation status",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: ACCEPTING_ORG_ID } },
        );

        acceptSharingGrantInvitationMock.mockResolvedValueOnce(
          { status: "NOT_FOUND" },
        );

        const result =
          await acceptSharingGrantInvitationAction(
            { status: "idle" },
            formData(
              { grantId: "grant-1", orgId: ACCEPTING_ORG_ID },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "That invitation could not be found.",
          },
        );
      },
    );

    it(
      "returns an invalid-request error, without calling Supabase, when no organization was chosen",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
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
            message: "Invalid request.",
          },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
        expect(acceptSharingGrantInvitationMock).not.toHaveBeenCalled();
      },
    );

    it(
      "resolves the org context from the SUBMITTED organization, never from the active-organization cookie",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: ACCEPTING_ORG_ID } },
        );

        acceptSharingGrantInvitationMock.mockResolvedValueOnce(
          { status: "OK" },
        );

        await acceptSharingGrantInvitationAction(
          { status: "idle" },
          formData(
            { grantId: "grant-1", orgId: ACCEPTING_ORG_ID },
          ),
        );

        expect(getCurrentOrgSummaryMock).toHaveBeenCalledWith(
          expect.anything(),
          ACCEPTING_ORG_ID,
        );
      },
    );

    it(
      "refuses, without calling acceptSharingGrantInvitation, when the resolved org is not the one that was chosen",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        // getCurrentOrgSummary treats its argument as a PREFERENCE: an
        // id the caller is not a member of falls back to their oldest
        // membership. That silent fallback is the whole defect being
        // closed -- binding a producer's data to an organization the
        // user did not choose -- so the action must notice and refuse.
        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: "22222222-2222-4222-8222-222222222222" } },
        );

        const result =
          await acceptSharingGrantInvitationAction(
            { status: "idle" },
            formData(
              { grantId: "grant-1", orgId: ACCEPTING_ORG_ID },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "You are not a member of the organization you chose. Reload the page and try again.",
          },
        );

        expect(acceptSharingGrantInvitationMock).not.toHaveBeenCalled();
      },
    );

    it(
      "surfaces CAPABILITY_NOT_HELD as an importer-organization message",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: ACCEPTING_ORG_ID } },
        );

        acceptSharingGrantInvitationMock.mockResolvedValueOnce(
          { status: "CAPABILITY_NOT_HELD" },
        );

        const result =
          await acceptSharingGrantInvitationAction(
            { status: "idle" },
            formData(
              { grantId: "grant-1", orgId: ACCEPTING_ORG_ID },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message:
              "Shared emissions data can only be accepted into an importer / " +
              "declarant organization. Switch to one and try again.",
          },
        );
      },
    );
  },
);

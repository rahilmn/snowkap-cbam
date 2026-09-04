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
//
// 2026-09-05 (SME plan v2.1.1 §3, F16): extended, not replaced, for the
// onboarding-reconciliation membership pre-check and the lost-response/
// genuine-conflict 23505 disambiguation -- both new to
// createOrganizationAction. The mock Supabase client below now also
// answers `.from("memberships")...`, and `next/navigation`'s `redirect`
// is now mocked too, since the new code paths (and the pre-existing
// success path, which had no test before) actually reach it.

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

const getUserMock =
  vi.fn();

const rpcMock =
  vi.fn();

// Consumed in FIFO order by each `.from("memberships")...` chain call
// -- the reconciliation logic calls this once before the RPC and
// (only on a 23505) once again after, so a test can script "no
// membership, then (after the RPC) a membership now exists" without a
// stateful fake table. Defaults to "no membership" for every call a
// test doesn't explicitly queue, which is what every ORIGINAL test
// below implicitly needs (none of them are testing the pre-check
// itself).
let membershipQueryResults: Array<{ data: { org_id: string }[] | null; error: unknown }> =
  [];

function nextMembershipResult() {
  return (
    membershipQueryResults.shift() ??
    { data: [], error: null }
  );
}

const getServerSupabaseClientMock =
  vi.fn(
    () => (
      {
        auth: {
          getUser: getUserMock,
        },

        rpc: rpcMock,

        from: (
          _table: string,
        ) => (
          {
            select: () => (
              {
                eq: () => (
                  {
                    is: () => (
                      {
                        limit: () =>
                          Promise.resolve(
                            nextMembershipResult(),
                          ),
                      }
                    ),
                  }
                ),
              }
            ),
          }
        ),
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

const upsertOrganizationSmeProfileMock =
  vi.fn(
    (..._args: unknown[]) => (
      {
        status: "OK",
        profile: {
          org_id: "org-1",
          sectors: [],
          onboarding_completed_at: null,
          updated_at: "2026-09-05T00:00:00Z",
          updated_by_user_id: "user-1",
        },
      }
    ),
  );

vi.mock(
  "../../src/application/organizations/organization-sme-profile",
  () => (
    {
      upsertOrganizationSmeProfile: (...args: unknown[]) => upsertOrganizationSmeProfileMock(...args),
    }
  ),
);

const { createOrganizationAction } =
  await import(
    "./actions"
  );

afterEach(() => {
  vi.clearAllMocks();

  membershipQueryResults =
    [];
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
      "still maps a genuine duplicate-slug rejection to its own message once the limiter allows the attempt -- the caller has no membership either side of the 23505, so this is a real conflict, not a lost response",
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

        expect(redirectMock).not.toHaveBeenCalledWith(
          "/onboarding/setup",
        );
      },
    );

    describe(
      "onboarding reconciliation (SME plan v2.1.1 §3 F16) -- create_organization_with_owner performs no membership check itself, so this action's own pre-check is the actual duplicate-creation guard",
      () => {
        it(
          "refuses to create a second organization for a caller who already holds an active membership -- and never reaches the RPC",
          async () => {
            checkMock.mockReturnValueOnce(
              { allowed: true, retryAfterMs: 0 },
            );

            getUserMock.mockResolvedValueOnce(
              { data: { user: { id: "user-1" } } },
            );

            membershipQueryResults =
              [
                { data: [{ org_id: "existing-org" }], error: null },
              ];

            await expect(
              createOrganizationAction(
                { status: "idle" },
                validFormData(),
              ),
            ).rejects.toBe(
              REDIRECT_SENTINEL,
            );

            expect(redirectMock).toHaveBeenCalledWith(
              "/",
            );

            expect(rpcMock).not.toHaveBeenCalled();
          },
        );

        it(
          "creates the organization, upserts the SME profile, and redirects to \"/\" when the caller has no existing membership",
          async () => {
            checkMock.mockReturnValueOnce(
              { allowed: true, retryAfterMs: 0 },
            );

            getUserMock.mockResolvedValueOnce(
              { data: { user: { id: "user-1" } } },
            );

            membershipQueryResults =
              [
                { data: [], error: null },
              ];

            rpcMock.mockResolvedValueOnce(
              { data: { id: "org-1" }, error: null },
            );

            await expect(
              createOrganizationAction(
                { status: "idle" },
                validFormData(),
              ),
            ).rejects.toBe(
              REDIRECT_SENTINEL,
            );

            expect(redirectMock).toHaveBeenCalledWith(
              "/",
            );

            expect(upsertOrganizationSmeProfileMock).toHaveBeenCalledTimes(
              1,
            );
          },
        );

        it(
          "reconciles a lost-response 23505 into a redirect to /onboarding/setup instead of a false \"already taken\" error, when the caller now has a membership",
          async () => {
            checkMock.mockReturnValueOnce(
              { allowed: true, retryAfterMs: 0 },
            );

            getUserMock.mockResolvedValueOnce(
              { data: { user: { id: "user-1" } } },
            );

            membershipQueryResults =
              [
                { data: [], error: null },
                { data: [{ org_id: "org-1" }], error: null },
              ];

            rpcMock.mockResolvedValueOnce(
              {
                data: null,
                error: {
                  message: "duplicate key value violates unique constraint",
                  code: "23505",
                },
              },
            );

            await expect(
              createOrganizationAction(
                { status: "idle" },
                validFormData(),
              ),
            ).rejects.toBe(
              REDIRECT_SENTINEL,
            );

            expect(redirectMock).toHaveBeenCalledWith(
              "/onboarding/setup",
            );
          },
        );

        it(
          "a transient read error on the membership pre-check fails closed -- redirects to \"/\" rather than risking a second organization",
          async () => {
            checkMock.mockReturnValueOnce(
              { allowed: true, retryAfterMs: 0 },
            );

            getUserMock.mockResolvedValueOnce(
              { data: { user: { id: "user-1" } } },
            );

            membershipQueryResults =
              [
                { data: null, error: { message: "connection reset" } },
              ];

            await expect(
              createOrganizationAction(
                { status: "idle" },
                validFormData(),
              ),
            ).rejects.toBe(
              REDIRECT_SENTINEL,
            );

            expect(redirectMock).toHaveBeenCalledWith(
              "/",
            );

            expect(rpcMock).not.toHaveBeenCalled();
          },
        );
      },
    );
  },
);

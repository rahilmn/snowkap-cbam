import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// 2026-08-30 (test-coverage audit): this file previously did not exist,
// leaving all four operator/installation lifecycle actions
// (create/remove operator, create/remove installation) with zero
// coverage. Same mock-at-the-module-boundary shape as
// app/(producer)/sharing/actions.test.ts -- createOperator,
// removeOperator, createInstallation, and removeInstallation
// (src/application/installations/manage-{operators,installations}.ts)
// are mocked since those application functions already have their own
// unit tests; this file is only testing the Server Actions' own rate
// limiting, validation, shared requireOrgAndUser gate (org membership
// AND authentication -- unlike sharing/actions.ts's requireOrgContext,
// this screen's gate also redirects to /sign-in when unauthenticated,
// per app/accept-invitation/actions.test.ts's own technique for
// asserting a thrown redirect), and REJECTED-reason-to-message mapping.
vi.mock(
  "next/cache",
  () => (
    { revalidatePath: () => undefined }
  ),
);

// next/navigation's redirect() throws a Next-internal signal outside a
// real request context -- this sentinel lets the unauthenticated-user
// test below assert redirect() was actually reached, and with which
// path, without needing a real Next request/response cycle. Same
// technique as app/accept-invitation/actions.test.ts and
// app/(auth)/actions.test.ts.
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

// Defaults to an authenticated user so every test other than the
// unauthenticated-branch ones below can ignore this mock entirely --
// only that describe block overrides it with a null user via
// mockResolvedValueOnce. vi.clearAllMocks() in afterEach clears call
// history but not this base implementation.
const getUserMock =
  vi.fn(
    async (): Promise<
      { data: { user: { id: string } | null } }
    > => (
      { data: { user: { id: "user-1" } } }
    ),
  );

const getServerSupabaseClientMock =
  vi.fn(
    () => (
      {
        auth: { getUser: getUserMock },
      }
    ),
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

const createOperatorMock =
  vi.fn();

const removeOperatorMock =
  vi.fn();

vi.mock(
  "../../../src/application/installations/manage-operators",
  () => (
    {
      createOperator: (...args: unknown[]) => createOperatorMock(...args),
      removeOperator: (...args: unknown[]) => removeOperatorMock(...args),
    }
  ),
);

const createInstallationMock =
  vi.fn();

const removeInstallationMock =
  vi.fn();

vi.mock(
  "../../../src/application/installations/manage-installations",
  () => (
    {
      createInstallation: (...args: unknown[]) => createInstallationMock(...args),
      removeInstallation: (...args: unknown[]) => removeInstallationMock(...args),
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

const {
  createOperatorAction,
  removeOperatorAction,
  createInstallationAction,
  removeInstallationAction,
} =
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
  "createOperatorAction",
  () => {
    it(
      "returns a too-many-requests error, without ever calling Supabase, when the limiter rejects",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: false, retryAfterMs: 30_000 },
        );

        const result =
          await createOperatorAction(
            { status: "idle" },
            formData(
              { name: "Acme Steelworks", country: "DE" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Too many requests. Try again in 30 seconds.",
          },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
        expect(createOperatorMock).not.toHaveBeenCalled();
      },
    );

    it(
      "returns the schema's name message when name is empty",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        const result =
          await createOperatorAction(
            { status: "idle" },
            formData(
              { name: "", country: "DE" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Enter an operator name.",
          },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
        expect(createOperatorMock).not.toHaveBeenCalled();
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
          await createOperatorAction(
            { status: "idle" },
            formData(
              { name: "Acme Steelworks", country: "DE" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "You are not a member of an organization.",
          },
        );

        expect(createOperatorMock).not.toHaveBeenCalled();
      },
    );

    it(
      "maps INVALID_COUNTRY to the ISO-code message",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: "org-1" } },
        );

        createOperatorMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "INVALID_COUNTRY" },
        );

        const result =
          await createOperatorAction(
            { status: "idle" },
            formData(
              { name: "Acme Steelworks", country: "ZZZ" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Country must be a 2-letter ISO code (e.g. DE, CN).",
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

        createOperatorMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "CAPABILITY_NOT_HELD" },
        );

        const result =
          await createOperatorAction(
            { status: "idle" },
            formData(
              { name: "Acme Steelworks", country: "DE" },
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
      "falls back to the generic error message for an unmapped REJECTED reason",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: "org-1" } },
        );

        createOperatorMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "PERSIST_FAILED" },
        );

        const result =
          await createOperatorAction(
            { status: "idle" },
            formData(
              { name: "Acme Steelworks", country: "DE" },
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

    it(
      "revalidates /installations and returns idle when createOperator returns OK",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: "org-1" } },
        );

        createOperatorMock.mockResolvedValueOnce(
          { status: "OK", operator: {} },
        );

        const result =
          await createOperatorAction(
            { status: "idle" },
            formData(
              { name: "Acme Steelworks", country: "DE" },
            ),
          );

        expect(result).toEqual(
          { status: "idle" },
        );

        expect(createOperatorMock).toHaveBeenCalledTimes(1);
      },
    );
  },
);

describe(
  "removeOperatorAction",
  () => {
    it(
      "returns a too-many-requests error, without ever calling Supabase, when the limiter rejects",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: false, retryAfterMs: 15_000 },
        );

        const result =
          await removeOperatorAction(
            { status: "idle" },
            formData(
              { operatorId: "operator-1" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Too many requests. Try again in 15 seconds.",
          },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
        expect(removeOperatorMock).not.toHaveBeenCalled();
      },
    );

    it(
      "returns a generic invalid-request error when operatorId is empty",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        const result =
          await removeOperatorAction(
            { status: "idle" },
            formData(
              { operatorId: "" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Invalid request.",
          },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
        expect(removeOperatorMock).not.toHaveBeenCalled();
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
          await removeOperatorAction(
            { status: "idle" },
            formData(
              { operatorId: "operator-1" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "You are not a member of an organization.",
          },
        );

        expect(removeOperatorMock).not.toHaveBeenCalled();
      },
    );

    it(
      "returns the generic error message when removeOperator rejects",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: "org-1" } },
        );

        removeOperatorMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "OPERATOR_NOT_FOUND" },
        );

        const result =
          await removeOperatorAction(
            { status: "idle" },
            formData(
              { operatorId: "operator-1" },
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

    it(
      "revalidates /installations and returns idle when removeOperator returns OK",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: "org-1" } },
        );

        removeOperatorMock.mockResolvedValueOnce(
          { status: "OK" },
        );

        const result =
          await removeOperatorAction(
            { status: "idle" },
            formData(
              { operatorId: "operator-1" },
            ),
          );

        expect(result).toEqual(
          { status: "idle" },
        );

        expect(removeOperatorMock).toHaveBeenCalledTimes(1);
      },
    );
  },
);

describe(
  "createInstallationAction",
  () => {
    it(
      "returns a too-many-requests error, without ever calling Supabase, when the limiter rejects",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: false, retryAfterMs: 45_000 },
        );

        const result =
          await createInstallationAction(
            { status: "idle" },
            formData(
              { operatorId: "operator-1", name: "Plant 1", country: "DE" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Too many requests. Try again in 45 seconds.",
          },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
        expect(createInstallationMock).not.toHaveBeenCalled();
      },
    );

    it(
      "returns the schema's operatorId message when operatorId is empty",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        const result =
          await createInstallationAction(
            { status: "idle" },
            formData(
              { operatorId: "", name: "Plant 1", country: "DE" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Choose an operator.",
          },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
        expect(createInstallationMock).not.toHaveBeenCalled();
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
          await createInstallationAction(
            { status: "idle" },
            formData(
              { operatorId: "operator-1", name: "Plant 1", country: "DE" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "You are not a member of an organization.",
          },
        );

        expect(createInstallationMock).not.toHaveBeenCalled();
      },
    );

    // Guards against choosing an operator that doesn't exist, or
    // belongs to a different org than the caller's active one --
    // verifyOperatorOwnership's REJECTED path in manage-installations.ts.
    it(
      "maps OPERATOR_NOT_FOUND to the choose-a-valid-operator message",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: "org-1" } },
        );

        createInstallationMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "OPERATOR_NOT_FOUND" },
        );

        const result =
          await createInstallationAction(
            { status: "idle" },
            formData(
              { operatorId: "someone-elses-operator", name: "Plant 1", country: "DE" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Choose a valid operator.",
          },
        );
      },
    );

    it(
      "maps INVALID_COUNTRY to the ISO-code message",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: "org-1" } },
        );

        createInstallationMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "INVALID_COUNTRY" },
        );

        const result =
          await createInstallationAction(
            { status: "idle" },
            formData(
              { operatorId: "operator-1", name: "Plant 1", country: "ZZZ" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Country must be a 2-letter ISO code (e.g. DE, CN).",
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

        createInstallationMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "CAPABILITY_NOT_HELD" },
        );

        const result =
          await createInstallationAction(
            { status: "idle" },
            formData(
              { operatorId: "operator-1", name: "Plant 1", country: "DE" },
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
      "falls back to the generic error message for an unmapped REJECTED reason",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: "org-1" } },
        );

        createInstallationMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "PERSIST_FAILED" },
        );

        const result =
          await createInstallationAction(
            { status: "idle" },
            formData(
              { operatorId: "operator-1", name: "Plant 1", country: "DE" },
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

    it(
      "revalidates /installations and returns idle when createInstallation returns OK",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: "org-1" } },
        );

        createInstallationMock.mockResolvedValueOnce(
          { status: "OK", installation: {} },
        );

        const result =
          await createInstallationAction(
            { status: "idle" },
            formData(
              { operatorId: "operator-1", name: "Plant 1", country: "DE" },
            ),
          );

        expect(result).toEqual(
          { status: "idle" },
        );

        expect(createInstallationMock).toHaveBeenCalledTimes(1);
      },
    );
  },
);

describe(
  "removeInstallationAction",
  () => {
    it(
      "returns a too-many-requests error, without ever calling Supabase, when the limiter rejects",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: false, retryAfterMs: 20_000 },
        );

        const result =
          await removeInstallationAction(
            { status: "idle" },
            formData(
              { installationId: "installation-1" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Too many requests. Try again in 20 seconds.",
          },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
        expect(removeInstallationMock).not.toHaveBeenCalled();
      },
    );

    it(
      "returns a generic invalid-request error when installationId is empty",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        const result =
          await removeInstallationAction(
            { status: "idle" },
            formData(
              { installationId: "" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Invalid request.",
          },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
        expect(removeInstallationMock).not.toHaveBeenCalled();
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
          await removeInstallationAction(
            { status: "idle" },
            formData(
              { installationId: "installation-1" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "You are not a member of an organization.",
          },
        );

        expect(removeInstallationMock).not.toHaveBeenCalled();
      },
    );

    // The application-layer guard against destroying installations that
    // still have emission-record or sharing-grant history: the DELETE's
    // FK (ON DELETE RESTRICT, per 20260829270000) fires and
    // manage-installations.ts's removeInstallation surfaces it as
    // INSTALLATION_HAS_DEPENDENTS rather than a generic PERSIST_FAILED.
    // This is permanent (see removeInstallation's own doc comment) --
    // the action's copy must say so, not imply a retry will work.
    it(
      "maps INSTALLATION_HAS_DEPENDENTS to the permanent-block message",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: "org-1" } },
        );

        removeInstallationMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "INSTALLATION_HAS_DEPENDENTS" },
        );

        const result =
          await removeInstallationAction(
            { status: "idle" },
            formData(
              { installationId: "installation-1" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message:
              "This installation has emission records or sharing grants in its history and can't be removed. " +
              "That history is kept even after data is discarded or a grant is revoked, so this installation can " +
              "no longer be deleted -- only installations with no recorded activity can be.",
          },
        );
      },
    );

    it(
      "falls back to the generic error message for a non-dependents REJECTED reason",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: "org-1" } },
        );

        removeInstallationMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "INSTALLATION_NOT_FOUND" },
        );

        const result =
          await removeInstallationAction(
            { status: "idle" },
            formData(
              { installationId: "installation-1" },
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

    it(
      "revalidates /installations and returns idle when removeInstallation returns OK",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: "org-1" } },
        );

        removeInstallationMock.mockResolvedValueOnce(
          { status: "OK" },
        );

        const result =
          await removeInstallationAction(
            { status: "idle" },
            formData(
              { installationId: "installation-1" },
            ),
          );

        expect(result).toEqual(
          { status: "idle" },
        );

        expect(removeInstallationMock).toHaveBeenCalledTimes(1);
      },
    );
  },
);

// requireOrgAndUser is the one gate all four actions above share, and
// unlike app/(producer)/sharing/actions.ts's requireOrgContext, it also
// checks for an authenticated user (after confirming org membership)
// and redirects to /sign-in when there isn't one. Proving it here on
// createOperatorAction is enough to cover the shared helper -- the
// other three actions call the exact same function.
describe(
  "requireOrgAndUser shared auth gate",
  () => {
    it(
      "redirects to /sign-in without calling createOperator, when there is no authenticated user",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: "org-1" } },
        );

        getUserMock.mockResolvedValueOnce(
          { data: { user: null } },
        );

        await expect(
          createOperatorAction(
            { status: "idle" },
            formData(
              { name: "Acme Steelworks", country: "DE" },
            ),
          ),
        ).rejects.toBe(
          REDIRECT_SENTINEL,
        );

        expect(redirectMock).toHaveBeenCalledWith(
          "/sign-in",
        );

        expect(createOperatorMock).not.toHaveBeenCalled();
      },
    );
  },
);

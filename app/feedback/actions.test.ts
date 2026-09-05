import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Same "mock at the module boundary, dynamic-import after" shape
// app/onboarding/actions.test.ts and app/(auth)/actions.test.ts use.

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

const getUserMock =
  vi.fn();

const getServerSupabaseClientMock =
  vi.fn(
    () => (
      {
        auth: {
          getUser: getUserMock,
        },
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
    {
      getPreferredOrgId: async () => undefined,
    }
  ),
);

const submitProductFeedbackMock =
  vi.fn();

vi.mock(
  "../../src/application/guidance/submit-product-feedback",
  () => (
    {
      submitProductFeedback: (...args: unknown[]) => submitProductFeedbackMock(...args),
    }
  ),
);

const { submitFeedbackAction } =
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

function validFormData(): FormData {
  return formData(
    {
      rating: "4",
      comment: "Clear flow.",
      page: "/shipments/new",
    },
  );
}

const orgSummary =
  {
    context: { org_id: "org-1", user_id: "user-1", role: "MEMBER", capabilities: ["IMPORTER_DECLARANT"] },
    organizationName: "Acme",
    availableOrganizations: [],
  };

describe(
  "submitFeedbackAction",
  () => {
    it(
      "returns a too-many-attempts error, without ever calling Supabase, when the limiter rejects",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: false, retryAfterMs: 12_000 },
        );

        const result =
          await submitFeedbackAction(
            { status: "idle" },
            validFormData(),
          );

        expect(result.status).toBe(
          "error",
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
      },
    );

    it(
      "returns a validation error for a rating outside 1-5, without calling submitProductFeedback",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getUserMock.mockResolvedValueOnce(
          { data: { user: { id: "user-1" } } },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          orgSummary,
        );

        const result =
          await submitFeedbackAction(
            { status: "idle" },
            formData({ rating: "9", comment: "", page: "/" }),
          );

        expect(result.status).toBe(
          "error",
        );

        expect(submitProductFeedbackMock).not.toHaveBeenCalled();
      },
    );

    it(
      "calls submitProductFeedback with the org context and parsed fields, and returns success",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getUserMock.mockResolvedValueOnce(
          { data: { user: { id: "user-1" } } },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          orgSummary,
        );

        submitProductFeedbackMock.mockResolvedValueOnce(
          { status: "OK" },
        );

        const result =
          await submitFeedbackAction(
            { status: "idle" },
            validFormData(),
          );

        expect(result.status).toBe(
          "success",
        );

        expect(submitProductFeedbackMock).toHaveBeenCalledWith(
          expect.anything(),
          orgSummary.context,
          {
            rating: 4,
            comment: "Clear flow.",
            page: "/shipments/new",
            workflow: undefined,
          },
        );
      },
    );

    it(
      "returns an error when submitProductFeedback reports PERSIST_FAILED",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getUserMock.mockResolvedValueOnce(
          { data: { user: { id: "user-1" } } },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          orgSummary,
        );

        submitProductFeedbackMock.mockResolvedValueOnce(
          { status: "PERSIST_FAILED" },
        );

        const result =
          await submitFeedbackAction(
            { status: "idle" },
            validFormData(),
          );

        expect(result.status).toBe(
          "error",
        );
      },
    );
  },
);

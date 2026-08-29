import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// 2026-08-30 (test-coverage follow-up): updateOrganizationAction
// (app/organization/actions.ts) had zero test coverage. Same
// "mock at the module boundary, dynamic-import after" shape
// app/team/actions.test.ts already uses.

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

const updateOrganizationProfileMock =
  vi.fn();

vi.mock(
  "../../src/application/organizations/organization-profile",
  () => (
    {
      updateOrganizationProfile: (...args: unknown[]) => updateOrganizationProfileMock(...args),
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
  "../../components/shell/get-preferred-org-id",
  () => (
    { getPreferredOrgId: async () => "preferred-org-id" }
  ),
);

vi.mock(
  "../../components/shell/get-client-ip",
  () => (
    { getClientIp: async () => "203.0.113.1" }
  ),
);

const {
  updateOrganizationAction,
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

function ownerContext(
  overrides: Partial<{ role: string; org_id: string; capabilities: string[] }> = {},
) {
  return {
    context: {
      org_id: "org-1",
      user_id: "user-1",
      role: "OWNER",
      capabilities: [],
      ...overrides,
    },
  };
}

const validFields = {
  name: "Acme GmbH",
  cbamDeclarantStatus: "NOT_REGISTERED",
};

describe(
  "updateOrganizationAction rate limiting",
  () => {
    // The limiter is configured 20 requests / 10 minutes
    // (UPDATE_ORGANIZATION_RATE_LIMIT in app/organization/actions.ts) --
    // this test only exercises the rejection branch, not the exact
    // limit/window numbers, since those aren't independently observable
    // through the action's own behavior once the limiter is mocked.
    it(
      "returns a too-many-requests error, without ever calling Supabase, when the limiter rejects",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: false, retryAfterMs: 61_000 },
        );

        const result =
          await updateOrganizationAction(
            { status: "idle" },
            formData(validFields),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Too many requests. Try again in 61 seconds.",
          },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
        expect(getCurrentOrgSummaryMock).not.toHaveBeenCalled();
        expect(updateOrganizationProfileMock).not.toHaveBeenCalled();
      },
    );

    it(
      "singularizes the retry message when exactly one second remains",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: false, retryAfterMs: 1000 },
        );

        const result =
          await updateOrganizationAction(
            { status: "idle" },
            formData(validFields),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Too many requests. Try again in 1 second.",
          },
        );
      },
    );
  },
);

describe(
  "updateOrganizationAction OWNER-only gate",
  () => {
    it.each(
      ["ADMIN", "MEMBER"],
    )(
      "rejects a %s caller with the OWNER-only message, without calling updateOrganizationProfile",
      async (role) => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          ownerContext({ role }),
        );

        const result =
          await updateOrganizationAction(
            { status: "idle" },
            formData(validFields),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Only the organization's OWNER can change these settings.",
          },
        );

        expect(updateOrganizationProfileMock).not.toHaveBeenCalled();
      },
    );

    it(
      "returns a not-a-member error, without calling updateOrganizationProfile, when there is no org summary",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          null,
        );

        const result =
          await updateOrganizationAction(
            { status: "idle" },
            formData(validFields),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "You are not a member of an organization.",
          },
        );

        expect(updateOrganizationProfileMock).not.toHaveBeenCalled();
      },
    );
  },
);

describe(
  "updateOrganizationAction country-of-establishment validation",
  () => {
    // The check is `/^[A-Z]{2}$/.test(countryOfEstablishment)` run
    // *after* `.trim().toUpperCase()`, so a lowercase two-letter code
    // (e.g. "de") is normalized to "DE" and passes -- only a code whose
    // length isn't exactly two letters (e.g. a 3-letter ISO-3 code)
    // actually fails this regex.
    it(
      "rejects a 3-letter country code, without calling updateOrganizationProfile",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          ownerContext(),
        );

        const result =
          await updateOrganizationAction(
            { status: "idle" },
            formData(
              { ...validFields, countryOfEstablishment: "DEU" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Country of establishment must be a 2-letter ISO code (e.g. DE, NL).",
          },
        );

        expect(updateOrganizationProfileMock).not.toHaveBeenCalled();
      },
    );

    it(
      "normalizes a lowercase 2-letter country code to uppercase and forwards it",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          ownerContext(),
        );

        updateOrganizationProfileMock.mockResolvedValueOnce(
          { status: "OK" },
        );

        const result =
          await updateOrganizationAction(
            { status: "idle" },
            formData(
              { ...validFields, countryOfEstablishment: "de" },
            ),
          );

        expect(result).toEqual(
          { status: "idle" },
        );

        expect(updateOrganizationProfileMock).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          expect.objectContaining(
            { countryOfEstablishment: "DE" },
          ),
        );
      },
    );
  },
);

describe(
  "updateOrganizationAction PERSIST_FAILED",
  () => {
    it(
      "returns a generic error message when updateOrganizationProfile reports PERSIST_FAILED",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          ownerContext(),
        );

        updateOrganizationProfileMock.mockResolvedValueOnce(
          { status: "PERSIST_FAILED" },
        );

        const result =
          await updateOrganizationAction(
            { status: "idle" },
            formData(validFields),
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
      "returns the OWNER-only message when updateOrganizationProfile itself reports PERMISSION_DENIED",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          ownerContext(),
        );

        updateOrganizationProfileMock.mockResolvedValueOnce(
          { status: "PERMISSION_DENIED" },
        );

        const result =
          await updateOrganizationAction(
            { status: "idle" },
            formData(validFields),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Only the organization's OWNER can change these settings.",
          },
        );
      },
    );

    it(
      "returns idle and revalidates when updateOrganizationProfile succeeds",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          ownerContext(),
        );

        updateOrganizationProfileMock.mockResolvedValueOnce(
          { status: "OK" },
        );

        const result =
          await updateOrganizationAction(
            { status: "idle" },
            formData(validFields),
          );

        expect(result).toEqual(
          { status: "idle" },
        );
      },
    );
  },
);

describe(
  "updateOrganizationAction addCapability pass-through",
  () => {
    it(
      "forwards addCapability to updateOrganizationProfile when present in the form",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          ownerContext(),
        );

        updateOrganizationProfileMock.mockResolvedValueOnce(
          { status: "OK" },
        );

        await updateOrganizationAction(
          { status: "idle" },
          formData(
            { ...validFields, addCapability: "PRODUCER_OPERATOR" },
          ),
        );

        expect(updateOrganizationProfileMock).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          expect.objectContaining(
            { addCapability: "PRODUCER_OPERATOR" },
          ),
        );
      },
    );

    it(
      "forwards addCapability as null to updateOrganizationProfile when omitted from the form",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          ownerContext(),
        );

        updateOrganizationProfileMock.mockResolvedValueOnce(
          { status: "OK" },
        );

        await updateOrganizationAction(
          { status: "idle" },
          formData(validFields),
        );

        expect(updateOrganizationProfileMock).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          expect.objectContaining(
            { addCapability: null },
          ),
        );
      },
    );

    it(
      "rejects an addCapability value outside the enum before ever calling updateOrganizationProfile",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        const result =
          await updateOrganizationAction(
            { status: "idle" },
            formData(
              { ...validFields, addCapability: "NOT_A_REAL_CAPABILITY" },
            ),
          );

        expect(result.status).toBe(
          "error",
        );

        expect(updateOrganizationProfileMock).not.toHaveBeenCalled();
      },
    );
  },
);

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// 2026-08-30: app/(importer)/shipments/actions.ts previously had zero
// test coverage. Same "mock at the module boundary, dynamic-import
// after" shape app/(auth)/actions.test.ts and app/team/actions.test.ts
// already use -- the underlying application-layer createShipment is
// mocked here rather than exercised for real, so these tests drive only
// createShipmentAction's own control flow (rate limiting, its zod
// schema, its REJECTED-reason -> message mapping, and its two
// redirects), never a real Supabase call or a real clock/header read.

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
  vi.fn(
    (): { data: { user: { id: string } | null } } => (
      { data: { user: { id: "user-1" } } }
    ),
  );

const getServerSupabaseClientMock =
  vi.fn(
    () => (
      {
        auth: {
          getUser: () => getUserMock(),
        },
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

const createShipmentMock =
  vi.fn();

vi.mock(
  "../../../src/application/shipments/create-shipment",
  () => (
    {
      createShipment: (...args: unknown[]) => createShipmentMock(...args),
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

const { createShipmentAction } =
  await import(
    "./actions"
  );

afterEach(() => {
  vi.clearAllMocks();

  getUserMock.mockReturnValue(
    { data: { user: { id: "user-1" } } },
  );
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
  "createShipmentAction",
  () => {
    it(
      "returns a too-many-requests error, without ever calling Supabase, when the limiter rejects",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: false, retryAfterMs: 61_000 },
        );

        const result =
          await createShipmentAction(
            { status: "idle" },
            formData(
              { reference: "REF-1", releaseDate: "2026-01-01" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Too many requests. Try again in 61 seconds.",
          },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
        expect(getCurrentOrgSummaryMock).not.toHaveBeenCalled();
        expect(createShipmentMock).not.toHaveBeenCalled();
      },
    );

    it(
      "returns the zod validation message and never reaches Supabase or the service layer, for a missing reference",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        const result =
          await createShipmentAction(
            { status: "idle" },
            formData(
              { reference: "", releaseDate: "2026-01-01" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Enter a shipment reference.",
          },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
        expect(createShipmentMock).not.toHaveBeenCalled();
      },
    );

    // The zod schema (createShipmentSchema) only requires releaseDate
    // to be a non-empty string -- it never validates that the string
    // actually parses as a real calendar date. That's checked instead
    // by createShipment() itself (parseIsoDate, in the mocked
    // application layer), which reports it as REJECTED/INVALID_DATE.
    // These are two distinct, both-reachable failure paths: this test
    // sends a value that passes the zod schema (non-empty) but is
    // rejected at the service layer.
    it(
      "reaches the service layer (passing the zod schema) and surfaces INVALID_DATE from createShipment itself",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: "org-1" } },
        );

        createShipmentMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "INVALID_DATE" },
        );

        const result =
          await createShipmentAction(
            { status: "idle" },
            formData(
              { reference: "REF-1", releaseDate: "not-a-real-date" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Enter a valid release date (YYYY-MM-DD).",
          },
        );

        expect(createShipmentMock).toHaveBeenCalledTimes(1);
      },
    );

    it(
      "surfaces the DUPLICATE_REFERENCE message when createShipment rejects for that reason",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: "org-1" } },
        );

        createShipmentMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "DUPLICATE_REFERENCE" },
        );

        const result =
          await createShipmentAction(
            { status: "idle" },
            formData(
              { reference: "REF-1", releaseDate: "2026-01-01" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "A shipment with that reference already exists.",
          },
        );
      },
    );

    it(
      "surfaces the CAPABILITY_NOT_HELD message when createShipment rejects for that reason",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: "org-1" } },
        );

        createShipmentMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "CAPABILITY_NOT_HELD" },
        );

        const result =
          await createShipmentAction(
            { status: "idle" },
            formData(
              { reference: "REF-1", releaseDate: "2026-01-01" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Your organization is not set up as a CBAM importer/declarant.",
          },
        );
      },
    );

    it(
      "redirects to /sign-in without ever calling createShipment when there is no authenticated user",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: "org-1" } },
        );

        getUserMock.mockReturnValueOnce(
          { data: { user: null } },
        );

        await expect(
          createShipmentAction(
            { status: "idle" },
            formData(
              { reference: "REF-1", releaseDate: "2026-01-01" },
            ),
          ),
        ).rejects.toBe(
          REDIRECT_SENTINEL,
        );

        expect(redirectMock).toHaveBeenCalledWith(
          "/sign-in",
        );

        expect(createShipmentMock).not.toHaveBeenCalled();
      },
    );

    it(
      "calls createShipment and then redirects to /shipments/{id} on success",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: "org-1" } },
        );

        createShipmentMock.mockResolvedValueOnce(
          { status: "OK", shipment: { id: "shipment-42" } },
        );

        await expect(
          createShipmentAction(
            { status: "idle" },
            formData(
              { reference: "REF-1", releaseDate: "2026-01-01" },
            ),
          ),
        ).rejects.toBe(
          REDIRECT_SENTINEL,
        );

        expect(createShipmentMock).toHaveBeenCalledTimes(1);
        expect(redirectMock).toHaveBeenCalledWith(
          "/shipments/shipment-42",
        );
      },
    );
  },
);

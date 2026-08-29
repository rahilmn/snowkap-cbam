import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// 2026-08-30: app/(importer)/suppliers/actions.ts previously had zero
// test coverage. Same "mock at the module boundary, dynamic-import
// after" shape app/(auth)/actions.test.ts and app/team/actions.test.ts
// already use -- the underlying application-layer createSupplier /
// removeSupplier are mocked here rather than exercised for real, so
// these tests drive only the two actions' own control flow (their
// separate rate limits, their REJECTED-reason -> message mapping, and
// createSupplierAction's own country-code normalization before it ever
// calls createSupplier).

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

vi.mock(
  "next/cache",
  () => (
    { revalidatePath: () => undefined }
  ),
);

const getUserMock =
  vi.fn(
    () => (
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

const createSupplierMock =
  vi.fn();

const removeSupplierMock =
  vi.fn();

vi.mock(
  "../../../src/application/suppliers/manage-suppliers",
  () => (
    {
      createSupplier: (...args: unknown[]) => createSupplierMock(...args),
      removeSupplier: (...args: unknown[]) => removeSupplierMock(...args),
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

const { createSupplierAction, removeSupplierAction } =
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
  "createSupplierAction",
  () => {
    it(
      "returns a too-many-requests error, without ever calling Supabase, when the limiter rejects",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: false, retryAfterMs: 61_000 },
        );

        const result =
          await createSupplierAction(
            { status: "idle" },
            formData(
              { name: "Acme GmbH", country: "DE" },
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
        expect(createSupplierMock).not.toHaveBeenCalled();
      },
    );

    describe(
      "REJECTED result -> message mapping",
      () => {
        it(
          "surfaces the country-format message for INVALID_COUNTRY",
          async () => {
            checkMock.mockReturnValueOnce(
              { allowed: true, retryAfterMs: 0 },
            );

            getCurrentOrgSummaryMock.mockResolvedValueOnce(
              { context: { org_id: "org-1" } },
            );

            createSupplierMock.mockResolvedValueOnce(
              { status: "REJECTED", reason: "INVALID_COUNTRY" },
            );

            const result =
              await createSupplierAction(
                { status: "idle" },
                formData(
                  { name: "Acme GmbH", country: "Germany" },
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
          "surfaces the capability message for CAPABILITY_NOT_HELD",
          async () => {
            checkMock.mockReturnValueOnce(
              { allowed: true, retryAfterMs: 0 },
            );

            getCurrentOrgSummaryMock.mockResolvedValueOnce(
              { context: { org_id: "org-1" } },
            );

            createSupplierMock.mockResolvedValueOnce(
              { status: "REJECTED", reason: "CAPABILITY_NOT_HELD" },
            );

            const result =
              await createSupplierAction(
                { status: "idle" },
                formData(
                  { name: "Acme GmbH" },
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
          "falls back to the generic message for any other reason (e.g. PERSIST_FAILED)",
          async () => {
            checkMock.mockReturnValueOnce(
              { allowed: true, retryAfterMs: 0 },
            );

            getCurrentOrgSummaryMock.mockResolvedValueOnce(
              { context: { org_id: "org-1" } },
            );

            createSupplierMock.mockResolvedValueOnce(
              { status: "REJECTED", reason: "PERSIST_FAILED" },
            );

            const result =
              await createSupplierAction(
                { status: "idle" },
                formData(
                  { name: "Acme GmbH" },
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
      "country-code normalization (before createSupplier is ever called)",
      () => {
        it(
          "uppercases and trims a lowercase country before calling createSupplier",
          async () => {
            checkMock.mockReturnValueOnce(
              { allowed: true, retryAfterMs: 0 },
            );

            getCurrentOrgSummaryMock.mockResolvedValueOnce(
              { context: { org_id: "org-1" } },
            );

            createSupplierMock.mockResolvedValueOnce(
              { status: "OK", supplier: { id: "supplier-1" } },
            );

            const result =
              await createSupplierAction(
                { status: "idle" },
                formData(
                  { name: "Acme GmbH", country: " de " },
                ),
              );

            expect(result).toEqual(
              { status: "idle" },
            );

            expect(createSupplierMock).toHaveBeenCalledTimes(1);

            const input =
              createSupplierMock.mock.calls[0]?.[2];

            expect(input).toMatchObject(
              { country: "DE" },
            );
          },
        );

        it(
          "normalizes an empty country value to null rather than an empty string",
          async () => {
            checkMock.mockReturnValueOnce(
              { allowed: true, retryAfterMs: 0 },
            );

            getCurrentOrgSummaryMock.mockResolvedValueOnce(
              { context: { org_id: "org-1" } },
            );

            createSupplierMock.mockResolvedValueOnce(
              { status: "OK", supplier: { id: "supplier-1" } },
            );

            const result =
              await createSupplierAction(
                { status: "idle" },
                formData(
                  { name: "Acme GmbH", country: "" },
                ),
              );

            expect(result).toEqual(
              { status: "idle" },
            );

            expect(createSupplierMock).toHaveBeenCalledTimes(1);

            const input =
              createSupplierMock.mock.calls[0]?.[2];

            expect(input).toMatchObject(
              { country: null },
            );
          },
        );
      },
    );
  },
);

describe(
  "removeSupplierAction",
  () => {
    it(
      "returns a too-many-requests error, without ever calling removeSupplier, when its own (tighter) limiter rejects",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: false, retryAfterMs: 30_000 },
        );

        const result =
          await removeSupplierAction(
            { status: "idle" },
            formData(
              { supplierId: "supplier-1" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Too many requests. Try again in 30 seconds.",
          },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
        expect(removeSupplierMock).not.toHaveBeenCalled();
      },
    );

    it(
      "falls back to the generic message for any REJECTED reason (removeSupplierAction never branches on it)",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: "org-1" } },
        );

        removeSupplierMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "SUPPLIER_NOT_FOUND" },
        );

        const result =
          await removeSupplierAction(
            { status: "idle" },
            formData(
              { supplierId: "supplier-1" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Something went wrong. Please try again.",
          },
        );

        expect(removeSupplierMock).toHaveBeenCalledTimes(1);
      },
    );
  },
);

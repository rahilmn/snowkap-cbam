import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// 2026-08-30 (P13 final non-blocked-work audit, missing-rate-limit,
// confirmed via adversarial verify): this file previously had zero
// test coverage at all. This first pass covers exactly the gap that
// prompted it -- confirming each of the six newly-rate-limited
// mutation actions (addLineAction, removeLineAction,
// transitionShipmentAction, resolveEmissionsAction,
// determineFromActualDataAction, calculateLineAction) actually rejects
// before calling its underlying application function when the limiter
// says no. Broader coverage of validation/REJECTED-reason branches for
// this file is tracked separately (see the coverage-gap-scan findings
// in this same round) and is not attempted here. Same "mock at the
// module boundary, dynamic-import after" shape this codebase's other
// Server Action test files already use.

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
  "../../../../src/infrastructure/supabase/server-client",
  () => (
    {
      getServerSupabaseClient: () => getServerSupabaseClientMock(),
    }
  ),
);

const getCurrentOrgSummaryMock =
  vi.fn();

vi.mock(
  "../../../../src/application/organizations/get-current-org-context",
  () => (
    {
      getCurrentOrgSummary: (...args: unknown[]) => getCurrentOrgSummaryMock(...args),
    }
  ),
);

vi.mock(
  "../../../../components/shell/get-preferred-org-id",
  () => (
    { getPreferredOrgId: async () => "preferred-org-id" }
  ),
);

vi.mock(
  "../../../../src/infrastructure/regulatory/get-regulatory-repository",
  () => (
    {
      getRegulatoryRepository: () => ({}),
      getRegulatoryCountryMapper: () => ({}),
    }
  ),
);

const addLineMock =
  vi.fn();

const removeLineMock =
  vi.fn();

vi.mock(
  "../../../../src/application/shipments/manage-lines",
  () => (
    {
      addLine: (...args: unknown[]) => addLineMock(...args),
      removeLine: (...args: unknown[]) => removeLineMock(...args),
    }
  ),
);

const transitionShipmentStatusMock =
  vi.fn();

vi.mock(
  "../../../../src/application/shipments/transition-shipment",
  () => (
    {
      transitionShipmentStatus: (...args: unknown[]) => transitionShipmentStatusMock(...args),
    }
  ),
);

const determineLineEmissionsMock =
  vi.fn();

const redetermineLineEmissionsMock =
  vi.fn();

vi.mock(
  "../../../../src/application/emissions/resolve-line-emissions",
  () => (
    {
      determineLineEmissions: (...args: unknown[]) => determineLineEmissionsMock(...args),
      redetermineLineEmissions: (...args: unknown[]) => redetermineLineEmissionsMock(...args),
    }
  ),
);

const determineLineFromActualDataMock =
  vi.fn();

const redetermineLineFromActualDataMock =
  vi.fn();

vi.mock(
  "../../../../src/application/emissions/determine-from-actual-data",
  () => (
    {
      determineLineFromActualData: (...args: unknown[]) => determineLineFromActualDataMock(...args),
      redetermineLineFromActualData: (...args: unknown[]) => redetermineLineFromActualDataMock(...args),
    }
  ),
);

const calculateLineMock =
  vi.fn();

vi.mock(
  "../../../../src/application/calculations/calculate-line",
  () => (
    {
      calculateLine: (...args: unknown[]) => calculateLineMock(...args),
    }
  ),
);

vi.mock(
  "../../../../src/application/calculations/reproduce-calculation-result",
  () => (
    {
      reproduceCalculationResult: vi.fn(),
    }
  ),
);

const checkMock =
  vi.fn();

vi.mock(
  "../../../../src/infrastructure/rate-limit/rate-limiter",
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
  "../../../../components/shell/get-client-ip",
  () => (
    { getClientIp: async () => "203.0.113.1" }
  ),
);

const {
  addLineAction,
  removeLineAction,
  transitionShipmentAction,
  resolveEmissionsAction,
  determineFromActualDataAction,
  calculateLineAction,
} =
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
  "rate limiting (P13 final audit finding, missing-rate-limit)",
  () => {
    it(
      "addLineAction rejects without calling addLine when the limiter rejects",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: false, retryAfterMs: 30_000 },
        );

        const result =
          await addLineAction(
            { status: "idle" },
            formData(
              {
                shipmentId: "shipment-1",
                cnCode: "72081000",
                originCountry: "DE",
                quantityKind: "MASS",
                quantityValue: "10",
              },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Too many attempts. Try again in 30 seconds.",
          },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
        expect(addLineMock).not.toHaveBeenCalled();
      },
    );

    it(
      "removeLineAction rejects without calling removeLine when the limiter rejects",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: false, retryAfterMs: 30_000 },
        );

        const result =
          await removeLineAction(
            { status: "idle" },
            formData(
              { lineId: "line-1", shipmentId: "shipment-1" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Too many attempts. Try again in 30 seconds.",
          },
        );

        expect(removeLineMock).not.toHaveBeenCalled();
      },
    );

    it(
      "transitionShipmentAction rejects without calling transitionShipmentStatus when the limiter rejects",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: false, retryAfterMs: 30_000 },
        );

        const result =
          await transitionShipmentAction(
            { status: "idle" },
            formData(
              { shipmentId: "shipment-1", action: "MARK_READY" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Too many attempts. Try again in 30 seconds.",
          },
        );

        expect(transitionShipmentStatusMock).not.toHaveBeenCalled();
      },
    );

    it(
      "resolveEmissionsAction rejects without calling determineLineEmissions when the limiter rejects",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: false, retryAfterMs: 30_000 },
        );

        const result =
          await resolveEmissionsAction(
            { status: "idle" },
            formData(
              { lineId: "line-1", shipmentId: "shipment-1" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Too many attempts. Try again in 30 seconds.",
          },
        );

        expect(determineLineEmissionsMock).not.toHaveBeenCalled();
        expect(redetermineLineEmissionsMock).not.toHaveBeenCalled();
      },
    );

    it(
      "determineFromActualDataAction rejects without calling determineLineFromActualData when the limiter rejects",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: false, retryAfterMs: 30_000 },
        );

        const result =
          await determineFromActualDataAction(
            { status: "idle" },
            formData(
              {
                lineId: "line-1",
                shipmentId: "shipment-1",
                emissionDataId: "emission-data-1",
              },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Too many attempts. Try again in 30 seconds.",
          },
        );

        expect(determineLineFromActualDataMock).not.toHaveBeenCalled();
        expect(redetermineLineFromActualDataMock).not.toHaveBeenCalled();
      },
    );

    it(
      "calculateLineAction rejects without calling calculateLine when the limiter rejects",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: false, retryAfterMs: 30_000 },
        );

        const result =
          await calculateLineAction(
            { status: "idle" },
            formData(
              { lineId: "line-1", shipmentId: "shipment-1" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Too many attempts. Try again in 30 seconds.",
          },
        );

        expect(calculateLineMock).not.toHaveBeenCalled();
      },
    );

    it(
      "still performs the real mutation when the limiter allows (addLineAction, as a representative case)",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: { org_id: "org-1" } },
        );

        addLineMock.mockResolvedValueOnce(
          { status: "OK" },
        );

        const result =
          await addLineAction(
            { status: "idle" },
            formData(
              {
                shipmentId: "shipment-1",
                cnCode: "72081000",
                originCountry: "DE",
                quantityKind: "MASS",
                quantityValue: "10",
              },
            ),
          );

        expect(result).toEqual(
          { status: "idle" },
        );

        expect(addLineMock).toHaveBeenCalledTimes(1);
      },
    );
  },
);

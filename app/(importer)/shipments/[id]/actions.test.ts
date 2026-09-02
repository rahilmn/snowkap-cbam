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

// 2026-09-03 (P14): promoted from a bare stub to a real spy, so a
// no-op outcome can be asserted to revalidate NOTHING. A path that
// changed no server state must not tell Next.js that it did.
const revalidatePathMock =
  vi.fn();

vi.mock(
  "next/cache",
  () => (
    { revalidatePath: (...args: unknown[]) => revalidatePathMock(...args) }
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

// 2026-08-30 (coverage-gap follow-up): the rate-limit suite above only
// ever confirmed the limiter-rejection branch. Everything below covers
// the REAL business-logic branches of these same six actions that were
// still untested -- zod validation failures, every REJECTED-reason
// mapping function (lineMessageFor / transitionMessageFor /
// unresolvedMessageFor / determineFromActualDataRejectionMessageFor /
// calculationStatusMessageFor), the ALREADY_DETERMINED
// determine-then-redetermine retry in resolveEmissionsAction, and the
// crossOrgConsumptionRecorded=false warning path in
// determineFromActualDataAction. Same "mock at the module boundary"
// shape as above -- checkMock is given an explicit allowed:true once
// per test so each action proceeds past its rate limiter, and
// getCurrentOrgSummaryMock/getUserMock are given a resolved org context
// where the action needs one. Individual `it()` blocks generated from a
// plain array (not vitest's `it.each`) to match this file's existing
// style of one explicit assertion path per test.

function allowRateLimit(): void {
  checkMock.mockReturnValueOnce(
    { allowed: true, retryAfterMs: 0 },
  );
}

function resolveOrgSummaryOnce(): void {
  getCurrentOrgSummaryMock.mockResolvedValueOnce(
    { context: { org_id: "org-1" } },
  );
}

describe(
  "addLineAction validation and REJECTED-reason mapping",
  () => {
    it(
      "returns a validation error without calling addLine when the form fails zod validation",
      async () => {
        allowRateLimit();

        const result =
          await addLineAction(
            { status: "idle" },
            formData(
              {
                shipmentId: "shipment-1",
                // cnCode intentionally omitted -- fails addLineSchema's
                // z.string().min(1) for cnCode.
                originCountry: "DE",
                quantityKind: "MASS",
                quantityValue: "10",
              },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Check the form and try again.",
          },
        );

        expect(getCurrentOrgSummaryMock).not.toHaveBeenCalled();
        expect(addLineMock).not.toHaveBeenCalled();
      },
    );

    const ADD_LINE_REJECTION_CASES: Array<[string, string]> = [
      [
        "INVALID_CN_CODE_FORMAT",
        "Enter a valid 8-digit CN or 10-digit TARIC code.",
      ],
      [
        "UNSUPPORTED_CODE",
        "That code isn't a CBAM good.",
      ],
      [
        "AMBIGUOUS_CODE",
        "That code matches more than one CBAM good and needs to be disambiguated.",
      ],
      [
        "QUANTITY_UNIT_MISMATCH",
        "This good requires a different quantity unit than the one entered.",
      ],
      [
        "ROUTE_NOT_FOUND",
        "That production route wasn't found for this good's sector.",
      ],
      [
        "ROUTE_AMBIGUOUS",
        "That production route name matches more than one route.",
      ],
      [
        "INVALID_QUANTITY",
        "Enter a valid, positive quantity.",
      ],
      [
        "INVALID_ORIGIN_COUNTRY",
        "Enter a valid 2-letter origin country code (e.g. DE, CN).",
      ],
      [
        "SHIPMENT_NOT_FOUND",
        "That shipment could not be found.",
      ],
      [
        "SHIPMENT_NOT_EDITABLE",
        "This shipment is locked or void and can no longer be edited.",
      ],
      [
        "CAPABILITY_NOT_HELD",
        "Your organization is not set up as a CBAM importer/declarant.",
      ],
      [
        "SOME_UNRECOGNIZED_REASON",
        "Something went wrong. Please try again.",
      ],
    ];

    for (
      const [reason, expectedMessage] of ADD_LINE_REJECTION_CASES
    ) {
      it(
        `maps addLine REJECTED reason ${reason} to its lineMessageFor() message`,
        async () => {
          allowRateLimit();
          resolveOrgSummaryOnce();

          addLineMock.mockResolvedValueOnce(
            { status: "REJECTED", reason },
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
            { status: "error", message: expectedMessage },
          );
        },
      );
    }
  },
);

describe(
  "removeLineAction REJECTED-reason mapping",
  () => {
    const REMOVE_LINE_REJECTION_CASES: Array<[string, string]> = [
      [
        "SHIPMENT_NOT_EDITABLE",
        "This shipment is locked or void and can no longer be edited.",
      ],
      [
        "CAPABILITY_NOT_HELD",
        "Your organization is not set up as a CBAM importer/declarant.",
      ],
      [
        "SHIPMENT_NOT_FOUND",
        "That shipment could not be found.",
      ],
      [
        "SOME_UNRECOGNIZED_REASON",
        "Something went wrong. Please try again.",
      ],
    ];

    for (
      const [reason, expectedMessage] of REMOVE_LINE_REJECTION_CASES
    ) {
      it(
        `maps removeLine REJECTED reason ${reason} to its lineMessageFor() message`,
        async () => {
          allowRateLimit();
          resolveOrgSummaryOnce();

          removeLineMock.mockResolvedValueOnce(
            { status: "REJECTED", reason },
          );

          const result =
            await removeLineAction(
              { status: "idle" },
              formData(
                { lineId: "line-1", shipmentId: "shipment-1" },
              ),
            );

          expect(result).toEqual(
            { status: "error", message: expectedMessage },
          );
        },
      );
    }
  },
);

describe(
  "transitionShipmentAction REJECTED-reason mapping",
  () => {
    it(
      "maps PERMISSION_DENIED to the ADMIN/OWNER-only LOCK message",
      async () => {
        allowRateLimit();
        resolveOrgSummaryOnce();

        transitionShipmentStatusMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "PERMISSION_DENIED" },
        );

        const result =
          await transitionShipmentAction(
            { status: "idle" },
            formData(
              { shipmentId: "shipment-1", action: "LOCK" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Only an ADMIN or OWNER can lock a shipment.",
          },
        );
      },
    );

    it(
      "maps CONCURRENT_MODIFICATION to its reload-and-retry message",
      async () => {
        allowRateLimit();
        resolveOrgSummaryOnce();

        transitionShipmentStatusMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "CONCURRENT_MODIFICATION" },
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
            message:
              "This shipment changed while you were viewing it -- reload and try again.",
          },
        );
      },
    );
  },
);

describe(
  "resolveEmissionsAction ALREADY_DETERMINED retry and UNRESOLVED mapping",
  () => {
    it(
      "retries as redetermineLineEmissions when determineLineEmissions rejects ALREADY_DETERMINED",
      async () => {
        allowRateLimit();

        const orgContext =
          { org_id: "org-1" };

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          { context: orgContext },
        );

        determineLineEmissionsMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "ALREADY_DETERMINED" },
        );

        redetermineLineEmissionsMock.mockResolvedValueOnce(
          { status: "DETERMINED", line: {}, resolution: {} },
        );

        const result =
          await resolveEmissionsAction(
            { status: "idle" },
            formData(
              { lineId: "line-1", shipmentId: "shipment-1" },
            ),
          );

        expect(result).toEqual(
          { status: "idle" },
        );

        expect(determineLineEmissionsMock).toHaveBeenCalledTimes(1);
        expect(redetermineLineEmissionsMock).toHaveBeenCalledTimes(1);

        expect(redetermineLineEmissionsMock).toHaveBeenLastCalledWith(
          expect.anything(),
          expect.anything(),
          expect.anything(),
          orgContext,
          "line-1",
        );
      },
    );

    it(
      "does not retry as redetermine when determineLineEmissions rejects for a different reason",
      async () => {
        allowRateLimit();
        resolveOrgSummaryOnce();

        determineLineEmissionsMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "SHIPMENT_NOT_EDITABLE" },
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
            message:
              "This shipment is locked or void and can no longer be edited.",
          },
        );

        expect(redetermineLineEmissionsMock).not.toHaveBeenCalled();
      },
    );

    const UNRESOLVED_REASON_CASES: Array<[string, string]> = [
      [
        "REFERENCE_REQUIRED",
        "The regulatory dataset requires a further reference for this exact combination -- it cannot be resolved automatically.",
      ],
      [
        "UNAVAILABLE",
        "The regulatory dataset has a record for this combination, but no usable emissions value.",
      ],
      [
        "NOT_APPLICABLE",
        "The regulatory dataset marks this combination as not applicable.",
      ],
    ];

    for (
      const [reason, expectedMessage] of UNRESOLVED_REASON_CASES
    ) {
      it(
        `maps UNRESOLVED reason ${reason} to its unresolvedMessageFor() message`,
        async () => {
          allowRateLimit();
          resolveOrgSummaryOnce();

          const trace =
            [{ step: "lookup", outcome: "no_match" }];

          determineLineEmissionsMock.mockResolvedValueOnce(
            {
              status: "UNRESOLVED",
              resolution: { reason, trace },
              countryMapping: { status: "MAPPED", regulatory_country_name: "China" },
            },
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
              status: "unresolved",
              reason,
              trace,
              message: expectedMessage,
            },
          );

          expect(redetermineLineEmissionsMock).not.toHaveBeenCalled();
        },
      );
    }
  },
);

describe(
  "determineFromActualDataAction: nothing would change (P14)",
  () => {
    it(
      "reports the no-op as \"unchanged\", not as an error, and revalidates nothing",
      async () => {
        allowRateLimit();
        resolveOrgSummaryOnce();
        revalidatePathMock.mockClear();

        // The action tries determineLineFromActualData first and
        // upgrades to redetermine on ALREADY_DETERMINED, so the no-op
        // arrives from the redetermine call.
        determineLineFromActualDataMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "ALREADY_DETERMINED" },
        );

        redetermineLineFromActualDataMock.mockResolvedValueOnce(
          {
            status: "REJECTED",
            reason: "ALREADY_DETERMINED_FROM_THIS_DATASET",
          },
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
            status: "unchanged",
            message:
              "This line is already determined from that exact dataset and version -- nothing was changed.",
          },
        );

        // Nothing changed, so nothing is revalidated. Telling Next.js
        // to re-render a route whose data did not move is a lie about
        // server state, and it is what makes a no-op look like a
        // successful write in the UI.
        expect(revalidatePathMock).not.toHaveBeenCalled();
      },
    );
  },
);

describe(
  "determineFromActualDataAction REJECTED-reason mapping and cross-org warning",
  () => {
    const DETERMINE_FROM_ACTUAL_DATA_REJECTION_CASES: Array<[string, string]> = [
      [
        "LINE_NOT_FOUND",
        "That line could not be found.",
      ],
      [
        "EMISSION_DATA_NOT_FOUND",
        "That actual-emissions dataset could not be found, or is no longer visible to your organization.",
      ],
      // 2026-09-03 (P14). Both of these are, overwhelmingly, the same
      // event seen from two code paths: the producer revoked the grant
      // in the window between the read that authorized the dataset and
      // the write that freezes it -- a window the confirmation dialog
      // now sits inside. DATA_INTEGRITY_ERROR arrives when the
      // follow-up grant lookup finds nothing live; SHIPMENT_NOT_EDITABLE
      // arrives when the v10 determination validator raises 42501. From
      // the user's side both mean "reload and try again", and neither
      // means "contact support".
      [
        "DATA_INTEGRITY_ERROR",
        "That dataset is no longer shared with your organization, or the shipment is locked. Reload the line and try again.",
      ],
      [
        "SHIPMENT_NOT_EDITABLE",
        "That dataset is no longer shared with your organization, or the shipment is locked. Reload the line and try again.",
      ],
      [
        "CAPABILITY_NOT_HELD",
        "Your organization is not set up as a CBAM importer/declarant.",
      ],
      [
        "SOME_UNRECOGNIZED_REASON",
        "Something went wrong. Please try again.",
      ],
    ];

    for (
      const [reason, expectedMessage] of DETERMINE_FROM_ACTUAL_DATA_REJECTION_CASES
    ) {
      it(
        `maps determineLineFromActualData REJECTED reason ${reason} to its determineFromActualDataRejectionMessageFor() message`,
        async () => {
          allowRateLimit();
          resolveOrgSummaryOnce();

          determineLineFromActualDataMock.mockResolvedValueOnce(
            { status: "REJECTED", reason },
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
            { status: "error", message: expectedMessage },
          );

          expect(redetermineLineFromActualDataMock).not.toHaveBeenCalled();
        },
      );
    }

    it(
      "surfaces a non-fatal warning when crossOrgConsumptionRecorded is false",
      async () => {
        allowRateLimit();
        resolveOrgSummaryOnce();

        determineLineFromActualDataMock.mockResolvedValueOnce(
          {
            status: "DETERMINED",
            line: {},
            snapshot: {},
            crossOrgConsumptionRecorded: false,
          },
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
            status: "idle",
            warning:
              "This line was determined, but recording the cross-organization data-consumption event failed. The producer's own audit trail may not reflect this yet.",
          },
        );
      },
    );

    it(
      "returns a clean idle result (no warning) when crossOrgConsumptionRecorded is true",
      async () => {
        allowRateLimit();
        resolveOrgSummaryOnce();

        determineLineFromActualDataMock.mockResolvedValueOnce(
          {
            status: "DETERMINED",
            line: {},
            snapshot: {},
            crossOrgConsumptionRecorded: true,
          },
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
          { status: "idle" },
        );
      },
    );
  },
);

describe(
  "calculateLineAction non-COMPUTED calculation status mapping",
  () => {
    const CALCULATION_STATUS_CASES: Array<[string, string]> = [
      [
        "INPUT_UNRESOLVED",
        "Determine this line's emissions before calculating.",
      ],
      [
        "VALUE_UNAVAILABLE",
        "The resolved value isn't usable for calculation.",
      ],
      [
        "UNIT_UNSUPPORTED",
        "The resolved emission unit doesn't match this line's quantity -- this needs review before it can be calculated.",
      ],
      [
        "PARAMETER_DATASET_UNAVAILABLE",
        "This good may be subject to the EU CBAM's direct-emissions-only rule for iron & steel and aluminium (Annex II), and Snowkap does not yet have the reference data needed to apply that rule automatically. This is a known platform limitation, not an issue with your data -- calculation is unavailable until that reference data is added.",
      ],
      [
        "SOME_UNRECOGNIZED_STATUS",
        "This line could not be calculated.",
      ],
    ];

    for (
      const [status, expectedMessage] of CALCULATION_STATUS_CASES
    ) {
      it(
        `maps a non-COMPUTED calculation status ${status} to its calculationStatusMessageFor() message`,
        async () => {
          allowRateLimit();
          resolveOrgSummaryOnce();

          calculateLineMock.mockResolvedValueOnce(
            { status: "OK", calculation: { status } },
          );

          const result =
            await calculateLineAction(
              { status: "idle" },
              formData(
                { lineId: "line-1", shipmentId: "shipment-1" },
              ),
            );

          expect(result).toEqual(
            { status: "error", message: expectedMessage },
          );
        },
      );
    }
  },
);

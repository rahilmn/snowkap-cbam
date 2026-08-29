import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  Workbook,
  ValueType,
} from "exceljs";

// 2026-08-29 (P11 mandatory security review, N4): this file previously
// did not exist. Same mock-at-the-module-boundary shape as
// app/api/evidence/upload/route.test.ts -- these tests exercise only
// the rate-limit short-circuit now at the top of GET(), never real
// Supabase I/O or a real exceljs workbook build.
const getUserMock =
  vi.fn();

const getServerSupabaseClientMock =
  vi.fn(
    () => (
      { auth: { getUser: getUserMock } }
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

// 2026-08-30 (coverage gap closure -- see this file's own history):
// the original two tests above only ever exercised the rate-limit
// short-circuit. Everything past it -- INVALID_PERIOD, NO_ORGANIZATION,
// and the workbook itself -- was untested. Same
// getCurrentOrgSummary/getPreferredOrgId mock shape as
// app/api/evidence/upload/route.test.ts.
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

const buildPeriodExportRowsMock =
  vi.fn();

vi.mock(
  "../../../../src/application/reporting/build-period-export-rows",
  () => (
    {
      buildPeriodExportRows: (...args: unknown[]) => buildPeriodExportRowsMock(...args),
    }
  ),
);

const { GET } =
  await import(
    "./route"
  );

afterEach(() => {
  vi.clearAllMocks();
});

function exportRequest(
  query = "year=2026&quarter=1",
): Request {
  return new Request(
    `http://localhost/api/reports/export?${query}`,
  );
}

/**
 * Authenticated-and-org-scoped happy-path setup, reused by every test
 * that needs to reach past the rate-limit/auth/org gates -- mirrors
 * primeAuthenticatedOrgContext in app/api/evidence/upload/route.test.ts.
 */
function primeAuthenticatedOrgContext(): void {
  checkMock.mockReturnValueOnce(
    { allowed: true, retryAfterMs: 0 },
  );

  getUserMock.mockResolvedValueOnce(
    { data: { user: { id: "user-1" } } },
  );

  getCurrentOrgSummaryMock.mockResolvedValueOnce(
    { context: { org_id: "org-1" } },
  );
}

/**
 * One PeriodExportRow (build-period-export-rows.ts's own shape),
 * minimal-but-complete, so the precision tests below only ever vary
 * the two regulated-numeric fields they're actually about.
 */
function periodExportRow(
  overrides: Record<string, unknown> = {},
) {
  return {
    shipment_reference: "REF-001",
    line_number: 1,
    cn_code: "72081000",
    cn_code_level: "CN8",
    origin_country: "DE",
    production_route: null,
    quantity: "10",
    quantity_unit: "TONNES",
    determination_method: "ACTUAL",
    dataset_version: null,
    methodology: "EU_METHOD",
    resolution_reason: null,
    engine_version: "1.1.0",
    embedded_emissions_tco2e: "20",
    calculated_at: "2026-02-01T00:00:00Z",
    ...overrides,
  };
}

/**
 * Loads a real .xlsx buffer (the same exceljs the route itself uses,
 * per this task's own instruction to parse the actual returned
 * workbook rather than trust the route's own claims about it) and
 * returns a header-name -> column-number map plus the sheet, so tests
 * find columns by their actual header text rather than a hardcoded,
 * order-dependent letter.
 */
async function loadPeriodReportSheet(
  response: Response,
) {
  const buffer =
    Buffer.from(
      await response.arrayBuffer(),
    );

  const workbook =
    new Workbook();

  // `as never`: exceljs's own bundled devDependency chain (fast-csv,
  // one of exceljs's own dependencies) carries a nested, older
  // @types/node whose non-generic `Buffer` interface is what
  // `.load()`'s declared parameter type resolves to -- distinct from
  // (and incompatible with) this repo's own root @types/node's newer
  // generic `Buffer<TArrayBuffer>`, which is what `Buffer.from(...)`
  // below actually produces. A real Buffer either way; this is a
  // type-level-only mismatch between two coexisting @types/node
  // versions, not a runtime concern -- same "cast at a known type
  // boundary" idiom this codebase already uses (`as never`) for a
  // branded-type mismatch in build-period-export-rows.test.ts.
  await workbook.xlsx.load(
    buffer as never,
  );

  const sheet =
    workbook.getWorksheet(
      "Period report",
    );

  if (!sheet) {
    throw new Error(
      "expected a 'Period report' worksheet in the returned workbook",
    );
  }

  const columnIndexByHeader =
    new Map<string, number>();

  sheet.getRow(1).eachCell(
    (cell, colNumber) => {
      columnIndexByHeader.set(
        String(cell.value),
        colNumber,
      );
    },
  );

  return { sheet, columnIndexByHeader };
}

describe(
  "GET /api/reports/export",
  () => {
    it(
      "returns 429 without ever calling Supabase when the limiter rejects",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: false, retryAfterMs: 61_000 },
        );

        const response =
          await GET(
            exportRequest(),
          );

        expect(response.status).toBe(429);

        const body =
          await (response as Response).json();

        expect(body).toEqual(
          { success: false, reason: "RATE_LIMITED" },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
      },
    );

    it(
      "proceeds to Supabase when the limiter allows the attempt",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getUserMock.mockResolvedValueOnce(
          { data: { user: null } },
        );

        const response =
          await GET(
            exportRequest(),
          );

        expect(response.status).toBe(401);
        expect(getUserMock).toHaveBeenCalledTimes(1);
      },
    );

    it(
      "returns 400 INVALID_PERIOD when the year param is missing entirely, without ever calling Supabase",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        const response =
          await GET(
            exportRequest("quarter=1"),
          );

        expect(response.status).toBe(400);

        const body =
          await (response as Response).json();

        expect(body).toEqual(
          { success: false, reason: "INVALID_PERIOD" },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
      },
    );

    it(
      "returns 400 INVALID_PERIOD for a malformed (non-4-digit) year",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        const response =
          await GET(
            exportRequest("year=20AB&quarter=1"),
          );

        expect(response.status).toBe(400);

        const body =
          await (response as Response).json();

        expect(body).toEqual(
          { success: false, reason: "INVALID_PERIOD" },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
      },
    );

    it(
      "returns 400 INVALID_PERIOD for an out-of-range quarter, rather than silently falling back to ANNUAL",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        const response =
          await GET(
            exportRequest("year=2026&quarter=5"),
          );

        expect(response.status).toBe(400);

        const body =
          await (response as Response).json();

        expect(body).toEqual(
          { success: false, reason: "INVALID_PERIOD" },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
      },
    );

    it(
      "returns 403 NO_ORGANIZATION when the signed-in user belongs to no organization, without ever building export rows",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getUserMock.mockResolvedValueOnce(
          { data: { user: { id: "user-1" } } },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          null,
        );

        const response =
          await GET(
            exportRequest(),
          );

        expect(response.status).toBe(403);

        const body =
          await (response as Response).json();

        expect(body).toEqual(
          { success: false, reason: "NO_ORGANIZATION" },
        );

        expect(buildPeriodExportRowsMock).not.toHaveBeenCalled();
      },
    );

    describe(
      "workbook precision (regression: quantity/embedded_emissions_tco2e must never be narrowed through Number())",
      () => {
        it(
          // 2026-08-30: reproduces exactly the historical bug this
          // route's own header comment documents --
          // `Number("100.000000000000000000001") === 100` and
          // `Number("3.75000000000000000000001") === 3.75` --
          // against the REAL exceljs workbook this route writes and
          // the REAL buffer it returns, not a mock of either. If a
          // future refactor ever reintroduces a plain Number(...)
          // coercion on the exact-value cells (instead of writing the
          // DecimalString as text with numFmt '@'), this test fails.
          "writes quantity/embedded_emissions_tco2e as exact TEXT cells (numFmt '@'), byte-for-byte the original DecimalString, distinct from their own '(approx, for charting)' NUMERIC columns",
          async () => {
            primeAuthenticatedOrgContext();

            const exactQuantity =
              "100.000000000000000000001";

            const exactEmissions =
              "3.75000000000000000000001";

            // Sanity check on the fixture itself: these values are
            // only meaningful as a regression test if plain Number()
            // actually mangles them the way the route's own comment
            // says it historically did.
            expect(Number(exactQuantity)).toBe(100);
            expect(Number(exactEmissions)).toBe(3.75);

            buildPeriodExportRowsMock.mockResolvedValueOnce(
              [
                periodExportRow(
                  {
                    quantity: exactQuantity,
                    embedded_emissions_tco2e: exactEmissions,
                  },
                ),
              ],
            );

            const response =
              await GET(
                exportRequest(),
              ) as Response;

            expect(response.status).toBe(200);
            expect(response.headers.get("Content-Type")).toBe(
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            );

            const {
              sheet,
              columnIndexByHeader,
            } = await loadPeriodReportSheet(
              response,
            );

            const dataRow =
              sheet.getRow(2);

            const quantityCell =
              dataRow.getCell(
                columnIndexByHeader.get("Quantity (exact)")!,
              );

            const quantityApproxCell =
              dataRow.getCell(
                columnIndexByHeader.get("Quantity (approx, for charting)")!,
              );

            const emissionsCell =
              dataRow.getCell(
                columnIndexByHeader.get("Embedded emissions (tCO2e, exact)")!,
              );

            const emissionsApproxCell =
              dataRow.getCell(
                columnIndexByHeader.get("Embedded emissions (tCO2e, approx, for charting)")!,
              );

            // The exact columns: TEXT cells, pinned numFmt '@', the
            // DecimalString preserved byte-for-byte -- never rounded,
            // truncated, or narrowed through a JS/Excel double.
            expect(quantityCell.type).toBe(ValueType.String);
            expect(quantityCell.numFmt).toBe("@");
            expect(quantityCell.value).toBe(exactQuantity);

            expect(emissionsCell.type).toBe(ValueType.String);
            expect(emissionsCell.numFmt).toBe("@");
            expect(emissionsCell.value).toBe(exactEmissions);

            // The approx columns: genuine numeric cells, deliberately
            // lossy for charting/SUM -- differing from the exact
            // string is expected and fine for THESE columns
            // specifically, which is exactly why they're a separate,
            // clearly-labelled pair of columns.
            expect(quantityApproxCell.type).toBe(ValueType.Number);
            expect(typeof quantityApproxCell.value).toBe("number");
            expect(quantityApproxCell.value).toBe(Number(exactQuantity));

            expect(emissionsApproxCell.type).toBe(ValueType.Number);
            expect(typeof emissionsApproxCell.value).toBe("number");
            expect(emissionsApproxCell.value).toBe(Number(exactEmissions));

            // And the two pairs genuinely differ in what they carry --
            // proof this isn't accidentally testing the same value
            // twice under two different assertions.
            expect(String(quantityApproxCell.value)).not.toBe(exactQuantity);
            expect(String(emissionsApproxCell.value)).not.toBe(exactEmissions);
          },
        );

        it(
          "writes a null embedded_emissions_tco2e (an uncalculated line) as a null approx cell, never coerced to 0",
          async () => {
            primeAuthenticatedOrgContext();

            buildPeriodExportRowsMock.mockResolvedValueOnce(
              [
                periodExportRow(
                  {
                    determination_method: "NOT_DETERMINED",
                    methodology: null,
                    engine_version: null,
                    embedded_emissions_tco2e: null,
                    calculated_at: null,
                  },
                ),
              ],
            );

            const response =
              await GET(
                exportRequest(),
              ) as Response;

            expect(response.status).toBe(200);

            const {
              sheet,
              columnIndexByHeader,
            } = await loadPeriodReportSheet(
              response,
            );

            const dataRow =
              sheet.getRow(2);

            const emissionsApproxCell =
              dataRow.getCell(
                columnIndexByHeader.get("Embedded emissions (tCO2e, approx, for charting)")!,
              );

            expect(emissionsApproxCell.value).toBeNull();
            expect(emissionsApproxCell.value).not.toBe(0);
          },
        );
      },
    );
  },
);

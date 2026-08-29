import "server-only";

import {
  NextResponse,
} from "next/server";

import {
  Workbook,
} from "exceljs";

import {
  getServerSupabaseClient,
} from "../../../../src/infrastructure/supabase/server-client";

import {
  getCurrentOrgSummary,
} from "../../../../src/application/organizations/get-current-org-context";

import {
  getPreferredOrgId,
} from "../../../../components/shell/get-preferred-org-id";

import {
  buildPeriodExportRows,
} from "../../../../src/application/reporting/build-period-export-rows";

import {
  parsePeriodParams,
} from "../../../../src/application/reporting/parse-period-params";

import {
  formatReportingPeriod,
} from "../../../../src/domain/shared/reporting-period";

import {
  createInMemoryRateLimiter,
} from "../../../../src/infrastructure/rate-limit/rate-limiter";

import {
  getClientIp,
} from "../../../../components/shell/get-client-ip";

export const dynamic =
  "force-dynamic";

interface ExportErrorBody {
  success: false;
  reason: string;
}

const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * 2026-08-29 (P11 mandatory security review, N4, SHOULD-FIX): master
 * plan §28's rate-limiting scope names "mutation, import, and sharing
 * endpoints" but the mandatory reviewer flagged this GET as the
 * heaviest unbounded path in the app regardless -- a full-period
 * aggregation (buildPeriodExportRows) plus building an in-memory
 * exceljs workbook, per request, with no cap. 10 requests per 5
 * minutes per IP is generous for genuine repeated use (re-exporting
 * after fixing a line, checking a few periods in a row) while bounding
 * a script hammering this route. Checked before ANY of the work below
 * -- same "reject before I/O" ordering as every other limiter in this
 * codebase.
 */
const REPORT_EXPORT_RATE_LIMIT =
  {
    limit: 10,
    windowMs: 5 * 60 * 1000,
  };

const reportExportLimiter =
  createInMemoryRateLimiter(
    REPORT_EXPORT_RATE_LIMIT,
  );

/**
 * GET -- the XLSX counterpart to ExportPeriodCsvButton
 * (components/reporting/export-period-csv-button.tsx), which stays
 * client-side/in-memory the way ExportAuditCsvButton does; an XLSX
 * workbook needs a real writer (exceljs), which has no meaningful
 * browser-only build worth shipping to the client for a one-off
 * download, so this is a genuine app/api/** stream-download route --
 * the sanctioned exception CLAUDE.md's layering rules carve out
 * (see app/api/evidence/[id]/download/route.ts for the other precedent
 * of that exception in this codebase).
 *
 * Same `?year=&quarter=` contract as app/(importer)/reports/page.tsx,
 * parsed through the identical parsePeriodParams (parse-period-params.ts)
 * so the two can never silently disagree on what a given URL means --
 * an invalid/missing period is rejected with 400, not guessed at.
 *
 * orgId is derived from the authenticated session
 * (getCurrentOrgSummary(supabase, getPreferredOrgId())) exactly the way
 * every Server Component page in this codebase already does, and the
 * way the evidence download route derives it -- never trusted from a
 * query param, which would let one org's member request another org's
 * report by guessing/editing the URL.
 */
export async function GET(
  request: Request,
): Promise<NextResponse<ExportErrorBody> | Response> {
  const rateLimitResult =
    reportExportLimiter.check(
      await getClientIp(),
      Date.now(),
    );

  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      { success: false, reason: "RATE_LIMITED" },
      { status: 429 },
    );
  }

  const url =
    new URL(
      request.url,
    );

  const period =
    parsePeriodParams(
      {
        year: url.searchParams.get("year") ?? undefined,
        quarter: url.searchParams.get("quarter") ?? undefined,
      },
    );

  if (!period) {
    return NextResponse.json(
      { success: false, reason: "INVALID_PERIOD" },
      { status: 400 },
    );
  }

  const supabase =
    await getServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { success: false, reason: "UNAUTHENTICATED" },
      { status: 401 },
    );
  }

  const orgSummary =
    await getCurrentOrgSummary(
      supabase,
      await getPreferredOrgId(),
    );

  if (!orgSummary) {
    return NextResponse.json(
      { success: false, reason: "NO_ORGANIZATION" },
      { status: 403 },
    );
  }

  const rows =
    await buildPeriodExportRows(
      supabase,
      orgSummary.context.org_id,
      period,
    );

  const workbook =
    new Workbook();

  const sheet =
    workbook.addWorksheet(
      "Period report",
    );

  // REGULATORY HONESTY, corrected: an earlier version of this route
  // widened `row.quantity` / `row.embedded_emissions_tco2e`
  // (DecimalString) through a plain `Number(...)` to get an OOXML
  // numeric cell type. That coercion IS a rounding method -- round-to-
  // nearest-representable-IEEE-754-double, applied silently, with no
  // callout anywhere the person holding the .xlsx would ever see one
  // (the only disclosure was a source comment). Verified:
  // `Number("3.75000000000000000000001") === 3.75` and
  // `Number("100.000000000000000000001") === 100`. This is not the
  // RULE-EE-006 declaration-rounding-METHOD gap (docs/regulatory/
  // CALCULATION_RULE_REGISTER.md) -- that concerns a declaration-ready
  // total, which this period-reporting screen (master plan §27 screen
  // 21) never produces -- but it is the exact same "never invent, never
  // substitute" posture this codebase applies to every regulated figure
  // (CLAUDE.md, protected-zone section), applied here to a plain report
  // export: a regulated DecimalString must never be silently narrowed.
  //
  // Fixed the same way buildPeriodExportCsv (period-export-csv.ts)
  // already does it: `quantity`/`embedded_emissions_tco2e` are written
  // as TEXT cells (the DecimalString value itself, pinned with
  // `cell.numFmt = '@'` below), carrying the EXACT DecimalString
  // byte-for-byte -- there is no arbitrary-precision numeric cell type
  // in the OOXML spreadsheet format, so text is the only representation
  // that cannot lose a digit. Two extra columns
  // ("(approx, for charting)") carry the SAME figures as genuine numeric
  // cells, clearly labelled as approximate, so a reader who wants to
  // sum/chart in Excel still can -- without the exact columns ever being
  // mistaken for full precision. A Notes sheet (added below) states this
  // in the file itself, not only in this comment.
  sheet.columns =
    [
      { header: "Shipment reference", key: "shipment_reference", width: 18 },
      { header: "Line", key: "line_number", width: 8 },
      { header: "CN/TARIC code", key: "cn_code", width: 16 },
      { header: "Code level", key: "cn_code_level", width: 12 },
      { header: "Origin country", key: "origin_country", width: 14 },
      { header: "Production route", key: "production_route", width: 24 },
      { header: "Quantity (exact)", key: "quantity", width: 16 },
      { header: "Quantity unit", key: "quantity_unit", width: 12 },
      { header: "Quantity (approx, for charting)", key: "quantity_approx", width: 22 },
      { header: "Determination method", key: "determination_method", width: 18 },
      { header: "Dataset version", key: "dataset_version", width: 16 },
      { header: "Methodology", key: "methodology", width: 16 },
      { header: "Resolution reason", key: "resolution_reason", width: 24 },
      { header: "Engine version", key: "engine_version", width: 14 },
      { header: "Embedded emissions (tCO2e, exact)", key: "embedded_emissions_tco2e", width: 28 },
      { header: "Embedded emissions (tCO2e, approx, for charting)", key: "embedded_emissions_approx", width: 32 },
      { header: "Calculated at", key: "calculated_at", width: 22 },
    ];

  sheet.getRow(1).font =
    { bold: true };

  for (const row of rows) {
    const addedRow =
      sheet.addRow(
        {
          shipment_reference: row.shipment_reference,
          line_number: row.line_number,
          cn_code: row.cn_code,
          cn_code_level: row.cn_code_level,
          origin_country: row.origin_country,
          production_route: row.production_route,
          // The exact figure, as text -- see this route's own header
          // comment above. Never the cell a chart/SUM should read.
          quantity: row.quantity,
          quantity_unit: row.quantity_unit,
          // A genuine numeric cell, deliberately approximate, for
          // charting/SUM in Excel -- its own column header says so.
          quantity_approx: Number(row.quantity),
          determination_method: row.determination_method,
          dataset_version: row.dataset_version,
          methodology: row.methodology,
          resolution_reason: row.resolution_reason,
          engine_version: row.engine_version,
          embedded_emissions_tco2e: row.embedded_emissions_tco2e,
          embedded_emissions_approx:
            row.embedded_emissions_tco2e !== null
              ? Number(row.embedded_emissions_tco2e)
              : null,
          calculated_at: row.calculated_at,
        },
      );

    // numFmt '@' pins these two cells to Excel's own "Text" format --
    // without it, exceljs still writes a string-typed cell (safe from
    // silent double-precision loss on its own), but Excel's UI can
    // still offer to "convert" a General-formatted, number-looking text
    // cell on open; '@' removes that ambiguity for the one column in
    // this file regulatory honesty depends on.
    addedRow.getCell("quantity").numFmt =
      "@";

    addedRow.getCell("embedded_emissions_tco2e").numFmt =
      "@";
  }

  const notes =
    workbook.addWorksheet(
      "Notes",
    );

  notes.columns =
    [{ header: "", key: "note", width: 110 }];

  notes.addRows(
    [
      { note: "Quantity (exact) and Embedded emissions (tCO2e, exact) are text cells carrying the full-precision figure exactly as calculated -- never rounded, truncated, or narrowed through a JavaScript/Excel double." },
      { note: "The OOXML spreadsheet format (.xlsx) has no arbitrary-precision numeric cell type, so a genuine numeric cell can only ever hold an IEEE-754 double. The \"(approx, for charting)\" columns are ordinary numeric cells provided so figures can still be summed or charted in Excel -- they are not the authoritative figure." },
      { note: "This period report is Snowkap's own preparation summary, for the declarant's own use -- not a reproduction of the official CBAM registry submission form, and not a declaration-ready rounded total. The authorised declarant files through the official channel themselves (docs/plans/MASTER_PLAN.md §22)." },
      { note: "The CSV export of this same period (period-export-csv.ts) carries every figure as plain full-precision text and has no numeric-cell precision ceiling at all -- it is this report's other full-precision export." },
    ],
  );

  const buffer =
    await workbook.xlsx.writeBuffer();

  const filename =
    `period-report-${formatReportingPeriod(period)}.xlsx`;

  return new Response(
    buffer,
    {
      status: 200,
      headers: {
        "Content-Type": XLSX_CONTENT_TYPE,
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    },
  );
}

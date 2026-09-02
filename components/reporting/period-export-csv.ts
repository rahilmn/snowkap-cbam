import type {
  PeriodExportRow,
} from "../../src/application/reporting/build-period-export-rows";

const CSV_HEADER = [
  "Shipment reference",
  "Line",
  "CN/TARIC code",
  "Code level",
  "Origin country",
  "Production route",
  "Quantity",
  "Quantity unit",
  "Determination method",
  "Dataset version",
  "Methodology",
  "Resolution reason",
  "Engine version",
  "Embedded emissions (tCO2e)",
  "Calculated at",
  // 2026-09-03 (P14): appended, never interleaved, so the existing
  // byte-stable prefix of every previously-exported file stays stable.
  // See PeriodExportRow for what each one means -- in particular that
  // "Country mapping status" is a verbatim copy of a frozen enum and
  // NOT a scope indicator, and that the installation name is a live
  // lookup that can change between exports.
  "Country mapping status",
  "Emission data id",
  "Emission data version",
  "Installation name (current if visible)",
  "Sharing grant id",
  "Calculation currency",
];

// Same CSV-formula-injection guard as components/audit/audit-event-csv.ts's
// own escapeCsvField (not imported from there -- that function isn't
// exported, and this task's own instructions were to "reuse or closely
// mirror" it, so this is a byte-for-byte mirror of its regex and
// reasoning, not a second, independently-drifting implementation).
// Guarded for every field, not just the free-text ones
// (production_route, resolution_reason) -- P8's own security review
// (finding #6, cited in audit-event-csv.ts) is exactly why this codebase
// doesn't special-case which columns are "safe": a future column that
// carries genuine user-entered text is covered automatically rather
// than by remembering to add it.
const FORMULA_PREFIX_CHARS =
  /^[=+\-@]/;

// RFC 4180: a field is quoted only when it contains the delimiter, a
// quote, or a line break; an embedded quote is escaped by doubling it.
function escapeCsvField(
  value: string,
): string {
  const guarded =
    FORMULA_PREFIX_CHARS.test(value)
      ? `'${value}`
      : value;

  if (/[",\r\n]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }

  return guarded;
}

// `null` (a field this codebase deliberately never fabricates a
// placeholder for -- see PeriodExportRow's own doc comment) renders as
// an empty CSV cell, the natural "nothing here" representation for a
// spreadsheet -- not the string "null", which would read as if the
// field genuinely held that word.
function cell(
  value: string | number | null,
): string {
  return value === null
    ? ""
    : String(value);
}

/**
 * Builds the full CSV text for ExportPeriodCsvButton
 * (export-period-csv-button.tsx) to hand off as a Blob -- kept separate
 * from that component so the string-building itself is testable under
 * plain vitest, without a DOM, mirroring
 * components/audit/audit-event-csv.ts's own buildAuditEventsCsv /
 * ExportAuditCsvButton split exactly. `\r\n` line endings for the same
 * reason documented there: Excel treats a bare `\n` inside a quoted
 * field as a soft line break within the cell, not a row separator.
 *
 * Every column of PeriodExportRow is exported, full Decimal-string
 * precision (`row.quantity`, `row.embedded_emissions_tco2e`) -- never
 * coerced through a JS `number`, unlike the XLSX export's numeric cells
 * (see app/api/reports/export/route.ts's own doc comment on why that
 * coercion is a property of the XLSX file format itself, not something
 * this CSV export needs to accept).
 */
export function buildPeriodExportCsv(
  rows: PeriodExportRow[],
): string {
  const lines: string[][] =
    [
      CSV_HEADER,
      ...rows.map(
        (row) => (
          [
            row.shipment_reference,
            cell(row.line_number),
            row.cn_code,
            row.cn_code_level,
            row.origin_country,
            cell(row.production_route),
            row.quantity,
            row.quantity_unit,
            row.determination_method,
            cell(row.dataset_version),
            cell(row.methodology),
            cell(row.resolution_reason),
            cell(row.engine_version),
            cell(row.embedded_emissions_tco2e),
            cell(row.calculated_at),
            cell(row.country_mapping_status),
            cell(row.emission_data_id),
            cell(row.emission_data_version),
            cell(row.installation_name),
            cell(row.sharing_grant_id),
            row.calculation_currency,
          ]
        ),
      ),
    ];

  return lines
    .map(
      (fields) =>
        fields
          .map(
            escapeCsvField,
          )
          .join(
            ",",
          ),
    )
    .join(
      "\r\n",
    );
}

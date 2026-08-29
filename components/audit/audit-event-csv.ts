import type {
  AuditEventRowView,
} from "./audit-event-view";

const CSV_HEADER = [
  "Occurred at",
  "Event type",
  "Aggregate type",
  "Aggregate ID",
  "Actor",
  "Payload",
];

// CSV formula injection: Excel and most spreadsheet apps treat a cell
// whose *first* character is one of =+-@ as a formula to evaluate on
// open, rather than as text -- a well-known attack class this export
// should not become an example of. Of this row's six columns, five are
// system-generated (an ISO timestamp, a catalog event_type, an enum
// aggregate_type, a UUID, and JSON.stringify(payload), which always
// starts with `{`) and so can never trigger this, but actorLabel is a
// teammate's own auth email -- entered at signup, not by this export --
// so a local part starting with one of these characters is a real,
// if narrow, way for one org member to plant a formula another member
// later opens in their own spreadsheet app. Guarded here for every
// field rather than special-cased to actorLabel, so a future column
// that carries genuine user-entered text (a reference, a filename) is
// covered automatically rather than by remembering to add it (P8
// security review, finding #6). Prefixing a single quote is the
// standard OWASP CSV-injection mitigation -- Excel/Sheets read it as
// "force this cell to text" and do not display it.
const FORMULA_PREFIX_CHARS =
  /^[=+\-@]/;

// RFC 4180: a field is quoted only when it contains the delimiter, a
// quote, or a line break; an embedded quote is escaped by doubling it.
// Fields here are never quoted unnecessarily -- e.g. an event_type
// like "shipment.created" stays bare -- so a plain CSV viewer shows
// exactly the value, not a distracting wrapper.
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

/**
 * Builds the full CSV text for ExportAuditCsvButton
 * (export-audit-csv-button.tsx) to hand off as a Blob -- kept separate
 * from that component so the string-building itself (the part with
 * actual logic worth getting right: escaping, field order, the full
 * JSON payload rather than the table's truncated summary) is testable
 * under plain vitest, without a DOM. `\r\n` line endings rather than
 * `\n` -- Excel (still the overwhelmingly likely opener for a CSV
 * export in a compliance tool) treats a bare `\n` inside a quoted
 * field as a soft line break within the cell but expects `\r\n` as the
 * row separator; using it consistently avoids depending on which rows
 * happen to need quoting.
 *
 * Exports the full `payload` (JSON-stringified), not each row's
 * `payloadSummary` -- the summary exists to keep the on-screen table
 * scannable (see summarizePayload's own doc comment in
 * audit-event-view.ts), and truncates by design; an export a compliance
 * user might actually rely on must never lose data the screen simply
 * chose not to print.
 */
export function buildAuditEventsCsv(
  rows: AuditEventRowView[],
): string {
  const lines: string[][] =
    [
      CSV_HEADER,
      ...rows.map(
        (row) => (
          [
            row.occurredAt,
            row.eventType,
            row.aggregateType,
            row.aggregateId,
            row.actorLabel,
            JSON.stringify(
              row.payload,
            ),
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

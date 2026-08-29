import {
  Badge,
} from "../../../../components/ui/badge";

import {
  Card,
} from "../../../../components/ui/card";

import {
  formatTimestamp,
} from "../../../../lib/utils";

interface FiledSnapshotTotals {
  shipment_count: number;
  line_count: number;
  embedded_emissions_tco2e: string;
}

interface FiledSnapshotShipmentRow {
  shipment_id: string;
  reference: string;
  status_at_filing: string;
  line_count: number;
  embedded_emissions_tco2e: string;
}

interface FiledSnapshotRounding {
  declaration_rounding_method: string;
  rule_ref: string;
  note: string;
}

interface FiledSnapshotScope {
  is_official_form: boolean;
  note: string;
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asTotals(
  value: unknown,
): FiledSnapshotTotals | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.shipment_count !== "number" ||
    typeof value.line_count !== "number" ||
    typeof value.embedded_emissions_tco2e !== "string"
  ) {
    return null;
  }

  return value as unknown as FiledSnapshotTotals;
}

function asShipmentRows(
  value: unknown,
): FiledSnapshotShipmentRow[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (entry): entry is FiledSnapshotShipmentRow =>
      isRecord(entry) &&
      typeof entry.shipment_id === "string" &&
      typeof entry.reference === "string",
  );
}

function asRounding(
  value: unknown,
): FiledSnapshotRounding | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.declaration_rounding_method !== "string" ||
    typeof value.rule_ref !== "string" ||
    typeof value.note !== "string"
  ) {
    return null;
  }

  return value as unknown as FiledSnapshotRounding;
}

function asScope(
  value: unknown,
): FiledSnapshotScope | null {
  if (!isRecord(value)) {
    return null;
  }

  if (typeof value.is_official_form !== "boolean" || typeof value.note !== "string") {
    return null;
  }

  return value as unknown as FiledSnapshotScope;
}

/**
 * Renders public.record_declaration_filed()'s own filed_snapshot
 * (20260829330000, section 4) -- read entirely defensively (every field
 * accessed through the `as*` guards above) rather than trusting a typed
 * shape, per Declaration.filed_snapshot's own doc comment
 * (src/domain/declarations/types.ts): this payload is authored in SQL,
 * not TypeScript, and this component is the one actual reader of it.
 *
 * REGULATORY HONESTY, concretely: the total below is the RPC's
 * full-Decimal-precision `totals.embedded_emissions_tco2e` figure,
 * rendered EXACTLY as stored -- never rounded, truncated, or
 * reformatted by this component. Immediately beside it (not behind a
 * tooltip, not a footnote) sits a visible, always-open callout naming
 * RULE-EE-006 as an escalated, unresolved regulatory gap: the EU's
 * published CBAM text states a declaration-time precision CEILING
 * (whole tonnes for a period total; 5 decimal digits for specific
 * embedded emissions) but nowhere states a rounding METHOD, across all
 * three source regulations read in full
 * (docs/regulatory/CALCULATION_RULE_REGISTER.md, RULE-EE-006). The
 * `note` text rendered below is the RPC's own in-band explanation,
 * not a paraphrase authored here -- so an archived snapshot and this
 * screen can never drift apart on what the gap actually says.
 */
export function FiledSnapshotCard(
  {
    filedSnapshot,
    filedReference,
    filedAt,
  }: {
    filedSnapshot: Record<string, unknown> | null;
    filedReference: string | null;
    filedAt: string | null;
  },
) {
  if (!filedSnapshot) {
    return null;
  }

  const totals =
    asTotals(
      filedSnapshot.totals,
    );

  const shipmentRows =
    asShipmentRows(
      filedSnapshot.shipments,
    );

  const rounding =
    asRounding(
      filedSnapshot.rounding,
    );

  const scope =
    asScope(
      filedSnapshot.scope,
    );

  return (
    <Card>
      <div className="border-b border-[var(--border-default)] p-4">
        <h2 className="text-sm font-medium text-[var(--text-primary)]">
          Filed snapshot
        </h2>

        <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">
          Frozen at filing time, from a fresh aggregation of the member
          shipments&apos; calculation results -- never DRAFT-time cached
          numbers.{" "}
          {filedAt ? `Filed ${formatTimestamp(filedAt)}.` : null}
          {filedReference ? ` Reference: "${filedReference}" (verbatim, as recorded by the declarant).` : null}
        </p>
      </div>

      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-[var(--text-tertiary)]">
              Total embedded emissions (full precision)
            </span>

            <span className="font-mono text-lg font-semibold tabular-nums text-[var(--text-primary)]">
              {totals ? `${totals.embedded_emissions_tco2e} tCO2e` : "Unavailable"}
            </span>
          </div>

          <Badge tone="warning">
            Not rounded -- declaration rounding method unresolved
          </Badge>
        </div>

        {/* The honesty callout itself -- always visible, never a
            tooltip-only disclosure, per this task's own requirement that
            this be rendered as visually honest as the existing
            REFERENCE_REQUIRED/UNAVAILABLE badges elsewhere. */}
        <div className="rounded-[var(--radius-md)] bg-[var(--color-warning-100)] px-4 py-3 text-sm text-[var(--color-warning-700)]">
          <p className="font-medium">
            Declaration-time rounding is an escalated, unresolved
            regulatory gap ({rounding?.rule_ref ?? "RULE-EE-006"}).
          </p>

          <p className="mt-1">
            {rounding?.note ??
              "The EU's published CBAM text states a precision ceiling for declaration-time figures but no rounding method (round-half-up, round-half-even, or truncation). Every figure above is full Decimal precision, not a declaration-format rounded total, until an owner-confirmed method is adopted."}
          </p>
        </div>

        {totals ? (
          <p className="text-xs text-[var(--text-tertiary)]">
            {totals.shipment_count} shipment(s), {totals.line_count} line(s) in this snapshot.
          </p>
        ) : null}

        {shipmentRows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border-default)] text-[var(--text-tertiary)]">
                  <th className="px-2 py-1.5 font-medium">
                    Shipment
                  </th>

                  <th className="px-2 py-1.5 font-medium">
                    Status at filing
                  </th>

                  <th className="px-2 py-1.5 font-medium">
                    Lines
                  </th>

                  <th className="px-2 py-1.5 font-medium">
                    Embedded emissions (tCO2e)
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-[var(--border-default)]">
                {shipmentRows.map(
                  (row) => (
                    <tr key={row.shipment_id}>
                      <td className="px-2 py-1.5 text-[var(--text-primary)]">
                        {row.reference}
                      </td>

                      <td className="px-2 py-1.5 text-[var(--text-secondary)]">
                        {row.status_at_filing}
                      </td>

                      <td className="px-2 py-1.5 tabular-nums text-[var(--text-secondary)]">
                        {row.line_count}
                      </td>

                      <td className="px-2 py-1.5 font-mono tabular-nums text-[var(--text-secondary)]">
                        {row.embedded_emissions_tco2e}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        ) : null}

        <div className="rounded-[var(--radius-md)] bg-[var(--surface-sunken)] px-4 py-3 text-xs text-[var(--text-secondary)]">
          {scope?.note ??
            "Snowkap's own preparation summary, for the declarant's own use -- not a reproduction of the official CBAM registry submission form. The authorised declarant files through the official channel themselves."}
        </div>
      </div>
    </Card>
  );
}

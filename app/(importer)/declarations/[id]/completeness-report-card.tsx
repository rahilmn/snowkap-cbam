import {
  Badge,
} from "../../../../components/ui/badge";

import {
  Card,
} from "../../../../components/ui/card";

import type {
  CompletenessReport,
} from "../../../../src/domain/declarations/types";

const BLOCKER_LABEL: Record<string, string> = {
  NO_SHIPMENTS_IN_PERIOD: "No shipments in this period",
  SHIPMENT_NOT_LOCKABLE: "Shipment not READY or LOCKED",
  SHIPMENT_HAS_NO_LINES: "Shipment has no lines",
  LINE_NOT_DETERMINED: "Line not determined",
  LINE_NOT_CALCULATED: "Line not calculated",
};

/**
 * Renders the completeness gate's own findings verbatim -- every
 * blocker named individually (shipment + line where it applies), never
 * collapsed to a bare "incomplete" boolean. This is the DRAFT-time
 * preview of exactly what public.record_declaration_filed() will refuse
 * at filing time if ignored (see src/domain/declarations/types.ts's own
 * doc comment on CompletenessBlockerReason), so a caller who reads this
 * card should never be surprised by a later NOT_READY/INCOMPLETE/
 * SHIPMENTS_NOT_LOCKABLE rejection.
 */
export function CompletenessReportCard(
  {
    report,
  }: {
    report: CompletenessReport | null;
  },
) {
  return (
    <Card>
      <div className="border-b border-[var(--border-default)] p-4">
        <h2 className="text-sm font-medium text-[var(--text-primary)]">
          Completeness
        </h2>

        <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">
          {report
            ? `As of the last refresh (${report.shipment_count} shipment(s), ${report.line_count} line(s)).`
            : "Not yet generated -- click Generate / refresh draft to compute this."}
        </p>
      </div>

      {!report ? (
        <p className="p-4 text-sm text-[var(--text-secondary)]">
          No completeness report yet.
        </p>
      ) : report.complete ? (
        <div className="p-4">
          <Badge tone="success">
            Complete -- ready to mark ready
          </Badge>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border-default)] text-[var(--text-tertiary)]">
                <th className="px-4 py-2 font-medium">
                  Shipment
                </th>

                <th className="px-4 py-2 font-medium">
                  Line
                </th>

                <th className="px-4 py-2 font-medium">
                  Blocker
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-[var(--border-default)]">
              {report.blockers.map(
                (blocker, index) => (
                  <tr key={`${blocker.reason}-${blocker.shipment_id ?? "period"}-${blocker.line_id ?? index}`}>
                    <td className="px-4 py-2 text-[var(--text-primary)]">
                      {blocker.shipment_reference ?? "This period"}
                    </td>

                    <td className="px-4 py-2 tabular-nums text-[var(--text-secondary)]">
                      {blocker.line_number ?? "—"}
                    </td>

                    <td className="px-4 py-2">
                      <Badge tone="warning">
                        {BLOCKER_LABEL[blocker.reason] ?? blocker.reason}
                      </Badge>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

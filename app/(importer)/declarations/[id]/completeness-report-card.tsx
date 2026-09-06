import Link from "next/link";

import {
  Badge,
} from "../../../../components/ui/badge";

import {
  StatusBadge,
} from "../../../../components/ui/status-badge";

import {
  Card,
} from "../../../../components/ui/card";

import type {
  CompletenessReport,
} from "../../../../src/domain/declarations/types";

import {
  blockerReasonKey,
} from "../../../../src/domain/status-vocabulary";

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
    stale = false,
  }: {
    report: CompletenessReport | null;
    // 2026-09-06 (S5 cross-phase hardening). true when a member shipment
    // has since been reopened (READY -> DRAFT), which reverts this
    // declaration to DRAFT but cannot also clear the cached report in
    // the same database statement -- see get-declaration-detail.ts's
    // own completeness_report_stale doc comment for the full mechanism.
    // A stale "complete" claim must never render as the same success
    // badge a genuinely current one does.
    stale?: boolean;
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
      ) : stale ? (
        <div className="p-4">
          <Badge tone="warning">
            Needs refresh
          </Badge>

          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            A member shipment was reopened since this was last checked, so
            this report no longer reflects the current state. Click
            Generate / refresh draft to recheck completeness.
          </p>
        </div>
      ) : report.complete ? (
        <div className="p-4">
          <Badge tone="success">
            Complete -- ready to approve for filing
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
                      {blocker.shipment_id ? (
                        <Link
                          href={`/shipments/${blocker.shipment_id}`}
                          className="font-medium hover:underline"
                        >
                          {blocker.shipment_reference ?? "View shipment"}
                        </Link>
                      ) : (
                        blocker.shipment_reference ?? "This period"
                      )}
                    </td>

                    <td className="px-4 py-2 tabular-nums text-[var(--text-secondary)]">
                      {blocker.line_number ?? "—"}
                    </td>

                    <td className="px-4 py-2">
                      <StatusBadge
                        statusKey={blockerReasonKey(blocker.reason)}
                      />
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

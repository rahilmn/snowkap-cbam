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
    staleReason = null,
    declarationStatus,
    anyMemberShipmentLocked = false,
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
    // 2026-09-06 (S5 review remediation round 2, finding EF2-B3). Which
    // of the two independent reasons raised `stale` -- see
    // get-declaration-detail.ts's own DeclarationDetail.
    // completeness_report_stale_reason doc comment. The prior version of
    // this card hardcoded the MEMBER_REOPENED explanation for every
    // stale cause, which was FALSE (and pointed at a "Generate /
    // refresh draft" control that isn't even rendered for a READY
    // declaration) whenever DATASET_SUPERSEDED was the actual reason.
    staleReason?: "MEMBER_REOPENED" | "DATASET_SUPERSEDED" | null;
    // Needed alongside staleReason because the DATASET_SUPERSEDED
    // recovery instruction differs by status: a DRAFT declaration can
    // still be refreshed directly on this page; a READY declaration has
    // no refresh control here at all (declaration-actions.tsx renders
    // only RecordFiledForm for READY) -- the affected shipment must be
    // reopened first, from the shipment's own detail page.
    declarationStatus?: "DRAFT" | "READY" | "FILED_RECORDED" | "VOID";
    // 2026-09-07 (S5 review round 3, findings S5R3-VOCAB-B1/S5R3-GAS-B1).
    // "Reopen the affected shipment" is impossible once that shipment is
    // LOCKED -- and a READY declaration whose members are LOCKED is not
    // an edge case, it is the routine shape of an AMENDMENT
    // (buildCompletenessReport/record_declaration_filed both deliberately
    // accept LOCKED as lockable, so an amendment over already-filed,
    // LOCKED shipments reaches complete:true and READY normally).
    // REOPEN requires shipment.status === "READY"
    // (src/domain/shipments/lifecycle.ts), RLS's own
    // shipments_update_own_org_not_terminal excludes LOCKED, and
    // transition-actions.tsx renders no controls at all for a LOCKED
    // shipment -- so the old unconditional instruction sent the reader
    // to a page with nothing on it. Whether ANY member shipment is
    // LOCKED, not which specific one carries the stale line -- this
    // card has no way to name the specific shipment (buildCompletenessReport's
    // dataset-currency check is declaration-wide, not per-shipment), so
    // this mirrors declarations/actions.ts's own DATASET_SUPERSEDED/
    // CALCULATION_ENGINE_OUTDATED messages (finding A2), which hedge the
    // same way for the identical reason.
    anyMemberShipmentLocked?: boolean;
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
            {staleReason === "DATASET_SUPERSEDED"
              ? declarationStatus === "READY"
                ? anyMemberShipmentLocked
                  ? "A regulatory dataset behind one of this declaration's default-value lines has since been corrected, so this report no longer reflects the current state. If the affected member shipment is still editable, reopen it, redetermine that line against the current dataset, then approve this declaration for filing again. If it has already been LOCKED (for example by an earlier filing -- the routine case for an amendment), this cannot be corrected through the normal declaration flow -- contact support."
                  : "A regulatory dataset behind one of this declaration's default-value lines has since been corrected, so this report no longer reflects the current state. Reopen the affected shipment, redetermine that line against the current dataset, then approve this declaration for filing again."
                : "A regulatory dataset behind one of this declaration's default-value lines has since been corrected, so this report no longer reflects the current state. Click Generate / refresh draft to recheck completeness against the current dataset."
              : "A member shipment was reopened since this was last checked, so this report no longer reflects the current state. Click Generate / refresh draft to recheck completeness."}
          </p>
        </div>
      ) : report.complete ? (
        <div className="p-4">
          <Badge tone="success">
            {
              // 2026-09-07 (S5 review round 4, finding S5R4-GUID-B1).
              // `report.complete` alone answers "were there any
              // blockers at the last refresh," never "what can the
              // reader still do about it" -- completeness_report is
              // frozen the instant a declaration leaves DRAFT
              // (app.prevent_declaration_fact_change, 20260905110000)
              // and is never cleared on READY -> FILED_RECORDED, so
              // every one of this codebase's real FILED_RECORDED
              // declarations (confirmed live: 22/22, all complete:true)
              // rendered the DRAFT-only "ready to approve for filing"
              // wording on an already-approved, already-filed,
              // permanent compliance record -- right beside the
              // FiledSnapshotCard showing it was, in fact, already
              // filed. declarationStatus is already a prop this
              // component receives and uses one branch up (the
              // DATASET_SUPERSEDED stale message); this success branch
              // had never used it at all.
              declarationStatus === "FILED_RECORDED"
                ? "Complete -- filed"
                : declarationStatus === "READY"
                  ? "Complete -- approved for filing"
                  : declarationStatus === "VOID"
                    ? "Complete"
                    : "Complete -- ready to approve for filing"
            }
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

                      {
                        // 2026-09-07 (S5 review round 6, findings
                        // S5R6-A-B2/S5R6-A-GUID2). The bare badge above
                        // reads "redetermine this line" unconditionally
                        // -- impossible for a LOCKED shipment's line
                        // (shipments_update_own_org_not_terminal excludes
                        // LOCKED; transition-actions.tsx renders no
                        // control at all for one), and a LOCKED member
                        // shipment is the ROUTINE shape of an amendment,
                        // not an edge case (buildCompletenessReport
                        // accepts LOCKED as lockable, same as
                        // record_declaration_filed's own predicate). This
                        // card's sibling `stale` branch already hedges
                        // the identical fact via anyMemberShipmentLocked
                        // -- the same coarse-grained ("at least one
                        // member shipment is LOCKED," not which specific
                        // one) signal, for the identical reason:
                        // buildCompletenessReport's dataset-currency
                        // check has no per-blocker shipment status to
                        // report. Wording matches declarations/
                        // actions.ts's own DATASET_SUPERSEDED message
                        // (finding A2) rather than inventing new prose.
                        blocker.reason === "LINE_DATASET_SUPERSEDED" && anyMemberShipmentLocked ? (
                          <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                            If this shipment has already been LOCKED (the
                            routine case for an amendment), it cannot be
                            redetermined through the normal declaration
                            flow -- contact support.
                          </p>
                        ) : null
                      }
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

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

type DeclarationStatusForCard =
  "DRAFT" | "READY" | "FILED_RECORDED" | "VOID" | undefined;

/**
 * 2026-09-07 (S5 review round 10, finding S5R10-VOCAB-B1, live-
 * reproduced). completeness_report is nullable at the schema level, and
 * a bare DRAFT with no report at all is reachable through the ordinary
 * "Create amendment" button (createDeclarationAmendment inserts exactly
 * that row). From there, declarations_update_own_org_pre_filing (the
 * same RLS policy that admits every other bare-client status PATCH this
 * screen already accounts for) lets an ADMIN/OWNER move it straight to
 * VOID -- or, since app.enforce_declaration_members_are_approved's own
 * WHERE clause is vacuously satisfied by an empty member_shipment_ids
 * array, straight to READY -- with no trigger requiring a report to
 * exist first. This was the one message in the file that never branched
 * on declarationStatus the way every OTHER conditional message here
 * already does (RefreshDraftForm, the only control that could act on
 * this message, renders for DRAFT only -- see declaration-actions.tsx).
 * A VOID declaration pointed at a button that does not exist anywhere
 * on the page; a READY one claimed "Not yet generated" beside
 * DeclarationActions' real, irreversible "Record filed" control.
 *
 * 2026-09-07 (S5 review round 11, finding S5R11-VOCAB-B1, live-
 * reproduced). Round 10's own fix grouped FILED_RECORDED into the SAME
 * branch as READY -- reasoning only about the round-10 bypass (an empty
 * member set), a path that can never reach FILED_RECORDED at all
 * (record_declaration_filed()'s own NO_MEMBER_SHIPMENTS check refuses an
 * empty member set outright). But FILED_RECORDED has its OWN, distinct,
 * genuinely reachable path to a null completeness_report: an admin who
 * sets member_shipment_ids and status='READY' directly (skipping
 * markDeclarationReady/"Generate or refresh draft") leaves
 * completeness_report permanently null, and record_declaration_filed()
 * never reads that column at all -- it independently, exhaustively
 * re-verifies every fact the column would have captured (lockable
 * members, period membership, population match, calculation currency,
 * engine version, dataset currency) at filing time. A declaration that
 * reached FILED_RECORDED has, by construction, passed every one of
 * those checks -- filing IS the readiness check, regardless of what the
 * UI-cached completeness_report column holds. Telling the reader
 * "readiness was never actually checked... contact support" here is
 * FALSE, and actively harmful: it sits beside the real FiledSnapshotCard
 * showing a genuine, DB-computed filed total, and tells an admin to
 * distrust an already-filed, immutable, correctly-verified compliance
 * record. (READY keeps the original wording -- for READY,
 * app.enforce_declaration_members_are_approved only checks member
 * shipments are individually READY/LOCKED, never per-line calculation
 * currency/engine version/dataset currency/population match, so
 * "readiness was never actually checked" is genuinely true there.)
 */
function noReportSubtitle(
  declarationStatus: DeclarationStatusForCard,
): string {
  if (declarationStatus === "FILED_RECORDED") {
    return "This declaration was filed without a completeness report ever being generated through the normal draft flow.";
  }

  if (declarationStatus === "READY") {
    return "No completeness report was ever generated for this declaration -- this should not normally occur.";
  }

  if (declarationStatus === "VOID") {
    return "This declaration was voided before a completeness report was ever generated.";
  }

  return "Not yet generated -- click Generate / refresh draft to compute this.";
}

/** See noReportSubtitle's own doc comment -- the matching body copy. */
function noReportBody(
  declarationStatus: DeclarationStatusForCard,
): string {
  if (declarationStatus === "FILED_RECORDED") {
    return "But every fact that report would have captured -- member readiness, calculation currency, engine version, and dataset currency -- was independently re-checked at filing time; filing itself is the readiness check. See the filed snapshot below for the recorded figures.";
  }

  if (declarationStatus === "READY") {
    return "No completeness report exists for this declaration, so its readiness was never actually checked -- contact support before relying on it.";
  }

  if (declarationStatus === "VOID") {
    return "No completeness report was generated before this declaration was voided.";
  }

  return "No completeness report yet.";
}

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
    allMemberShipmentsLocked = false,
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
    // 2026-09-06 (S5 review remediation round 2, finding EF2-B3;
    // widened round 7, finding S5R7-A-B1). Which of the three
    // independent reasons raised `stale` -- see get-declaration-detail.ts's
    // own DeclarationDetail.completeness_report_stale_reason doc
    // comment. The prior version of this card hardcoded the
    // MEMBER_REOPENED explanation for every stale cause, which was
    // FALSE (and pointed at a "Generate / refresh draft" control that
    // isn't even rendered for a READY declaration) whenever
    // DATASET_SUPERSEDED was the actual reason.
    staleReason?: "MEMBER_REOPENED" | "DATASET_SUPERSEDED" | "PERIOD_MEMBERSHIP_CHANGED" | "CALCULATION_ENGINE_OUTDATED" | null;
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
    // 2026-09-07 (S5 review round 8, finding S5R8-A-B1). Distinct from
    // anyMemberShipmentLocked above -- the PERIOD_MEMBERSHIP_CHANGED
    // recovery ("reopen one of its existing member shipments") only
    // needs ONE reopenable member to work, so it is blocked only once
    // EVERY member shipment is LOCKED, not merely once one is. See
    // page.tsx's own call site comment for why "every member LOCKED"
    // is equivalent to "no member is READY" for a READY declaration.
    allMemberShipmentsLocked?: boolean;
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
            : noReportSubtitle(declarationStatus)}
        </p>
      </div>

      {!report ? (
        <p className="p-4 text-sm text-[var(--text-secondary)]">
          {noReportBody(declarationStatus)}
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
              : staleReason === "CALCULATION_ENGINE_OUTDATED"
              ? // 2026-09-07 (S5 review round 8, finding S5R8-A-B2).
                // Unlike DATASET_SUPERSEDED, the READY recovery here does
                // NOT require reopening the member shipment first --
                // record_calculation_result (20260906210000) deliberately
                // still permits recalculating a READY line with a new
                // engine version, specifically so this recovery never
                // needs the full reopen/re-approve cycle (matches
                // filedMessageFor's own CALCULATION_ENGINE_OUTDATED
                // wording in actions.ts). Still hedges on
                // anyMemberShipmentLocked: a LOCKED member has no
                // recalculate path either (canRecalculate is READY-only).
                //
                // 2026-09-07 (S5 review round 9, finding S5R9-VOCAB-B1).
                // The two messages below originally ended with "...then
                // approve this declaration for filing again" -- a
                // DRAFT->READY action (MarkReadyForm) that DOES NOT
                // EXIST as a control while this declaration is already
                // READY (declaration-actions.tsx renders only
                // RecordFiledForm then), and is never needed here anyway
                // -- recalculating a READY line never reopens the
                // shipment, so the declaration stays READY throughout
                // and there is nothing to re-approve. Contradicted this
                // very branch's own comment above it. Reworded to match
                // filedMessageFor's own correct CALCULATION_ENGINE_
                // OUTDATED wording ("...then record the filing").
                declarationStatus === "READY"
                ? anyMemberShipmentLocked
                  ? "One or more lines were calculated by an earlier version of the calculation engine, so this report no longer reflects the current state. If the affected member shipment is still READY (not LOCKED), recalculate those lines directly on the shipment's own detail page (no need to reopen it), then record the filing -- the earlier results are kept for provenance. If it has already been LOCKED (for example by an earlier filing -- the routine case for an amendment), this cannot be corrected through the normal declaration flow -- contact support."
                  : "One or more lines were calculated by an earlier version of the calculation engine, so this report no longer reflects the current state. Recalculate those lines directly on the shipment's own detail page (no need to reopen it), then record the filing -- the earlier results are kept for provenance."
                : "One or more lines were calculated by an earlier version of the calculation engine, so this report no longer reflects the current state. Click Generate / refresh draft to recheck completeness against the current calculation engine version."
              : staleReason === "PERIOD_MEMBERSHIP_CHANGED"
              ? // 2026-09-07 (S5 review round 7, finding S5R7-A-B1,
                // guidance dimension). A new shipment entering the
                // period (or an existing one leaving it) never changes
                // any EXISTING member shipment's own status, so it
                // never fires app.invalidate_declaration_approval_on_reopen
                // -- a READY declaration stays READY, with no "Generate
                // / refresh draft" control on this page at all, until
                // one of its existing member shipments is reopened.
                declarationStatus === "READY"
                ? // 2026-09-07 (S5 review round 8, finding S5R8-A-B1).
                  // The instruction below only needs ONE reopenable
                  // (non-LOCKED) member shipment to work -- but an
                  // amendment declaration's entire member set is
                  // routinely already LOCKED from the predecessor's own
                  // filing (the same routine case DATASET_SUPERSEDED's
                  // own hedge above already accounts for), and
                  // shipments_update_own_org_not_terminal structurally
                  // refuses to reopen a LOCKED shipment for anyone. Live-
                  // reproduced: an all-LOCKED amendment whose period
                  // gains a new shipment reaches this exact branch with
                  // zero reopenable members.
                  allMemberShipmentsLocked
                  ? "The shipments in this declaration's reporting period have changed since this report was generated -- one has moved period, or a new one has been added. Every existing member shipment has already been LOCKED (for example by an earlier filing -- the routine case for an amendment), so this cannot be corrected through the normal declaration flow -- contact support."
                  : "The shipments in this declaration's reporting period have changed since this report was generated -- one has moved period, or a new one has been added. Reopen one of its existing member shipments from that shipment's own detail page -- this returns the declaration to draft, where a fresh Generate/refresh will pick up the current period membership -- then approve it for filing again."
                : "The shipments in this declaration's reporting period have changed since this report was generated -- one has moved period, or a new one has been added. Click Generate / refresh draft to recheck the current period membership."
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
                        //
                        // 2026-09-07 (S5 review round 9, finding
                        // S5R9-VOCAB-B2). LINE_CALCULATION_ENGINE_
                        // OUTDATED (added round 8, S5R8-A-B2) is the
                        // identical shape -- a LOCKED shipment's line can
                        // never be recalculated either (record_
                        // calculation_result refuses LOCKED
                        // unconditionally, regardless of engine version)
                        // -- but this hint was never extended to it,
                        // even though the sibling `stale` banner above
                        // DOES hedge CALCULATION_ENGINE_OUTDATED on the
                        // same anyMemberShipmentLocked signal. Verb
                        // varies with the blocker's own recovery action
                        // (redetermine vs. recalculate); everything else
                        // matches.
                        (blocker.reason === "LINE_DATASET_SUPERSEDED" || blocker.reason === "LINE_CALCULATION_ENGINE_OUTDATED") &&
                        anyMemberShipmentLocked ? (
                          <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                            If this shipment has already been LOCKED (the
                            routine case for an amendment), it cannot be
                            {" "}
                            {blocker.reason === "LINE_DATASET_SUPERSEDED" ? "redetermined" : "recalculated"}
                            {" "}
                            through the normal declaration flow -- contact
                            support.
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

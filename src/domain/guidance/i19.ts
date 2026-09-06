import {
  transitionShipment,
} from "../shipments/lifecycle";

import type {
  Shipment,
} from "../shipments/types";

import type {
  Declaration,
} from "../declarations/types";

import type {
  ReportingPeriod,
} from "../shared/reporting-period";

import type {
  GuidanceItem,
} from "./types";

/**
 * I19 (v2.1.1, exact spec):
 * - Shipment DRAFT
 * - transitionShipment(MARK_READY) is OK
 * - shipment is complete but not approved
 * - actionable item: "Mark {ref} ready"
 * - REQUIRED / APPROVAL normally
 * - becomes REQUIRED / FILING when a declaration exists for the period
 *
 * Deliberately reuses the real, pure `transitionShipment` domain
 * function to check MARK_READY eligibility -- calling it here computes
 * a `TransitionShipmentResult` without persisting anything (this
 * module never touches Supabase), so "would MARK_READY succeed" is
 * answered by the SAME rule the real transition enforces, not a
 * second, hand-copied state machine (CLAUDE.md: never a second
 * calculation/domain engine).
 */
function sameReportingPeriod(
  a: ReportingPeriod,
  b: ReportingPeriod,
): boolean {
  if (a.kind !== b.kind || a.year !== b.year) {
    return false;
  }

  if (a.kind === "QUARTERLY" && b.kind === "QUARTERLY") {
    return a.quarter === b.quarter;
  }

  return true;
}

/**
 * The ONLY cross-item priority/impact relation v2.1.1 specifies (I22):
 * every I19 item for a shipment that is a NON-MEMBER of a declaration D
 * covering its reporting period (i.e. not in D's own persisted
 * `member_shipment_ids` -- a real, concrete fact: member_shipment_ids
 * is a snapshot taken when the draft was last generated/refreshed, not
 * a live query, so a shipment created or matching the period after
 * that snapshot is genuinely absent from it) keeps priority REQUIRED
 * but has its impact forced from FILING back to APPROVAL -- it is NOT
 * suppressed, NOT merged into anything, NOT downgraded to RECOMMENDED,
 * and its action remains "Mark ready". There is no separate I22
 * guidance item/card -- this is purely a predicate I19 (and, pending
 * their own exact v2.1.1 definitions, I2/I3/I5/I16/I17 in a future
 * slice) consults to adjust its OWN item's impact.
 *
 * 2026-09-05 (S2 remediation, B2, fresh Opus 5 review). This USED to
 * additionally require the declaration itself be DRAFT with an
 * incomplete completeness report -- a precondition v2.1.1 does not
 * specify. That gate meant a non-member of a FILED_RECORDED
 * declaration, or a DRAFT one whose completeness report had never been
 * generated, wrongly kept FILING: the exact false reassurance this
 * relation exists to prevent ("marking this shipment ready keeps it
 * eligible to be included when that declaration is filed", said about
 * a declaration whose own member snapshot excludes it). The rule is
 * unconditional on D's own status or completeness -- non-membership
 * alone forces APPROVAL.
 */
function isNonMemberOfDeclarationInPeriod(
  shipmentId: Shipment["id"],
  declarationsInPeriod: Declaration[],
): boolean {
  return declarationsInPeriod.some(
    (declaration) =>
      !declaration.member_shipment_ids.includes(
        shipmentId,
      ),
  );
}

export function deriveI19Items(
  shipments: Shipment[],
  declarations: Declaration[],
): GuidanceItem[] {
  const items: GuidanceItem[] =
    [];

  for (
    const shipment of shipments
  ) {
    if (shipment.status !== "DRAFT") {
      continue;
    }

    const transition =
      transitionShipment(
        shipment,
        "MARK_READY",
      );

    if (transition.status !== "OK") {
      continue;
    }

    // 2026-09-07 (S5 review round 6, finding S5R6-A-GUID1). Excludes
    // VOID -- every other declaration-period lookup in this codebase
    // already does (generate-or-refresh-declaration-draft.ts's own
    // existing-declaration query, and the schema itself:
    // declarations_period_original_uq/declarations_period_in_preparation_uq,
    // both scoped `where status <> 'VOID'`, are exactly what permits a
    // new original DRAFT to be started for a period after an earlier
    // declaration for it was voided). A VOID declaration's
    // member_shipment_ids stays frozen (app.prevent_declaration_fact_change)
    // but is a dead fact, not a live one -- left unfiltered, it produced
    // two opposite-direction wrong outcomes, live-reproduced: (1) an
    // unrelated VOID declaration for the same period that happens NOT
    // to include this shipment forces a genuinely FILING-eligible
    // shipment (named by a real, live declaration) down to APPROVAL,
    // hiding its true urgency; (2) a period whose ONLY declaration is
    // VOID but happens to include this shipment reports FILING, falsely
    // claiming "marking this shipment ready keeps it eligible to be
    // included when that declaration is filed" -- impossible, since
    // record_declaration_filed only ever transitions READY ->
    // FILED_RECORDED, never a VOID one.
    const declarationsInPeriod =
      declarations.filter(
        (declaration) =>
          declaration.status !== "VOID" &&
          sameReportingPeriod(
            declaration.reporting_period,
            shipment.reporting_period,
          ),
      );

    const declarationExistsForPeriod =
      declarationsInPeriod.length > 0;

    const forcedToApproval =
      isNonMemberOfDeclarationInPeriod(
        shipment.id,
        declarationsInPeriod,
      );

    const impact =
      declarationExistsForPeriod && !forcedToApproval
        ? "FILING"
        : "APPROVAL";

    const id =
      `I19:${shipment.id}`;

    items.push(
      {
        id,
        rule: "I19",
        // Shipment-level, not line-level or record-level -- v2.1.1's
        // aggregation rule names a parent for those two cases only;
        // I19 is neither, so it is never grouped (see aggregate.ts's
        // own comment on parent: null).
        parent: null,
        family: id,
        priority: "REQUIRED",
        impact,
        actionability: "NAVIGATE",
        title: `Mark ${shipment.reference} ready`,
        reason:
          impact === "FILING"
            ? "A declaration exists for this reporting period -- marking this shipment ready keeps it eligible to be included when that declaration is filed."
            : "This shipment has a resolved determination on every line and is ready to be marked ready.",
        href: `/shipments/${shipment.id}`,
        sortKey: shipment.reference,
      },
    );
  }

  return items;
}

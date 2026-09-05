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
 * The I22 condition, exactly: "D DRAFT with blockers." There is no
 * separate I22 guidance item/card -- this is a predicate other rules
 * (I19 here; I2/I3/I5/I16/I17 are out of this implementation's scope,
 * pending their own exact v2.1.1 definitions) consult to adjust their
 * OWN item's impact, never a card of its own.
 */
function hasI22Condition(
  declaration: Declaration,
): boolean {
  return (
    declaration.status === "DRAFT" &&
    declaration.completeness_report !== null &&
    !declaration.completeness_report.complete
  );
}

/**
 * The ONLY cross-item priority/impact relation v2.1.1 specifies: when
 * the I22 condition holds for a declaration D, every I19 item for a
 * shipment that is a NON-MEMBER of D (i.e. not in D's own persisted
 * `member_shipment_ids` -- a real, concrete fact: member_shipment_ids
 * is a snapshot taken when the draft was last generated/refreshed, not
 * a live query, so a shipment created or matching the period after
 * that snapshot is genuinely absent from it) keeps priority REQUIRED
 * but has its impact forced from FILING back to APPROVAL -- it is NOT
 * suppressed, NOT merged into anything, NOT downgraded to RECOMMENDED,
 * and its action remains "Mark ready".
 */
function isNonMemberOfBlockedDeclaration(
  shipmentId: Shipment["id"],
  declarationsInPeriod: Declaration[],
): boolean {
  return declarationsInPeriod.some(
    (declaration) =>
      hasI22Condition(declaration) &&
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

    const declarationsInPeriod =
      declarations.filter(
        (declaration) =>
          sameReportingPeriod(
            declaration.reporting_period,
            shipment.reporting_period,
          ),
      );

    const declarationExistsForPeriod =
      declarationsInPeriod.length > 0;

    const forcedToApproval =
      isNonMemberOfBlockedDeclaration(
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

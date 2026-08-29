import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import {
  transitionShipment,
  type ShipmentTransitionAction,
  type ShipmentTransitionRejectionReason,
} from "../../domain/shipments/lifecycle";

import type {
  Shipment,
} from "../../domain/shipments/types";

import type {
  ShipmentId,
} from "../../domain/shared/ids";

import {
  hasAdminAccess,
  type OrgContext,
} from "../organizations/org-context";

import {
  recordAuditEvent,
} from "../audit/record-audit-event";

import {
  SHIPMENT_COLUMNS,
  SHIPMENT_LINE_COLUMNS,
  toShipment,
  toShipmentLine,
  type ShipmentLineRow,
  type ShipmentRow,
} from "./shipment-mapper";

export type TransitionShipmentActionResult =
  | { status: "OK"; shipment: Shipment }
  | {
      status: "REJECTED";
      reason:
        | ShipmentTransitionRejectionReason
        | "NOT_FOUND"
        | "FETCH_FAILED"
        | "PERSIST_FAILED"
        | "PERMISSION_DENIED"
        // Lost a race against a concurrent transition on the same
        // shipment (P13 adversarial audit) -- see the CAS guard on the
        // persist below, same shape as every other state-transition
        // service in this codebase (mark-declaration-ready.ts,
        // manage-emission-data.ts's applyTransition, etc.). Previously
        // missing here: a lost race silently returned {status:"OK"}
        // and recorded a false audit event for a transition that never
        // actually happened.
        | "CONCURRENT_MODIFICATION";
    };

const AUDIT_EVENT_TYPE_BY_ACTION: Record<ShipmentTransitionAction, string> =
  {
    MARK_READY: "shipment.marked_ready",
    REOPEN: "shipment.reopened",
    LOCK: "shipment.locked",
    VOID: "shipment.voided",
  };

/**
 * Fetches the shipment + its lines, applies the pure transitionShipment
 * function (src/domain/shipments/lifecycle.ts, already tested) to
 * decide whether the transition is allowed, and only then persists.
 * The invariant is deliberately not re-implemented in SQL -- same
 * pattern as changeMemberRole/removeMember
 * (src/application/organizations/manage-membership.ts). RLS's own
 * status-not-terminal check on the shipments UPDATE policy is a second,
 * independent backstop (defense in depth), not a substitute for this
 * one: it cannot express "every line must be complete," only "this row
 * isn't already LOCKED/VOID".
 *
 * LOCK is ADMIN+ only, per docs/plans/MASTER_PLAN.md §27 screen 12
 * ("Shipment detail... MEMBER+ (lock ADMIN+)") -- checked here, BEFORE
 * any database read, mirroring verifyEmissionData's PERMISSION_DENIED
 * gate in manage-emission-data.ts. MARK_READY/REOPEN/VOID stay
 * available to any MEMBER: the §14 roles matrix names LOCK specifically
 * as an ADMIN-tier action ("shipment LOCK/declare (importer)") and
 * says nothing narrowing the other three, which remain the day-to-day
 * data entry §14 grants every MEMBER (P10 capability-matrix audit,
 * found missing -- this transition previously had no role check at
 * all, so any MEMBER could LOCK a shipment directly from the shipment
 * detail screen's own "Lock" button, transition-actions.tsx).
 */
export async function transitionShipmentStatus(
  supabase: SupabaseClient,
  context: OrgContext,
  shipmentId: ShipmentId,
  action: ShipmentTransitionAction,
): Promise<TransitionShipmentActionResult> {
  if (action === "LOCK" && !hasAdminAccess(context)) {
    return {
      status: "REJECTED",
      reason: "PERMISSION_DENIED",
    };
  }

  const orgId =
    context.org_id;

  const actorUserId =
    context.user_id;

  const { data: shipmentRow, error: shipmentError } =
    await supabase
      .from("shipments")
      .select(
        SHIPMENT_COLUMNS,
      )
      .eq("id", shipmentId)
      .maybeSingle();

  if (shipmentError) {
    return {
      status: "REJECTED",
      reason: "FETCH_FAILED",
    };
  }

  if (!shipmentRow) {
    return {
      status: "REJECTED",
      reason: "NOT_FOUND",
    };
  }

  // `orgId` is the caller's *active* org (from the client-writable
  // preferred-org cookie, validated only as "a membership the caller
  // has"), not necessarily the org that owns `shipmentId`. RLS alone
  // still confines the eventual write to an org the caller belongs to,
  // but without this check a caller whose active org is A, submitting a
  // shipmentId that actually belongs to their other org B, would apply
  // the transition to B's shipment and record the audit event under
  // A's org_id -- a cross-aggregate audit misattribution. Same defect
  // shape, same fix, as fetchLineForResolution in
  // resolve-line-emissions.ts: rejecting as NOT_FOUND (not a more
  // specific reason) matches how an out-of-scope id is treated
  // everywhere else in this codebase -- it doesn't reveal that the id
  // exists under a different org.
  if ((shipmentRow as ShipmentRow).org_id !== orgId) {
    return {
      status: "REJECTED",
      reason: "NOT_FOUND",
    };
  }

  const { data: lineRows, error: linesError } =
    await supabase
      .from("shipment_lines")
      .select(
        SHIPMENT_LINE_COLUMNS,
      )
      .eq("shipment_id", shipmentId);

  if (linesError) {
    return {
      status: "REJECTED",
      reason: "FETCH_FAILED",
    };
  }

  const shipment =
    toShipment(
      shipmentRow as ShipmentRow,
      ((lineRows ?? []) as ShipmentLineRow[]).map(
        toShipmentLine,
      ),
    );

  const transitionResult =
    transitionShipment(
      shipment,
      action,
    );

  if (transitionResult.status === "REJECTED") {
    return transitionResult;
  }

  // CAS guard (.eq("status", shipment.status)): without it, two
  // concurrent transitions racing between their own fetch above and
  // this UPDATE (e.g. one admin's VOID racing another's LOCK) could
  // both pass transitionShipment's in-memory check against their own
  // stale snapshot -- the second UPDATE would then be silently
  // filtered to zero rows by RLS's own terminal-status check (no
  // error), and this function would still report {status:"OK"} and
  // record a permanent, false shipment.locked/.voided audit event for
  // a transition that never happened (P13 adversarial audit).
  const { data: updated, error: updateError } =
    await supabase
      .from("shipments")
      .update(
        { status: transitionResult.shipment.status },
      )
      .eq("id", shipmentId)
      .eq("status", shipment.status)
      .select("id")
      .maybeSingle();

  if (updateError) {
    return {
      status: "REJECTED",
      reason: "PERSIST_FAILED",
    };
  }

  if (!updated) {
    return {
      status: "REJECTED",
      reason: "CONCURRENT_MODIFICATION",
    };
  }

  await recordAuditEvent(
    supabase,
    {
      orgId,
      actorUserId,
      eventType: AUDIT_EVENT_TYPE_BY_ACTION[action],
      aggregateType: "SHIPMENT",
      aggregateId: shipmentId,
      payload: {
        reference: shipment.reference,
        from_status: shipment.status,
        to_status: transitionResult.shipment.status,
      },
    },
  );

  return {
    status: "OK",
    shipment: transitionResult.shipment,
  };
}

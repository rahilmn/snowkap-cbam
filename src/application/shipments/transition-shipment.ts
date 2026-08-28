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
  OrganizationId,
  ShipmentId,
  UserId,
} from "../../domain/shared/ids";

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
      reason: ShipmentTransitionRejectionReason | "NOT_FOUND" | "FETCH_FAILED" | "PERSIST_FAILED";
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
 */
export async function transitionShipmentStatus(
  supabase: SupabaseClient,
  orgId: OrganizationId,
  actorUserId: UserId,
  shipmentId: ShipmentId,
  action: ShipmentTransitionAction,
): Promise<TransitionShipmentActionResult> {
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

  const { error: updateError } =
    await supabase
      .from("shipments")
      .update(
        { status: transitionResult.shipment.status },
      )
      .eq("id", shipmentId);

  if (updateError) {
    return {
      status: "REJECTED",
      reason: "PERSIST_FAILED",
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

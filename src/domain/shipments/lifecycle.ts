import type {
  Shipment,
} from "./types.js";

import {
  isLineComplete,
} from "./invariants.js";

export type ShipmentTransitionAction =
  | "MARK_READY"
  | "REOPEN"
  | "LOCK"
  | "VOID";

export type ShipmentTransitionRejectionReason =
  | "NO_LINES"
  | "LINE_INCOMPLETE"
  | "SHIPMENT_NOT_DRAFT"
  | "SHIPMENT_NOT_READY"
  | "SHIPMENT_ALREADY_LOCKED"
  | "SHIPMENT_ALREADY_VOID";

export type TransitionShipmentResult =
  | { status: "OK"; shipment: Shipment }
  | { status: "REJECTED"; reason: ShipmentTransitionRejectionReason };

function rejected(
  reason: ShipmentTransitionRejectionReason,
): TransitionShipmentResult {
  return {
    status: "REJECTED",
    reason,
  };
}

function ok(
  shipment: Shipment,
): TransitionShipmentResult {
  return {
    status: "OK",
    shipment,
  };
}

/**
 * The Shipment status lifecycle:
 *
 *   DRAFT --MARK_READY--> READY --LOCK--> LOCKED
 *     ^                     |
 *     +------REOPEN---------+
 *
 *   DRAFT|READY --VOID--> VOID
 *
 * LOCKED and VOID are terminal: neither line data nor status can change
 * from them again (VOID rejects a second VOID; there is no unlock
 * action here — LOCK is meant to happen only via declaration inclusion,
 * an application-layer concern outside this pure function). See
 * docs/architecture/DOMAIN_MODEL.md for the full lifecycle diagram.
 */
export function transitionShipment(
  shipment: Shipment,
  action: ShipmentTransitionAction,
): TransitionShipmentResult {
  switch (action) {
    case "MARK_READY": {
      if (shipment.status !== "DRAFT") {
        return rejected(
          "SHIPMENT_NOT_DRAFT",
        );
      }

      if (shipment.lines.length === 0) {
        return rejected(
          "NO_LINES",
        );
      }

      if (
        shipment.lines.some(
          (line) => !isLineComplete(line),
        )
      ) {
        return rejected(
          "LINE_INCOMPLETE",
        );
      }

      return ok(
        {
          ...shipment,
          status: "READY",
        },
      );
    }

    case "REOPEN": {
      if (shipment.status !== "READY") {
        return rejected(
          "SHIPMENT_NOT_READY",
        );
      }

      return ok(
        {
          ...shipment,
          status: "DRAFT",
        },
      );
    }

    case "LOCK": {
      if (shipment.status !== "READY") {
        return rejected(
          "SHIPMENT_NOT_READY",
        );
      }

      return ok(
        {
          ...shipment,
          status: "LOCKED",
        },
      );
    }

    case "VOID": {
      if (shipment.status === "LOCKED") {
        return rejected(
          "SHIPMENT_ALREADY_LOCKED",
        );
      }

      if (shipment.status === "VOID") {
        return rejected(
          "SHIPMENT_ALREADY_VOID",
        );
      }

      return ok(
        {
          ...shipment,
          status: "VOID",
        },
      );
    }
  }
}

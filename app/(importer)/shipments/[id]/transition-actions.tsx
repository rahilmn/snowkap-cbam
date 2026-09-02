"use client";

import {
  useActionState,
} from "react";

import {
  ConfirmSubmitButton,
} from "../../../../components/ui/confirm-submit-button";

import {
  Button,
} from "../../../../components/ui/button";

import {
  transitionShipmentAction,
} from "./actions";

import {
  initialLineActionState,
} from "./action-state";

import type {
  ShipmentStatus,
} from "../../../../src/domain/shipments/types";

import type {
  ShipmentTransitionAction,
} from "../../../../src/domain/shipments/lifecycle";

interface TransitionConfirmation {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: "default" | "destructive";
}

interface TransitionActionSpec {
  action: ShipmentTransitionAction;
  label: string;
  variant: "primary" | "secondary" | "destructive";

  /**
   * 2026-09-03 (P14). Present only on the transitions that cannot be
   * undone. MARK_READY and REOPEN move between DRAFT and READY in both
   * directions and are deliberately left un-gated: confirming a
   * reversible step trains people to dismiss dialogs without reading
   * them, which is how the ones that matter stop working.
   */
  confirm?: TransitionConfirmation;
}

const VOID_CONFIRMATION: TransitionConfirmation =
  {
    title: "Void this shipment?",
    description:
      "A void shipment is permanently excluded from reporting and declarations, and can never be edited or reopened. This cannot be undone.",
    confirmLabel: "Void shipment",
    cancelLabel: "Keep shipment",
    variant: "destructive",
  };

const ACTIONS_BY_STATUS: Record<
  ShipmentStatus,
  TransitionActionSpec[]
> = {
  DRAFT: [
    { action: "MARK_READY", label: "Mark ready", variant: "primary" },
    { action: "VOID", label: "Void", variant: "destructive", confirm: VOID_CONFIRMATION },
  ],

  READY: [
    { action: "REOPEN", label: "Reopen", variant: "secondary" },
    {
      action: "LOCK",
      label: "Lock",
      variant: "primary",
      confirm: {
        title: "Lock this shipment?",
        description:
          "A locked shipment can never be edited or reopened, and its lines and calculations become immutable. Lock it only once every line's determination and calculation are final.",
        confirmLabel: "Lock shipment",
        cancelLabel: "Not yet",
      },
    },
    { action: "VOID", label: "Void", variant: "destructive", confirm: VOID_CONFIRMATION },
  ],

  LOCKED: [],

  VOID: [],
};

export function TransitionActions(
  {
    shipmentId,
    status,
    lineCount,
  }: {
    shipmentId: string;
    status: ShipmentStatus;
    lineCount: number;
  },
) {
  const actions =
    ACTIONS_BY_STATUS[status];

  if (actions.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex gap-2">
        {actions.map(
          (item) => (
            <TransitionButton
              key={item.action}
              shipmentId={shipmentId}
              action={item.action}
              label={item.label}
              variant={item.variant}
              confirm={item.confirm}
            />
          ),
        )}
      </div>

      {status === "DRAFT" && lineCount > 0 ? (
        <p className="text-xs text-[var(--text-tertiary)]">
          Ready requires every line to have a resolved emission
          determination -- resolve a default value or use actual data
          on each line below.
        </p>
      ) : null}
    </div>
  );
}

function TransitionButton(
  {
    shipmentId,
    action,
    label,
    variant,
    confirm,
  }: {
    shipmentId: string;
    action: ShipmentTransitionAction;
    label: string;
    variant: "primary" | "secondary" | "destructive";
    confirm?: TransitionConfirmation;
  },
) {
  const [
    state,
    formAction,
    pending,
  ] =
    useActionState(
      transitionShipmentAction,
      initialLineActionState,
    );

  return (
    <form action={formAction}>
      <input
        type="hidden"
        name="shipmentId"
        value={shipmentId}
      />

      <input
        type="hidden"
        name="action"
        value={action}
      />

      {confirm ? (
        <ConfirmSubmitButton
          variant={variant}
          size="sm"
          pending={pending}
          title={
            state.status === "error" ? state.message : undefined
          }
          confirm={confirm}
        >
          {label}
        </ConfirmSubmitButton>
      ) : (
        <Button
          type="submit"
          variant={variant}
          size="sm"
          loading={pending}
          title={
            state.status === "error" ? state.message : undefined
          }
        >
          {label}
        </Button>
      )}

      {state.status === "error" ? (
        <p className="mt-1 max-w-48 text-right text-xs text-[var(--color-danger-700)]">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

"use client";

import {
  useActionState,
} from "react";

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

const ACTIONS_BY_STATUS: Record<
  ShipmentStatus,
  { action: ShipmentTransitionAction; label: string; variant: "primary" | "secondary" | "destructive" }[]
> = {
  DRAFT: [
    { action: "MARK_READY", label: "Mark ready", variant: "primary" },
    { action: "VOID", label: "Void", variant: "destructive" },
  ],

  READY: [
    { action: "REOPEN", label: "Reopen", variant: "secondary" },
    { action: "LOCK", label: "Lock", variant: "primary" },
    { action: "VOID", label: "Void", variant: "destructive" },
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
  }: {
    shipmentId: string;
    action: ShipmentTransitionAction;
    label: string;
    variant: "primary" | "secondary" | "destructive";
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

      {state.status === "error" ? (
        <p className="mt-1 max-w-48 text-right text-xs text-[var(--color-danger-700)]">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

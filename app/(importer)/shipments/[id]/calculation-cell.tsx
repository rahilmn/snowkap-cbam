"use client";

import {
  useActionState,
} from "react";

import {
  Badge,
} from "../../../../components/ui/badge";

import {
  Button,
} from "../../../../components/ui/button";

import {
  calculateLineAction,
} from "./actions";

import {
  initialLineActionState,
} from "./action-state";

import type {
  LatestLineCalculation,
} from "../../../../src/application/calculations/get-latest-calculations";

import type {
  EmissionDetermination,
} from "../../../../src/domain/emissions/types";

import {
  checkCalculationCurrency,
} from "../../../../src/domain/emissions/check-calculation-currency";

export function CalculationCell(
  {
    shipmentId,
    lineId,
    editable,
    latestCalculation,
    currentDetermination,
  }: {
    shipmentId: string;
    lineId: string;
    editable: boolean;
    latestCalculation: LatestLineCalculation | undefined;
    // The line's CURRENT emission_determination -- compared against
    // latestCalculation's own FROZEN determination below to detect the
    // P13 adversarial audit's drift (redetermined, or edited to null,
    // without a follow-up recalculation). Not read off latestCalculation
    // itself: that value is frozen at calculation time and is exactly
    // the thing that can go stale.
    currentDetermination: EmissionDetermination | null;
  },
) {
  const [
    state,
    formAction,
    pending,
  ] =
    useActionState(
      calculateLineAction,
      initialLineActionState,
    );

  const isStale =
    latestCalculation !== undefined &&
    checkCalculationCurrency(
      latestCalculation.determination,
      currentDetermination,
    ) === "STALE";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        {latestCalculation ? (
          <span className="font-mono text-sm tabular-nums text-[var(--text-primary)]">
            {latestCalculation.embedded_emissions_tco2e} tCO2e
          </span>
        ) : (
          <Badge tone="neutral">
            Not calculated
          </Badge>
        )}

        {isStale ? (
          <Badge tone="warning">
            Stale — recalculate
          </Badge>
        ) : null}

        {editable ? (
          <form action={formAction}>
            <input
              type="hidden"
              name="lineId"
              value={lineId}
            />

            <input
              type="hidden"
              name="shipmentId"
              value={shipmentId}
            />

            <Button
              type="submit"
              variant="ghost"
              size="sm"
              loading={pending}
            >
              {latestCalculation ? "Recalculate" : "Calculate"}
            </Button>
          </form>
        ) : null}
      </div>

      {state.status === "error" ? (
        <p className="text-xs text-[var(--color-danger-700)]">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

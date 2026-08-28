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

/**
 * The calculation arithmetic half of "Why this number?" -- the
 * regulatory-resolution half already exists in emissions-cell.tsx's own
 * "Why this number?" panel (the R12 trace, or an ACTUAL snapshot's
 * values), but the calculation *result* rendered here (embedded_emissions_tco2e)
 * had no explanation UI at all until now, even though calculate-line-emissions.ts
 * has always produced a full CalculationStep[] trace (formula, inputs,
 * rule_ref) for every COMPUTED result -- simply never surfaced. Renders
 * every step in order (currently always exactly one -- RULE-EE-001 for
 * a DEFAULT determination, RULE-EE-009 for ACTUAL -- but iterates
 * rather than assuming exactly one, since a future multi-step
 * calculation would append here without needing this component
 * touched again).
 */
function CalculationTrace(
  {
    steps,
  }: {
    steps: LatestLineCalculation["steps"];
  },
) {
  if (steps.length === 0) {
    return null;
  }

  return (
    <details className="group">
      <summary className="cursor-pointer text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">
        Why this number?
      </summary>

      <div className="mt-2 flex flex-col gap-2">
        {steps.map(
          (step, index) => (
            <div
              key={`${step.step}-${index}`}
              className="flex flex-col gap-1 rounded-[var(--radius-sm)] bg-[var(--surface-sunken)] p-2"
            >
              <p className="font-mono text-[11px] text-[var(--text-secondary)]">
                {step.rule_ref} · {step.formula}
              </p>

              <div className="flex flex-col gap-0.5">
                {Object.entries(step.inputs).map(
                  ([key, value]) => (
                    <div
                      key={key}
                      className="flex items-center justify-between gap-2 text-[11px] text-[var(--text-tertiary)]"
                    >
                      <span>
                        {key.replace(/_/g, " ")}
                      </span>

                      <span className="font-mono tabular-nums text-[var(--text-secondary)]">
                        {value}
                      </span>
                    </div>
                  ),
                )}
              </div>

              <div className="flex items-center justify-between gap-2 border-t border-[var(--border-default)] pt-1 text-xs">
                <span className="text-[var(--text-tertiary)]">
                  {step.step.replace(/_/g, " ")}
                </span>

                <span className="font-mono tabular-nums text-[var(--text-primary)]">
                  {step.value}
                </span>
              </div>
            </div>
          ),
        )}
      </div>
    </details>
  );
}

export function CalculationCell(
  {
    shipmentId,
    lineId,
    editable,
    latestCalculation,
  }: {
    shipmentId: string;
    lineId: string;
    editable: boolean;
    latestCalculation: LatestLineCalculation | undefined;
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

      {latestCalculation ? (
        <CalculationTrace
          steps={latestCalculation.steps}
        />
      ) : null}

      {state.status === "error" ? (
        <p className="text-xs text-[var(--color-danger-700)]">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

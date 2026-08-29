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
  verifyCalculationReproducibilityAction,
} from "./actions";

import {
  initialReproductionActionState,
} from "./reproduction-action-state";

import type {
  ResolveEmissionsActionState,
} from "./resolve-emissions-action-state";

import type {
  ShipmentLine,
} from "../../../../src/domain/shipments/types";

import type {
  RegulatoryValue,
} from "../../../../src/domain/regulatory/types";

import type {
  LatestLineCalculation,
} from "../../../../src/application/calculations/get-latest-calculations";

const VALUE_STATUS_TONE = {
  AVAILABLE: "success" as const,
  REFERENCE_REQUIRED: "warning" as const,
  UNAVAILABLE: "neutral" as const,
  NOT_APPLICABLE: "neutral" as const,
  SOURCE_TEXT: "neutral" as const,
};

function ValuePill(
  {
    label,
    value,
  }: {
    label: string;
    value: RegulatoryValue;
  },
) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] bg-[var(--surface-raised)] px-2 py-1">
      <span className="text-xs text-[var(--text-tertiary)]">
        {label}
      </span>

      {value.status === "AVAILABLE" ? (
        <span className="font-mono text-xs tabular-nums text-[var(--text-primary)]">
          {value.value}
        </span>
      ) : (
        <Badge tone={VALUE_STATUS_TONE[value.status]}>
          {value.status.replace(/_/g, " ")}
        </Badge>
      )}
    </div>
  );
}

function DecimalPill(
  {
    label,
    value,
    unit,
  }: {
    label: string;
    value: string;
    unit: string;
  },
) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] bg-[var(--surface-raised)] px-2 py-1">
      <span className="text-xs text-[var(--text-tertiary)]">
        {label}
      </span>

      <span className="font-mono text-xs tabular-nums text-[var(--text-primary)]">
        {value} {unit}
      </span>
    </div>
  );
}

function TraceList(
  {
    trace,
  }: {
    trace: { step: string; outcome: string }[];
  },
) {
  if (trace.length === 0) {
    return null;
  }

  return (
    <ol className="mt-2 space-y-1 border-t border-[var(--border-default)] pt-2">
      {trace.map(
        (entry, index) => (
          <li
            key={`${entry.step}-${index}`}
            className="flex flex-col gap-0.5 font-mono text-[11px] leading-tight text-[var(--text-tertiary)]"
          >
            <span className="text-[var(--text-secondary)]">
              {entry.step}
            </span>

            <span>
              {entry.outcome}
            </span>
          </li>
        ),
      )}
    </ol>
  );
}

/**
 * The calculation-arithmetic half of the panel -- moved here verbatim
 * from calculation-cell.tsx's own CalculationTrace, minus the <details>
 * wrapper that component owned: this panel is itself the single
 * disclosure now (lines-table.tsx's toggle), so a step list nested
 * inside its own second-level <details> would just be a redundant,
 * confusing double-toggle. Iterates rather than assuming exactly one
 * step for the same reason CalculationTrace originally did -- see this
 * function's history in calculation-cell.tsx before P8.
 */
function CalculationStepsList(
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
    <div className="flex flex-col gap-2">
      {steps.map(
        (step, index) => (
          <div
            key={`${step.step}-${index}`}
            className="flex flex-col gap-1 rounded-[var(--radius-sm)] bg-[var(--surface-raised)] p-2"
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
  );
}

function PanelSection(
  {
    title,
    children,
  }: {
    title: string;
    children: React.ReactNode;
  },
) {
  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
        {title}
      </h4>

      {children}
    </div>
  );
}

/**
 * Section (e) of the unified panel -- reproduceCalculationResult
 * (src/application/calculations/reproduce-calculation-result.ts) is a
 * read-only recompute-and-compare, so its own useActionState is kept
 * local to this component rather than lifted the way resolveState is:
 * nothing outside this panel needs to know whether a reproducibility
 * check has run.
 */
function ReproducibilityCheck(
  {
    calculationResultId,
  }: {
    calculationResultId: string;
  },
) {
  const [
    state,
    formAction,
    pending,
  ] =
    useActionState(
      verifyCalculationReproducibilityAction,
      initialReproductionActionState,
    );

  const result =
    state.status === "checked" ? state.result : null;

  return (
    <div className="flex flex-col gap-2">
      <form action={formAction}>
        <input
          type="hidden"
          name="calculationResultId"
          value={calculationResultId}
        />

        <Button
          type="submit"
          variant="secondary"
          size="sm"
          loading={pending}
        >
          Verify reproducibility
        </Button>
      </form>

      {state.status === "error" ? (
        <p className="text-xs text-[var(--color-danger-700)]">
          {state.message}
        </p>
      ) : null}

      {result?.status === "REPRODUCIBLE" ? (
        <div className="rounded-[var(--radius-sm)] bg-[var(--color-success-100)] px-3 py-2 text-xs text-[var(--color-success-700)]">
          Reproducible -- recomputing this result from its stored inputs
          and recorded engine version produces an identical output.
        </div>
      ) : null}

      {result?.status === "ENGINE_VERSION_CHANGED" ? (
        <div className="rounded-[var(--radius-sm)] bg-[var(--surface-sunken)] px-3 py-2 text-xs text-[var(--text-secondary)]">
          The calculation engine has changed since this result was
          produced (stored as {result.storedEngineVersion}, running{" "}
          {result.currentEngineVersion} now) -- this is expected after an
          engine update, not an error, and a byte-equality check isn't
          meaningful across versions.
        </div>
      ) : null}

      {result?.status === "MISMATCH" ? (
        <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] bg-[var(--color-danger-100)] px-3 py-2 text-xs text-[var(--color-danger-700)]">
          <p className="font-medium">
            Mismatch -- recomputing this result from its stored inputs
            did not reproduce the stored output. This should never
            happen and needs investigation.
          </p>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <span className="font-semibold">
                Stored
              </span>

              <span className="font-mono tabular-nums">
                {result.stored.embedded_emissions_tco2e} tCO2e
              </span>

              <CalculationStepsList
                steps={result.stored.steps}
              />
            </div>

            <div className="flex flex-col gap-1">
              <span className="font-semibold">
                Recomputed
              </span>

              <span className="font-mono tabular-nums">
                {result.recomputed.embedded_emissions_tco2e} tCO2e
              </span>

              <CalculationStepsList
                steps={result.recomputed.steps}
              />
            </div>
          </div>
        </div>
      ) : null}

      {result?.status === "INPUTS_DRIFTED" ? (
        <div className="rounded-[var(--radius-sm)] bg-[var(--surface-sunken)] px-3 py-2 text-xs text-[var(--text-secondary)]">
          This line has been reclassified since this result was
          calculated -- recomputing it from the line&apos;s current
          classification no longer produces a value at all (engine
          status: {result.recomputedStatus}), so there is nothing to
          compare against the stored result. This is not a mismatch or
          an error: calculation results are never edited or deleted, so
          this one still reflects exactly what was calculated at the
          time, against the classification that was in effect then.
          Recalculate the line to get a result for its current
          classification.
        </div>
      ) : null}

      {result?.status === "NOT_FOUND" ? (
        <p className="text-xs text-[var(--color-danger-700)]">
          Something went wrong verifying this calculation. Please try
          again.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The single "Why this number?" affordance master plan §21/§25 calls
 * for -- previously split across two independent <details> disclosures
 * on the same row (the regulatory-resolution/actual-snapshot trace in
 * emissions-cell.tsx, the calculation-arithmetic trace in
 * calculation-cell.tsx), neither of which showed the
 * classification/origin/route context that only ever lived in the
 * table's own plain cells next to them. This panel walks the full chain
 * P8 requires in one place: quantity -> classification -> origin ->
 * route -> regulatory determination -> selected factor -> method ->
 * calculation -> result -> (e) an on-demand reproduction check.
 *
 * `resolveState` is lifted from lines-table.tsx's LineRow (not owned
 * here) because it is resolveEmissionsAction's own transient
 * useActionState result -- an UNRESOLVED outcome is never persisted
 * (resolve-line-emissions.ts never writes a line it couldn't
 * determine), so the reason/trace only exist for the render cycle right
 * after that action runs. EmissionsCell's compact badge/button stays
 * where it is and shares the same lifted state (see lines-table.tsx).
 */
export function WhyThisNumberPanel(
  {
    line,
    latestCalculation,
    resolveState,
  }: {
    line: ShipmentLine;
    latestCalculation: LatestLineCalculation | undefined;
    resolveState: ResolveEmissionsActionState;
  },
) {
  const determination =
    line.emission_determination;

  const resolution =
    determination?.method === "DEFAULT" ? determination.resolution : null;

  const actualSnapshot =
    determination?.method === "ACTUAL" ? determination.snapshot : null;

  const quantity =
    line.net_mass_tonnes
      ? `${line.net_mass_tonnes} t`
      : `${line.quantity_mwh} MWh`;

  return (
    <div className="flex flex-col gap-4 py-1">
      <PanelSection title="Line">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-[var(--text-tertiary)]">
              Quantity
            </dt>

            <dd className="font-mono tabular-nums text-[var(--text-primary)]">
              {quantity}
            </dd>
          </div>

          <div>
            <dt className="text-xs text-[var(--text-tertiary)]">
              {line.cn_code_level === "TARIC10" ? "TARIC code" : "CN code"}
            </dt>

            <dd className="font-mono tabular-nums text-[var(--text-primary)]">
              {line.cn_code}
            </dd>

            {line.goods_description ? (
              <dd className="text-xs text-[var(--text-tertiary)]">
                {line.goods_description}
              </dd>
            ) : null}
          </div>

          <div>
            <dt className="text-xs text-[var(--text-tertiary)]">
              Origin
            </dt>

            <dd className="tabular-nums text-[var(--text-primary)]">
              {line.origin_country}
            </dd>
          </div>

          <div>
            <dt className="text-xs text-[var(--text-tertiary)]">
              Production route
            </dt>

            <dd className="text-[var(--text-primary)]">
              {line.production_route?.name ?? "—"}
            </dd>
          </div>
        </dl>
      </PanelSection>

      <PanelSection title="Regulatory determination">
        {resolution ? (
          <div className="flex flex-col gap-1.5">
            <div className="grid grid-cols-3 gap-1.5">
              <ValuePill label="Direct" value={resolution.values.direct} />
              <ValuePill label="Indirect" value={resolution.values.indirect} />
              <ValuePill label="Total" value={resolution.values.total} />
            </div>

            <p className="text-[11px] text-[var(--text-tertiary)]">
              Dataset {resolution.dataset_version} · Unit {resolution.emission_unit} ·{" "}
              {resolution.country_mapping.status === "MAPPED"
                ? `Origin mapped to "${resolution.country_mapping.regulatory_country_name}"`
                : "Origin not individually listed -- Other Countries and Territories used"}
            </p>

            <TraceList trace={resolution.trace} />
          </div>
        ) : actualSnapshot ? (
          <div className="flex flex-col gap-1.5">
            <div className="grid grid-cols-2 gap-1.5">
              <DecimalPill
                label="Direct"
                value={actualSnapshot.values.direct_specific}
                unit={actualSnapshot.emission_unit}
              />

              <DecimalPill
                label="Indirect"
                value={actualSnapshot.values.indirect_specific}
                unit={actualSnapshot.emission_unit}
              />
            </div>

            <p className="text-[11px] text-[var(--text-tertiary)]">
              Methodology {actualSnapshot.methodology.replace(/_/g, " ")} ·{" "}
              {actualSnapshot.sharing_grant_id !== null
                ? "via a shared installation"
                : "from your organization's own data"}
            </p>
          </div>
        ) : (
          <p className="text-xs text-[var(--text-tertiary)]">
            Not yet determined.
          </p>
        )}

        {resolveState.status === "unresolved" ? (
          <div className="mt-2 rounded-[var(--radius-sm)] bg-[var(--color-danger-100)] px-3 py-2">
            <p className="text-xs font-medium text-[var(--color-danger-700)]">
              {resolveState.message}
            </p>

            <TraceList trace={resolveState.trace ?? []} />
          </div>
        ) : null}
      </PanelSection>

      <PanelSection title="Calculation">
        {latestCalculation ? (
          <CalculationStepsList steps={latestCalculation.steps} />
        ) : (
          <p className="text-xs text-[var(--text-tertiary)]">
            Not yet calculated.
          </p>
        )}
      </PanelSection>

      {latestCalculation ? (
        <PanelSection title="Result">
          <p className="font-mono text-lg font-semibold tabular-nums text-[var(--text-primary)]">
            {latestCalculation.embedded_emissions_tco2e} tCO2e
          </p>
        </PanelSection>
      ) : null}

      {latestCalculation ? (
        <PanelSection title="Reproducibility">
          <ReproducibilityCheck
            calculationResultId={latestCalculation.id}
          />
        </PanelSection>
      ) : null}
    </div>
  );
}

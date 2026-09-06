"use client";

import {
  useActionState,
} from "react";

import {
  StatusBadge,
} from "../../../../components/ui/status-badge";

import {
  valueStatusKey,
  calculationStatusKey,
  methodologyKey,
} from "../../../../src/domain/status-vocabulary";

import {
  reviewBadgeFor,
} from "../../../../src/domain/status-vocabulary/review-badges";

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

import {
  checkCalculationCurrency,
} from "../../../../src/domain/emissions/check-calculation-currency";

import type {
  DefaultReferenceDisplay,
} from "../../../../src/domain/emissions/default-reference";

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
        <StatusBadge statusKey={valueStatusKey(value.status)} />
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
          Check reproducibility
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
          status: <StatusBadge statusKey={calculationStatusKey(result.recomputedStatus)} />), so there is nothing to
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
          Something went wrong checking this calculation&apos;s
          reproducibility. Please try again.
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
    defaultReference,
    datasetSuperseded,
  }: {
    line: ShipmentLine;
    latestCalculation: LatestLineCalculation | undefined;
    resolveState: ResolveEmissionsActionState;
    /**
     * 2026-09-06 (S5 review remediation, finding A4). Whether this
     * line's CURRENT, DEFAULT-determined calculation is resolved
     * against a regulatory dataset that is no longer ACTIVE -- computed
     * server-side (the client never receives the active-dataset-id set
     * itself, matching this page's own "server decides, only the
     * resulting boolean is sent" convention for the actual-data picker
     * above). Meaningless, and always false, for an ACTUAL determination
     * or an undetermined line.
     */
    datasetSuperseded: boolean;
    /**
     * S3 (v2.1.1 §9), display only -- absent for a DEFAULT-determined
     * line (its own "Regulatory determination" section below already
     * shows these exact live figures, so a second reference would be
     * pure duplication); present for an ACTUAL-determined line, where
     * it is genuinely a different, clearly-labeled fact worth showing
     * for context. Never compared against actualSnapshot's own
     * figures -- there is no arithmetic here, only two facts shown
     * side by side.
     */
    defaultReference?: DefaultReferenceDisplay;
  },
) {
  const determination =
    line.emission_determination;

  const resolution =
    determination?.method === "DEFAULT" ? determination.resolution : null;

  const actualSnapshot =
    determination?.method === "ACTUAL" ? determination.snapshot : null;

  // 2026-09-07 (S5 review round 6, finding S5R6-NUM-B). Extracted to a
  // named boolean rather than an inline compound condition in the JSX
  // ternary below -- see this panel's own render for the crash this
  // guards against. (A side benefit: keeping a bare `.verification`
  // property access out of the gap between two JSX tags avoids a false
  // positive in tests/architecture/verification-prose-scan.test.ts's
  // own JSX-text-node regex, which cannot see that gap sits inside a
  // `{}` expression container.)
  const actualSnapshotIsComplete =
    actualSnapshot !== null &&
    actualSnapshot.values !== undefined &&
    actualSnapshot.verification !== undefined;

  const quantity =
    line.net_mass_tonnes
      ? `${line.net_mass_tonnes} t`
      : `${line.quantity_mwh} MWh`;

  // P13 adversarial audit: shipment_lines stays fully writable while its
  // parent shipment is READY, so this line's determination can have
  // changed (redetermined, or edited to null) since latestCalculation
  // was produced -- calculation_results is append-only and neither
  // redetermine path nor updateLine ever touches it. The same fact
  // record_declaration_filed() now refuses to file over, surfaced here
  // as early and as concretely as this panel already surfaces every
  // other input to the number it explains.
  const isStale =
    latestCalculation !== undefined &&
    checkCalculationCurrency(
      latestCalculation.determination,
      determination,
    ) === "STALE";

  /**
   * 2026-09-03 (owner decision D1). Was the Annex II direct-only
   * treatment applied to the figure shown here?
   *
   * Read from the FROZEN steps of the calculation being explained, not
   * re-derived from the line's current good. The panel's job is to
   * explain the number in front of the user, and re-deriving would let
   * it describe a treatment that was never applied to that number --
   * the same class of defect as explaining a stale figure with the
   * current determination.
   *
   * Without this the panel would show 18.5 where the producer reported
   * 1.850 direct AND 0.045 indirect, and nothing on the screen would
   * account for the difference. The step is in the trace either way;
   * this states it in words, at the result, where the question is
   * actually asked.
   */
  const annexIiStep =
    latestCalculation?.steps.find(
      (step) => step.step === "ANNEX_II_DIRECT_ONLY",
    );

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
              {resolution.reason === "OTHER_COUNTRIES_FALLBACK" &&
              resolution.country_mapping.status === "MAPPED"
                ? `Origin mapped to "${resolution.country_mapping.regulatory_country_name}", but that country's own record had no usable value -- Other Countries and Territories fallback used`
                : resolution.country_mapping.status === "MAPPED"
                ? `Origin mapped to "${resolution.country_mapping.regulatory_country_name}"`
                : "Origin not individually listed -- Other Countries and Territories used"}
            </p>

            <TraceList trace={resolution.trace} />

            {datasetSuperseded ? (
              <div className="mt-2 rounded-[var(--radius-sm)] bg-[var(--color-warning-100)] px-3 py-2 text-xs text-[var(--color-warning-700)]">
                Regulatory dataset since corrected -- the dataset this
                result was resolved against ({resolution.dataset_version})
                is no longer the active one. This result is still current
                for the determination shown above, but the filing gate
                will refuse a declaration that includes it unchanged.
                Redetermine this line against the current dataset.
              </div>
            ) : null}
          </div>
        ) : actualSnapshot && actualSnapshotIsComplete ? (
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

            <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]">
              Methodology <StatusBadge statusKey={methodologyKey(actualSnapshot.methodology)} /> ·{" "}
              {actualSnapshot.sharing_grant_id !== null
                ? "via a shared installation"
                : "from your organization's own data"}
              {/*
                * S3 trust panel (v2.1.1 SS8). This picker/determination
                * pipeline only ever offers ACTIVE + VERIFIED records
                * (listAvailableActualEmissionData's own query), so
                * verification.status is typed as literally "VERIFIED"
                * on this frozen snapshot -- matching
                * actual-data-preview.tsx's own identical comment. Still
                * goes through reviewBadgeFor rather than a hardcoded
                * "Verified" string so the label differs correctly by
                * provenance, and is gated on record_provenance being
                * present for the same reason the prose below it is:
                * absent on determinations frozen before that field
                * existed (owner decision D2), and reviewBadgeFor takes
                * no default for provenance.
                */}
              {actualSnapshot.record_provenance ? (
                <StatusBadge
                  statusKey={reviewBadgeFor(
                    actualSnapshot.verification.status,
                    actualSnapshot.record_provenance,
                  )}
                />
              ) : null}
            </p>

            {/*
              * 2026-09-03 (owner decision D2). Read from the FROZEN
              * snapshot, so it describes the number being explained
              * rather than the installation's state today.
              *
              * Absent on determinations frozen before D2 existed, which
              * is why nothing is rendered in that case -- saying
              * "operator provided" for a record whose provenance was
              * never captured would be a guess presented as a fact.
              */}
            {actualSnapshot.record_provenance === "IMPORTER_ENTERED" ? (
              <p className="text-[11px] text-[var(--text-tertiary)]">
                Source: external operator data, entered by your
                organization. Snowkap did not receive these figures from
                the operator directly and does not attest to them.
              </p>
            ) : actualSnapshot.record_provenance === "OPERATOR_PROVIDED" ? (
              <p className="text-[11px] text-[var(--text-tertiary)]">
                Source: entered by the organization that operates the
                installation.
              </p>
            ) : null}

            {/*
              * S3 (v2.1.1 §9), default reference display. DISPLAY
              * ONLY -- there is no arithmetic comparator here, and this
              * is never a second calculation of the number above: it is
              * a different, independently-labeled fact (what the
              * regulatory default would say for this same
              * classification/origin/route), shown for context and
              * nothing else. `defaultReference` is only ever fetched
              * for an ACTUAL-determined line (see the shipment detail
              * page's own doc comment on why) -- absent here would mean
              * a rendering bug upstream, not a real state to handle
              * silently, so this deliberately does not also guard on
              * actualSnapshot being present.
              */}
            {defaultReference ? (
              <div className="mt-1 flex flex-col gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2 py-1.5">
                <p className="text-[11px] font-medium text-[var(--text-primary)]">
                  Default reference (for context only)
                </p>

                {defaultReference.status === "AVAILABLE" ? (
                  <>
                    <div className="grid grid-cols-3 gap-1.5">
                      <ValuePill label="Direct" value={defaultReference.direct} />
                      <ValuePill label="Indirect" value={defaultReference.indirect} />
                      <ValuePill label="Total" value={defaultReference.total} />
                    </div>

                    <p className="text-[11px] text-[var(--text-tertiary)]">
                      What the regulatory default value would be for this
                      same classification, origin, and route. Shown for
                      context only -- it has no bearing on the actual-data
                      result above.
                    </p>
                  </>
                ) : (
                  <p className="text-[11px] text-[var(--text-tertiary)]">
                    Reference unavailable.
                  </p>
                )}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-[var(--text-tertiary)]">
            Not yet determined.
          </p>
        )}

        {resolveState.status === "unresolved" ? (
          <div
            role="alert"
            className="mt-2 rounded-[var(--radius-sm)] bg-[var(--color-danger-100)] px-3 py-2"
          >
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

          {annexIiStep ? (
            <div className="mt-2 flex flex-col gap-0.5 rounded-[var(--radius-sm)] bg-[var(--surface-sunken)] px-3 py-2">
              <p className="text-xs font-medium text-[var(--text-primary)]">
                Treatment: direct emissions only
              </p>

              <p className="text-xs text-[var(--text-secondary)]">
                This good is in a sector subject to the Annex II
                treatment, where only direct emissions are taken into
                account. The installation also reported{" "}
                {annexIiStep.inputs.indirect_specific_excluded} indirect
                emissions; that figure is kept on the record and was not
                added to this result.
              </p>
            </div>
          ) : null}

          {isStale ? (
            <div className="mt-2 rounded-[var(--radius-sm)] bg-[var(--color-warning-100)] px-3 py-2 text-xs text-[var(--color-warning-700)]">
              Stale -- this result was calculated against a determination
              this line no longer carries (it was re-determined, or
              edited, since this calculation ran). Recalculate to bring
              the result in line with the determination shown above.
            </div>
          ) : null}
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

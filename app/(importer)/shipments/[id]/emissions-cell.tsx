"use client";

import {
  useActionState,
  useState,
} from "react";

import {
  Badge,
} from "../../../../components/ui/badge";

import {
  ConfirmSubmitButton,
} from "../../../../components/ui/confirm-submit-button";

import {
  Button,
} from "../../../../components/ui/button";

import {
  determineFromActualDataAction,
} from "./actions";

import {
  initialLineActionState,
} from "./action-state";

import {
  formatReportingPeriod,
} from "../../../../src/domain/shared/reporting-period";

import type {
  ShipmentLine,
} from "../../../../src/domain/shipments/types";

import type {
  ActualEmissionDataOptionForLine,
} from "../../../../src/application/emissions/mark-actual-options-for-line";

import {
  ActualDataPreview,
} from "./actual-data-preview";

import type {
  ActualSnapshotStaleness,
} from "../../../../src/domain/emissions/check-actual-snapshot-staleness";

import type {
  ResolveEmissionsActionState,
} from "./resolve-emissions-action-state";

const REASON_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  EXACT_TARIC_MATCH: "success",
  EXACT_CN8_MATCH: "success",
  EXACT_HS6_MATCH: "success",
  EXACT_HS4_MATCH: "success",
  OTHER_COUNTRIES_FALLBACK: "warning",
  REFERENCE_REQUIRED: "warning",
  UNAVAILABLE: "neutral",
  NOT_APPLICABLE: "neutral",
  AMBIGUOUS: "danger",
  NO_MATCH: "danger",
};

/**
 * The DEFAULT-path button was previously labeled generic "Determine"/
 * "Re-determine" regardless of the line's CURRENT determination method
 * -- so a line already carrying a verified ACTUAL determination showed
 * "Re-determine" on a button that, if clicked, silently replaces it
 * with a DEFAULT (regulatory-resolution) value, with no label
 * disclosing that a method switch -- not a refresh of the same kind of
 * determination -- is about to happen (found in P7's mandatory
 * review). The audit trail already records this correctly (S4: every
 * redetermine records what the determination changed FROM), but the
 * button itself gave no warning before the click. This function makes
 * the label honest about which method it resolves via and, when it
 * would replace an ACTUAL determination specifically, says so plainly.
 */
function defaultResolutionButtonLabel(
  determination: ShipmentLine["emission_determination"],
): string {
  if (!determination) {
    return "Resolve default value";
  }

  if (determination.method === "ACTUAL") {
    return "Replace with default value";
  }

  return "Re-resolve default value";
}

/**
 * A SHARED option's grantor org name (listAvailableActualEmissionData's
 * grantor_organization_name) is folded into the label itself rather than
 * a bare "(shared)" suffix, so the picker identifies WHICH other org's
 * data this is without needing a separate lookup UI.
 */
function formatActualDataOptionLabel(
  option: ActualEmissionDataOptionForLine,
): string {
  // 2026-08-31 (P13 Bucket C/D sweep): the dataset's own REPORTING PERIOD
  // is now part of the label.
  //
  // Every option already carried `reporting_period`; the label simply
  // never showed it. So the picker listed a 2024 dataset and a 2026
  // dataset as visually indistinguishable rows, and an importer choosing
  // actual emissions for a 2026 shipment had no way to see which period
  // the figures they were about to declare actually came from.
  //
  // Deliberately DISPLAY-ONLY. Whether a dataset whose period differs
  // from the shipment's may legitimately be used is a regulatory
  // question, and no rule in docs/regulatory/CALCULATION_RULE_REGISTER.md
  // answers it -- so filtering these options out, or rejecting the
  // determination, would be inventing a regulatory rule, which CLAUDE.md
  // forbids. Showing the period lets the human apply the judgement;
  // making that judgement here would not be ours to make. The open
  // question is recorded in the release report rather than silently
  // decided either way.
  const base =
    `${option.installation_name} (${option.installation_country}) — ${formatReportingPeriod(option.reporting_period)} — ${option.direct_specific} ${option.emission_unit} direct`;

  return option.provenance === "SHARED"
    ? `${base} (shared by ${option.grantor_organization_name})`
    : base;
}

/**
 * `resolveState`/`resolveFormAction`/`resolvePending` are lifted from
 * this component into lines-table.tsx's LineRow (P8) rather than owned
 * here via a local useActionState call, the way this component did
 * through P7 -- an UNRESOLVED outcome carries a reason/trace that
 * why-this-number-panel.tsx now also needs to render (its own "do not
 * drop that error path" requirement), and two independent
 * useActionState calls against the same resolveEmissionsAction would
 * mean submitting the form only updates whichever component's own hook
 * instance the form element belongs to -- not both. One hook, one
 * source of truth, shared by both this cell's compact badge/button and
 * the panel's fuller unresolved-state rendering.
 */
export function EmissionsCell(
  {
    shipmentId,
    line,
    editable,
    availableActualData,
    staleness,
    resolveState: state,
    resolveFormAction: formAction,
    resolvePending: pending,
  }: {
    shipmentId: string;
    line: ShipmentLine;
    editable: boolean;
    availableActualData: ActualEmissionDataOptionForLine[];
    staleness: ActualSnapshotStaleness | undefined;
    resolveState: ResolveEmissionsActionState;
    resolveFormAction: (formData: FormData) => void;
    resolvePending: boolean;
  },
) {
  const [
    actualDataState,
    actualDataFormAction,
    actualDataPending,
  ] =
    useActionState(
      determineFromActualDataAction,
      initialLineActionState,
    );

  // Controlled, so the preview below and the state of the action button
  // both follow the selection. Empty means nothing has been chosen and
  // the action is not offered at all -- there is no default dataset,
  // because there is no dataset it would be safe to pick on the user's
  // behalf.
  const [selectedEmissionDataId, setSelectedEmissionDataId] =
    useState<string>("");

  const selectedOption =
    availableActualData.find(
      (option) =>
        option.emission_data_id === selectedEmissionDataId,
    ) ?? null;

  // Decided on the SERVER (markActualOptionsForLine), never by comparing
  // ids here: the comparison covers the record's evidence set, its
  // verifier and the grant it is read through, none of which reach the
  // client. A client-side id comparison would disagree with the server
  // in exactly the cases that matter.
  const selectionChangesNothing =
    selectedOption?.matches_current_determination === true;

  const determination =
    line.emission_determination;

  const resolution =
    determination?.method === "DEFAULT" ? determination.resolution : null;

  const actualSnapshot =
    determination?.method === "ACTUAL" ? determination.snapshot : null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        {resolution ? (
          <Badge tone={REASON_TONE[resolution.reason] ?? "neutral"}>
            {resolution.reason.replace(/_/g, " ")}
          </Badge>
        ) : actualSnapshot ? (
          <Badge tone="success">
            Actual data
          </Badge>
        ) : (
          <Badge tone="neutral">
            Not determined
          </Badge>
        )}

        {actualSnapshot && staleness === "STALE" ? (
          <Badge tone="warning">
            Stale — newer data available
          </Badge>
        ) : null}

        {editable ? (
          <form action={formAction}>
            <input
              type="hidden"
              name="lineId"
              value={line.id}
            />

            <input
              type="hidden"
              name="shipmentId"
              value={shipmentId}
            />

            {determination?.method === "ACTUAL" ? (
              // Only this direction is confirmed. Resolving or
              // re-resolving a default value is a repeatable, reversible
              // step; REPLACING verified actual data with a default is a
              // change of regulatory basis, and the audit trail records
              // it as a redetermination with what it replaced.
              <ConfirmSubmitButton
                variant="ghost"
                size="sm"
                pending={pending}
                confirm={
                  {
                    title: "Replace actual data with a default value?",
                    description:
                      "This line's verified actual-data determination is replaced by the regulatory default value for its CN code and origin. Its current calculation becomes stale until you recalculate, and the change is recorded in the audit trail together with the determination it replaced.",
                    confirmLabel: "Replace with default value",
                    cancelLabel: "Keep actual data",
                    variant: "destructive",
                  }
                }
              >
                {defaultResolutionButtonLabel(
                  determination,
                )}
              </ConfirmSubmitButton>
            ) : (
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                loading={pending}
              >
                {defaultResolutionButtonLabel(
                  determination,
                )}
              </Button>
            )}
          </form>
        ) : null}
      </div>

      {editable && availableActualData.length > 0 ? (
        <form
          action={actualDataFormAction}
          className="flex flex-col items-start gap-1.5"
        >
          <input
            type="hidden"
            name="lineId"
            value={line.id}
          />

          <input
            type="hidden"
            name="shipmentId"
            value={shipmentId}
          />

          <select
            name="emissionDataId"
            required
            aria-label="Choose a verified dataset"
            value={selectedEmissionDataId}
            onChange={(event) =>
              setSelectedEmissionDataId(event.target.value)
            }
            className="h-8 max-w-full rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2 text-xs text-[var(--text-primary)]"
          >
            <option value="">
              Choose a verified dataset...
            </option>

            {availableActualData.map(
              (option) => (
                <option
                  key={option.emission_data_id}
                  value={option.emission_data_id}
                >
                  {formatActualDataOptionLabel(option)}
                </option>
              ),
            )}
          </select>

          {selectedOption ? (
            <ActualDataPreview
              option={selectedOption}
              declaredOriginCountry={line.origin_country}
            />
          ) : null}

          {selectionChangesNothing ? (
            <p className="text-xs text-[var(--text-secondary)]">
              This line is already determined from that exact dataset.
              Choosing it again would change nothing.
            </p>
          ) : null}

          {actualSnapshot && !selectionChangesNothing ? (
            // Replacing an existing determination is a change of the
            // regulatory basis of a figure that may already have been
            // calculated, so it asks first and says what it replaces.
            // A FIRST determination is not confirmed: there is nothing
            // to lose, the preview above already shows exactly what will
            // be frozen, and a dialog on every first use would train
            // people to dismiss the one that matters.
            <ConfirmSubmitButton
              variant="primary"
              size="sm"
              pending={actualDataPending}
              disabled={selectedOption === null}
              confirm={
                {
                  title: "Replace this line's emission determination?",
                  description:
                    "This line currently carries a verified actual-data determination. Replacing it freezes a new snapshot of the dataset you selected. The line's calculation becomes stale until you recalculate, and the change is recorded in the audit trail together with the determination it replaced.",
                  children:
                    selectedOption ? (
                      <ActualDataPreview
                        option={selectedOption}
                        declaredOriginCountry={line.origin_country}
                      />
                    ) : undefined,
                  confirmLabel: "Replace determination",
                  cancelLabel: "Keep current determination",
                }
              }
            >
              Determine from actual data
            </ConfirmSubmitButton>
          ) : (
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={actualDataPending}
              disabled={selectedOption === null || selectionChangesNothing}
            >
              Determine from actual data
            </Button>
          )}
        </form>
      ) : null}

      {actualDataState.status === "unchanged" ? (
        // Neutral, not danger: nothing went wrong and nothing was
        // damaged. The line already says what the user was asking it to
        // say.
        <p className="text-xs text-[var(--text-secondary)]">
          {actualDataState.message}
        </p>
      ) : null}

      {actualDataState.status === "error" ? (
        <p className="text-xs text-[var(--color-danger-700)]">
          {actualDataState.message}
        </p>
      ) : null}

      {actualDataState.status === "idle" && actualDataState.warning ? (
        <p className="text-xs text-[var(--color-warning-700)]">
          {actualDataState.warning}
        </p>
      ) : null}

      {state.status === "error" ? (
        <p className="text-xs text-[var(--color-danger-700)]">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

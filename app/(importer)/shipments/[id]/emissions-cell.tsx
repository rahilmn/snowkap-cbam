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
  AvailableActualEmissionDataOption,
} from "../../../../src/application/emissions/list-available-actual-data";

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
  option: AvailableActualEmissionDataOption,
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
    availableActualData: AvailableActualEmissionDataOption[];
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
          </form>
        ) : null}
      </div>

      {editable && availableActualData.length > 0 ? (
        <form
          action={actualDataFormAction}
          className="flex items-center gap-1.5"
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
            defaultValue=""
            className="h-8 rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2 text-xs text-[var(--text-primary)]"
          >
            <option
              value=""
              disabled
            >
              Use actual data…
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

          <Button
            type="submit"
            variant="ghost"
            size="sm"
            loading={actualDataPending}
          >
            Use this data
          </Button>
        </form>
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

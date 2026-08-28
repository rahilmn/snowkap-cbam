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
  resolveEmissionsAction,
  determineFromActualDataAction,
} from "./actions";

import {
  initialResolveEmissionsActionState,
} from "./resolve-emissions-action-state";

import {
  initialLineActionState,
} from "./action-state";

import type {
  ShipmentLine,
} from "../../../../src/domain/shipments/types";

import type {
  RegulatoryValue,
} from "../../../../src/domain/regulatory/types";

import type {
  AvailableActualEmissionDataOption,
} from "../../../../src/application/emissions/list-available-actual-data";

const VALUE_STATUS_TONE = {
  AVAILABLE: "success" as const,
  REFERENCE_REQUIRED: "warning" as const,
  UNAVAILABLE: "neutral" as const,
  NOT_APPLICABLE: "neutral" as const,
  SOURCE_TEXT: "neutral" as const,
};

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
    <div className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] bg-[var(--surface-sunken)] px-2 py-1">
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
    <div className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] bg-[var(--surface-sunken)] px-2 py-1">
      <span className="text-xs text-[var(--text-tertiary)]">
        {label}
      </span>

      <span className="font-mono text-xs tabular-nums text-[var(--text-primary)]">
        {value} {unit}
      </span>
    </div>
  );
}

/**
 * Deliberately does NOT resolve/display the grantor org's name for a
 * SHARED option -- see listAvailableActualEmissionData's own doc
 * comment (list-available-actual-data.ts) for why that's out of scope
 * for this increment; the "(shared)" suffix is all the provenance
 * signal this picker gives today.
 */
function formatActualDataOptionLabel(
  option: AvailableActualEmissionDataOption,
): string {
  const base =
    `${option.installation_name} (${option.installation_country}) — ${option.direct_specific} ${option.emission_unit} direct`;

  return option.provenance === "SHARED" ? `${base} (shared)` : base;
}

export function EmissionsCell(
  {
    shipmentId,
    line,
    editable,
    availableActualData,
  }: {
    shipmentId: string;
    line: ShipmentLine;
    editable: boolean;
    availableActualData: AvailableActualEmissionDataOption[];
  },
) {
  const [
    state,
    formAction,
    pending,
  ] =
    useActionState(
      resolveEmissionsAction,
      initialResolveEmissionsActionState,
    );

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
              {determination ? "Re-determine" : "Determine"}
            </Button>
          </form>
        ) : null}
      </div>

      {resolution ? (
        <details className="group">
          <summary className="cursor-pointer text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">
            Why this number?
          </summary>

          <div className="mt-2 flex flex-col gap-1.5">
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
        </details>
      ) : null}

      {actualSnapshot ? (
        <details className="group">
          <summary className="cursor-pointer text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">
            Why this number?
          </summary>

          <div className="mt-2 flex flex-col gap-1.5">
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
        </details>
      ) : null}

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

      {state.status === "unresolved" ? (
        <details
          className="group"
          open
        >
          <summary className="cursor-pointer text-xs text-[var(--color-danger-700)]">
            {state.message}
          </summary>

          <TraceList trace={state.trace ?? []} />
        </details>
      ) : null}

      {state.status === "error" ? (
        <p className="text-xs text-[var(--color-danger-700)]">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

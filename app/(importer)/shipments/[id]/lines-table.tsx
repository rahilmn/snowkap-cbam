"use client";

import {
  useActionState,
  useState,
} from "react";

import {
  ChevronDown,
  ChevronRight,
  Trash2,
} from "lucide-react";

import {
  Button,
} from "../../../../components/ui/button";

import {
  removeLineAction,
  resolveEmissionsAction,
} from "./actions";

import {
  initialLineActionState,
} from "./action-state";

import {
  initialResolveEmissionsActionState,
} from "./resolve-emissions-action-state";

import {
  EmissionsCell,
} from "./emissions-cell";

import {
  CalculationCell,
} from "./calculation-cell";

import {
  WhyThisNumberPanel,
} from "./why-this-number-panel";

import type {
  ShipmentLine,
} from "../../../../src/domain/shipments/types";

import type {
  LatestLineCalculation,
} from "../../../../src/application/calculations/get-latest-calculations";

import type {
  AvailableActualEmissionDataOption,
} from "../../../../src/application/emissions/list-available-actual-data";

import type {
  ActualSnapshotStaleness,
} from "../../../../src/domain/emissions/check-actual-snapshot-staleness";

// 7 base columns (#, CN/TARIC code, Origin, Quantity, Route, Emissions,
// Calculated) plus the trailing actions column that only exists when
// editable -- the "Why this number?" panel row (below) spans every
// column in the header, so this must track the header's own column
// count exactly or the panel's border/background would misalign with
// the table beneath it.
const BASE_COLUMN_COUNT = 7;

export function LinesTable(
  {
    shipmentId,
    lines,
    editable,
    latestCalculations,
    availableActualDataByLineId,
    actualDeterminationStaleness,
  }: {
    shipmentId: string;
    lines: ShipmentLine[];
    editable: boolean;
    latestCalculations: Record<string, LatestLineCalculation>;
    availableActualDataByLineId: Record<string, AvailableActualEmissionDataOption[]>;
    actualDeterminationStaleness: Record<string, ActualSnapshotStaleness>;
  },
) {
  if (lines.length === 0) {
    return (
      <p className="p-6 text-sm text-[var(--text-secondary)]">
        No lines yet. Add a line below to declare a good on this
        shipment.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--border-default)] text-[var(--text-tertiary)]">
            <th className="px-4 py-2.5 font-medium">
              #
            </th>

            <th className="px-4 py-2.5 font-medium">
              CN / TARIC code
            </th>

            <th className="px-4 py-2.5 font-medium">
              Origin
            </th>

            <th className="px-4 py-2.5 font-medium">
              Quantity
            </th>

            <th className="px-4 py-2.5 font-medium">
              Route
            </th>

            <th className="px-4 py-2.5 font-medium">
              Emissions
            </th>

            <th className="px-4 py-2.5 font-medium">
              Calculated
            </th>

            {editable ? (
              <th className="px-4 py-2.5" />
            ) : null}
          </tr>
        </thead>

        <tbody className="divide-y divide-[var(--border-default)]">
          {lines.map(
            (line) => (
              <LineRow
                key={line.id}
                shipmentId={shipmentId}
                line={line}
                editable={editable}
                latestCalculation={latestCalculations[line.id]}
                availableActualData={availableActualDataByLineId[line.id] ?? []}
                staleness={actualDeterminationStaleness[line.id]}
              />
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

function LineRow(
  {
    shipmentId,
    line,
    editable,
    latestCalculation,
    availableActualData,
    staleness,
  }: {
    shipmentId: string;
    line: ShipmentLine;
    editable: boolean;
    latestCalculation: LatestLineCalculation | undefined;
    availableActualData: AvailableActualEmissionDataOption[];
    staleness: ActualSnapshotStaleness | undefined;
  },
) {
  const [
    state,
    formAction,
    pending,
  ] =
    useActionState(
      removeLineAction,
      initialLineActionState,
    );

  // Lifted out of EmissionsCell (see that component's own doc comment)
  // so both it and the "Why this number?" panel below can render off
  // the same resolveEmissionsAction result -- in particular an
  // UNRESOLVED outcome, which the panel must surface even if the user
  // never manually opened it (see panelOpen below).
  const [
    resolveState,
    resolveFormAction,
    resolvePending,
  ] =
    useActionState(
      resolveEmissionsAction,
      initialResolveEmissionsActionState,
    );

  const [
    panelOpen,
    setPanelOpen,
  ] =
    useState(
      false,
    );

  // An UNRESOLVED resolution attempt force-shows the panel even without
  // a manual toggle -- the same "surfaces immediately, no extra click"
  // behavior the old EmissionsCell's own force-`open` <details>
  // guaranteed for this exact case (see why-this-number-panel.tsx's own
  // doc comment on why this state can't just live in EmissionsCell
  // alone). Derived per render rather than synced via an effect: it's a
  // plain OR of two booleans, not state that needs to persist once the
  // user manually collapses the panel on a *different* render.
  const showPanel =
    panelOpen || resolveState.status === "unresolved";

  const columnCount =
    editable ? BASE_COLUMN_COUNT + 1 : BASE_COLUMN_COUNT;

  const quantity =
    line.net_mass_tonnes
      ? `${line.net_mass_tonnes} t`
      : `${line.quantity_mwh} MWh`;

  return (
    <>
      <tr>
        <td className="px-4 py-2.5 tabular-nums text-[var(--text-secondary)]">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPanelOpen((open) => !open)}
              aria-expanded={showPanel}
              aria-label={`Why this number? Line ${line.line_number}`}
              title="Why this number?"
              className="flex size-5 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-tertiary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-secondary)]"
            >
              {showPanel ? (
                <ChevronDown
                  className="size-3.5"
                  aria-hidden="true"
                />
              ) : (
                <ChevronRight
                  className="size-3.5"
                  aria-hidden="true"
                />
              )}
            </button>

            {line.line_number}
          </div>
        </td>

        <td className="px-4 py-2.5">
          <span className="font-medium tabular-nums text-[var(--text-primary)]">
            {line.cn_code}
          </span>

          {line.goods_description ? (
            <span className="block text-xs text-[var(--text-tertiary)]">
              {line.goods_description}
            </span>
          ) : null}
        </td>

        <td className="px-4 py-2.5 tabular-nums text-[var(--text-secondary)]">
          {line.origin_country}
        </td>

        <td className="px-4 py-2.5 tabular-nums text-[var(--text-secondary)]">
          {quantity}
        </td>

        <td className="px-4 py-2.5 text-[var(--text-secondary)]">
          {line.production_route?.name ?? "—"}
        </td>

        <td className="px-4 py-2.5">
          <EmissionsCell
            shipmentId={shipmentId}
            line={line}
            editable={editable}
            availableActualData={availableActualData}
            staleness={staleness}
            resolveState={resolveState}
            resolveFormAction={resolveFormAction}
            resolvePending={resolvePending}
          />
        </td>

        <td className="px-4 py-2.5">
          <CalculationCell
            shipmentId={shipmentId}
            lineId={line.id}
            editable={editable}
            latestCalculation={latestCalculation}
            currentDetermination={line.emission_determination}
          />
        </td>

        {editable ? (
          <td className="px-4 py-2.5">
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
                aria-label={`Remove line ${line.line_number}`}
                title={`Remove line ${line.line_number}`}
              >
                <Trash2
                  className="size-4"
                  aria-hidden="true"
                />
              </Button>
            </form>

            {state.status === "error" ? (
              <p className="mt-1 text-xs text-[var(--color-danger-700)]">
                {state.message}
              </p>
            ) : null}
          </td>
        ) : null}
      </tr>

      {showPanel ? (
        <tr>
          <td
            colSpan={columnCount}
            className="border-b border-[var(--border-default)] bg-[var(--surface-sunken)] px-4 py-3"
          >
            <WhyThisNumberPanel
              line={line}
              latestCalculation={latestCalculation}
              resolveState={resolveState}
            />
          </td>
        </tr>
      ) : null}
    </>
  );
}

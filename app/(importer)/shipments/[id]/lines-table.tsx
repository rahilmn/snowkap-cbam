"use client";

import {
  useActionState,
} from "react";

import {
  Trash2,
} from "lucide-react";

import {
  Badge,
} from "../../../../components/ui/badge";

import {
  Button,
} from "../../../../components/ui/button";

import {
  removeLineAction,
} from "./actions";

import {
  initialLineActionState,
} from "./action-state";

import type {
  ShipmentLine,
} from "../../../../src/domain/shipments/types";

export function LinesTable(
  {
    shipmentId,
    lines,
    editable,
  }: {
    shipmentId: string;
    lines: ShipmentLine[];
    editable: boolean;
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
  }: {
    shipmentId: string;
    line: ShipmentLine;
    editable: boolean;
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

  const quantity =
    line.net_mass_tonnes
      ? `${line.net_mass_tonnes} t`
      : `${line.quantity_mwh} MWh`;

  return (
    <tr>
      <td className="px-4 py-2.5 tabular-nums text-[var(--text-secondary)]">
        {line.line_number}
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
        {line.emission_determination ? (
          <Badge tone="success">
            Determined
          </Badge>
        ) : (
          <Badge tone="warning">
            Not determined
          </Badge>
        )}
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
  );
}

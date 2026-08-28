"use client";

import {
  useActionState,
} from "react";

import {
  Trash2,
} from "lucide-react";

import {
  Button,
} from "../../../components/ui/button";

import {
  Badge,
} from "../../../components/ui/badge";

import {
  removeOperatorAction,
} from "./actions";

import {
  initialInstallationsScreenActionState,
} from "./action-state";

export interface OperatorRow {
  id: string;
  name: string;
  country: string;
  contactEmail: string | null;
  provenance: "OPERATOR_PROVIDED" | "IMPORTER_ENTERED";
}

export function OperatorList(
  {
    operators,
  }: {
    operators: OperatorRow[];
  },
) {
  if (operators.length === 0) {
    return (
      <p className="p-4 text-sm text-[var(--text-secondary)]">
        No operators yet. Add one above to register an installation.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-[var(--border-default)]">
      {operators.map(
        (operator) => (
          <OperatorListItem
            key={operator.id}
            operator={operator}
          />
        ),
      )}
    </ul>
  );
}

function OperatorListItem(
  {
    operator,
  }: {
    operator: OperatorRow;
  },
) {
  const [
    state,
    formAction,
    pending,
  ] =
    useActionState(
      removeOperatorAction,
      initialInstallationsScreenActionState,
    );

  return (
    <li className="flex flex-col gap-1 p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--text-primary)]">
              {operator.name}
            </span>

            {operator.provenance === "IMPORTER_ENTERED" ? (
              <Badge tone="neutral">
                Importer-entered
              </Badge>
            ) : null}
          </div>

          <span className="text-xs text-[var(--text-secondary)]">
            {[operator.country, operator.contactEmail]
              .filter(Boolean)
              .join(" · ") || "No additional details"}
          </span>
        </div>

        <form action={formAction}>
          <input
            type="hidden"
            name="operatorId"
            value={operator.id}
          />

          <Button
            type="submit"
            variant="ghost"
            size="sm"
            loading={pending}
            aria-label={`Remove ${operator.name}`}
            title={`Remove ${operator.name}`}
          >
            <Trash2
              className="size-4"
              aria-hidden="true"
            />
          </Button>
        </form>
      </div>

      {state.status === "error" ? (
        <p className="text-xs text-[var(--color-danger-700)]">
          {state.message}
        </p>
      ) : null}
    </li>
  );
}

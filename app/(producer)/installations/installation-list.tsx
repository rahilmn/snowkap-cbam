"use client";

import {
  useActionState,
} from "react";

import {
  Trash2,
} from "lucide-react";

import {
  ConfirmSubmitButton,
} from "../../../components/ui/confirm-submit-button";

import {
  Button,
} from "../../../components/ui/button";

import {
  Badge,
} from "../../../components/ui/badge";

import {
  removeInstallationAction,
} from "./actions";

import {
  initialInstallationsScreenActionState,
} from "./action-state";

export interface InstallationRow {
  id: string;
  operatorName: string;
  name: string;
  country: string;
  unLocode: string | null;
  address: string | null;
  provenance: "OPERATOR_PROVIDED" | "IMPORTER_ENTERED";
}

export function InstallationList(
  {
    installations,
  }: {
    installations: InstallationRow[];
  },
) {
  if (installations.length === 0) {
    return (
      <p className="p-4 text-sm text-[var(--text-secondary)]">
        No installations yet.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-[var(--border-default)]">
      {installations.map(
        (installation) => (
          <InstallationListItem
            key={installation.id}
            installation={installation}
          />
        ),
      )}
    </ul>
  );
}

function InstallationListItem(
  {
    installation,
  }: {
    installation: InstallationRow;
  },
) {
  const [
    state,
    formAction,
    pending,
  ] =
    useActionState(
      removeInstallationAction,
      initialInstallationsScreenActionState,
    );

  return (
    <li className="flex flex-col gap-1 p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--text-primary)]">
              {installation.name}
            </span>

            {installation.provenance === "IMPORTER_ENTERED" ? (
              <Badge tone="neutral">
                Importer-entered
              </Badge>
            ) : null}
          </div>

          <span className="text-xs text-[var(--text-secondary)]">
            {[installation.operatorName, installation.country, installation.unLocode, installation.address]
              .filter(Boolean)
              .join(" · ") || "No additional details"}
          </span>
        </div>

        <form action={formAction}>
          <input
            type="hidden"
            name="installationId"
            value={installation.id}
          />

          <ConfirmSubmitButton
            variant="ghost"
            size="sm"
            pending={pending}
            aria-label={`Remove ${installation.name}`}
            title={`Remove ${installation.name}`}
            confirm={
              {
                title: `Remove ${installation.name}?`,

                // Deliberately not "everything it owns goes with it":
                // the foreign keys are ON DELETE RESTRICT, so removal is
                // REFUSED while emission data or sharing grants still
                // reference it. Promising a cascade that cannot happen
                // would be a worse dialog than none at all.
                description:
                  "This cannot be undone. If emission data or sharing grants still reference this installation, the removal will be refused and nothing will change.",
                confirmLabel: "Remove installation",
                variant: "destructive",
              }
            }
          >
            <Trash2
              className="size-4"
              aria-hidden="true"
            />
          </ConfirmSubmitButton>
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

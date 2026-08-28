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

          <Button
            type="submit"
            variant="ghost"
            size="sm"
            loading={pending}
            aria-label={`Remove ${installation.name}`}
            title={`Remove ${installation.name}`}
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

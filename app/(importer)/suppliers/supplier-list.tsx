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
  removeSupplierAction,
} from "./actions";

import {
  initialSupplierActionState,
} from "./action-state";

export interface SupplierRow {
  id: string;
  name: string;
  country: string | null;
  contactEmail: string | null;
}

export function SupplierList(
  {
    suppliers,
  }: {
    suppliers: SupplierRow[];
  },
) {
  if (suppliers.length === 0) {
    return (
      <p className="p-4 text-sm text-[var(--text-secondary)]">
        No suppliers yet.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-[var(--border-default)]">
      {suppliers.map(
        (supplier) => (
          <SupplierListItem
            key={supplier.id}
            supplier={supplier}
          />
        ),
      )}
    </ul>
  );
}

function SupplierListItem(
  {
    supplier,
  }: {
    supplier: SupplierRow;
  },
) {
  const [
    state,
    formAction,
    pending,
  ] =
    useActionState(
      removeSupplierAction,
      initialSupplierActionState,
    );

  return (
    <li className="flex flex-col gap-1 p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-sm font-medium text-[var(--text-primary)]">
            {supplier.name}
          </span>

          <span className="text-xs text-[var(--text-secondary)]">
            {[supplier.country, supplier.contactEmail]
              .filter(Boolean)
              .join(" · ") || "No additional details"}
          </span>
        </div>

        <form action={formAction}>
          <input
            type="hidden"
            name="supplierId"
            value={supplier.id}
          />

          <ConfirmSubmitButton
            variant="ghost"
            size="sm"
            pending={pending}
            aria-label={`Remove ${supplier.name}`}
            title={`Remove ${supplier.name}`}
            confirm={
              {
                title: `Remove ${supplier.name}?`,
                description:
                  "This supplier is removed from your registry. This cannot be undone.",
                confirmLabel: "Remove supplier",
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

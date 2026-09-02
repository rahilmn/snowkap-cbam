"use client";

import {
  useActionState,
} from "react";

import {
  Factory,
} from "lucide-react";

import {
  Button,
} from "../../../components/ui/button";

import {
  Input,
} from "../../../components/ui/input";

import {
  Label,
} from "../../../components/ui/label";

import {
  FieldError,
} from "../../../components/ui/field-error";

import {
  createInstallationAction,
} from "./actions";

import {
  initialInstallationsScreenActionState,
} from "./action-state";

export interface OperatorOption {
  id: string;
  name: string;
}

/**
 * 2026-09-03 (owner decision D2). The submit action is injectable.
 *
 * This form is reused verbatim by the importer's external-operator
 * registry, which records the SAME shape of record with a different
 * provenance -- IMPORTER_ENTERED rather than OPERATOR_PROVIDED.
 * Duplicating the form to change one call would have created exactly
 * the second parallel model D2 said not to build, and the two copies
 * would have drifted the first time a field was added.
 *
 * Defaulted so every existing producer-side call site is unchanged.
 */
export function InstallationForm(
  {
    operators,
    action = createInstallationAction,
  }: {
    operators: OperatorOption[];
    action?: typeof createInstallationAction;
  },
) {
  const [
    state,
    formAction,
    pending,
  ] =
    useActionState(
      action,
      initialInstallationsScreenActionState,
    );

  if (operators.length === 0) {
    return (
      <p className="p-4 text-sm text-[var(--text-secondary)]">
        Add an operator first, then register its installation here.
      </p>
    );
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 border-b border-[var(--border-default)] p-4"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="installation-operatorId">
            Operator
          </Label>

          <select
            id="installation-operatorId"
            name="operatorId"
            required
            disabled={pending}
            defaultValue=""
            className="h-10 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-page)] px-2.5 text-sm text-[var(--text-primary)] disabled:opacity-50"
          >
            <option value="" disabled>
              Choose operator
            </option>

            {operators.map(
              (operator) => (
                <option
                  key={operator.id}
                  value={operator.id}
                >
                  {operator.name}
                </option>
              ),
            )}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="installation-name">
            Name
          </Label>

          <Input
            id="installation-name"
            name="name"
            required
            disabled={pending}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="installation-country">
            Country
          </Label>

          <Input
            id="installation-country"
            name="country"
            maxLength={2}
            required
            placeholder="ISO code"
            disabled={pending}
            className="uppercase"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="installation-unLocode">
            UN/LOCODE
          </Label>

          <Input
            id="installation-unLocode"
            name="unLocode"
            maxLength={5}
            placeholder="e.g. DEHAM"
            disabled={pending}
            className="uppercase"
          />
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="installation-address">
            Address
          </Label>

          <Input
            id="installation-address"
            name="address"
            disabled={pending}
          />
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="installation-cbamInstallationId">
            CBAM registry ID (if known)
          </Label>

          <Input
            id="installation-cbamInstallationId"
            name="cbamInstallationId"
            disabled={pending}
          />
        </div>
      </div>

      <FieldError>
        {state.status === "error" ? state.message : null}
      </FieldError>

      <Button
        type="submit"
        loading={pending}
        className="w-fit"
      >
        <Factory
          className="size-4"
          aria-hidden="true"
        />

        Add installation
      </Button>
    </form>
  );
}

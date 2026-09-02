"use client";

import {
  useActionState,
} from "react";

import {
  UserPlus,
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
  createOperatorAction,
} from "./actions";

import {
  initialInstallationsScreenActionState,
} from "./action-state";

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
export function OperatorForm(
  {
    action = createOperatorAction,
  }: {
    action?: typeof createOperatorAction;
  } = {},
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

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 border-b border-[var(--border-default)] p-4"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="operator-name">
            Name
          </Label>

          <Input
            id="operator-name"
            name="name"
            required
            disabled={pending}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="operator-country">
            Country
          </Label>

          <Input
            id="operator-country"
            name="country"
            maxLength={2}
            required
            placeholder="ISO code"
            disabled={pending}
            className="uppercase"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="operator-contactEmail">
            Contact email
          </Label>

          <Input
            id="operator-contactEmail"
            name="contactEmail"
            type="email"
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
        <UserPlus
          className="size-4"
          aria-hidden="true"
        />

        Add operator
      </Button>
    </form>
  );
}

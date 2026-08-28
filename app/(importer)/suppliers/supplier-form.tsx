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
  createSupplierAction,
} from "./actions";

import {
  initialSupplierActionState,
} from "./action-state";

export function SupplierForm() {
  const [
    state,
    formAction,
    pending,
  ] =
    useActionState(
      createSupplierAction,
      initialSupplierActionState,
    );

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 border-b border-[var(--border-default)] p-4"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="name">
            Name
          </Label>

          <Input
            id="name"
            name="name"
            required
            disabled={pending}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="country">
            Country
          </Label>

          <Input
            id="country"
            name="country"
            maxLength={2}
            placeholder="ISO code"
            disabled={pending}
            className="uppercase"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="contactEmail">
            Contact email
          </Label>

          <Input
            id="contactEmail"
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

        Add supplier
      </Button>
    </form>
  );
}

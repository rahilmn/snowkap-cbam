"use client";

import {
  useActionState,
} from "react";

import {
  Button,
} from "../../../components/ui/button";

import {
  FieldError,
} from "../../../components/ui/field-error";

import {
  Input,
} from "../../../components/ui/input";

import {
  Label,
} from "../../../components/ui/label";

import {
  updatePasswordAction,
} from "./actions";

import {
  initialAuthActionState,
} from "../action-state";

export function ResetPasswordForm() {
  const [
    state,
    formAction,
    pending,
  ] =
    useActionState(
      updatePasswordAction,
      initialAuthActionState,
    );

  return (
    <form
      action={formAction}
      className="flex w-full max-w-sm flex-col gap-4"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">
          New password
        </Label>

        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          invalid={state.status === "error"}
        />

        <p className="text-xs text-[var(--text-tertiary)]">
          At least 8 characters, with a lowercase letter, an uppercase
          letter, and a number.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirmPassword">
          Confirm new password
        </Label>

        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          invalid={state.status === "error"}
        />
      </div>

      <FieldError>
        {state.status === "error" ? state.message : null}
      </FieldError>

      <Button
        type="submit"
        loading={pending}
        className="mt-1"
      >
        Set new password
      </Button>
    </form>
  );
}

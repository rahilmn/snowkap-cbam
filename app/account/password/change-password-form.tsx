"use client";

import {
  useActionState,
} from "react";

import Link from "next/link";

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
  changePasswordAction,
} from "./actions";

import {
  initialAuthActionState,
} from "../../(auth)/action-state";

/**
 * 2026-09-04 (P14, AUTH-1).
 *
 * Deliberately absent, each for a stated reason:
 *
 *   - no autoFocus anywhere. The first control is a password field and
 *     the form submits on Enter; focusing it on load turns a stray
 *     keypress into a submission of a half-filled credential form.
 *   - no auto-submit, no effect that calls the action. The action runs
 *     from an explicit press and nothing else.
 *   - no query parameters and no route state carry any field on this
 *     screen. The current password goes into the POST body and nowhere
 *     else.
 */
export function ChangePasswordForm() {
  const [
    state,
    formAction,
    pending,
  ] =
    useActionState(
      changePasswordAction,
      initialAuthActionState,
    );

  return (
    <form
      action={formAction}
      className="flex w-full max-w-sm flex-col gap-4"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="currentPassword">
          Current password
        </Label>

        <Input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          aria-describedby="currentPasswordHint"
          invalid={state.status === "error"}
        />

        <p
          id="currentPasswordHint"
          className="text-xs text-[var(--text-tertiary)]"
        >
          Required. Being signed in is not enough to change a password.{" "}
          <Link
            href="/forgot-password"
            className="font-medium text-[var(--accent-interactive)] hover:text-[var(--accent-interactive-hover)]"
          >
            Forgotten it?
          </Link>
        </p>
      </div>

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
          aria-describedby="passwordHint"
          invalid={state.status === "error"}
        />

        <p
          id="passwordHint"
          className="text-xs text-[var(--text-tertiary)]"
        >
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
        Change password
      </Button>
    </form>
  );
}

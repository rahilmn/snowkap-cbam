"use client";

import {
  useActionState,
} from "react";

import Link from "next/link";

import {
  MailCheck,
} from "lucide-react";

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
  requestPasswordResetAction,
} from "./actions";

import {
  initialAuthActionState,
} from "../action-state";

export function ForgotPasswordForm() {
  const [
    state,
    formAction,
    pending,
  ] =
    useActionState(
      requestPasswordResetAction,
      initialAuthActionState,
    );

  if (state.status === "check-email") {
    return (
      <div className="flex flex-col items-center gap-3 py-2 text-center">
        <MailCheck
          className="size-8 text-[var(--accent-interactive)]"
          aria-hidden="true"
        />

        <p className="text-sm text-[var(--text-primary)]">
          If an account exists for that email, a password reset link
          has been sent. Check your inbox.
        </p>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className="flex w-full max-w-sm flex-col gap-4"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">
          Email
        </Label>

        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
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
        Send reset link
      </Button>

      <p className="text-center text-sm text-[var(--text-secondary)]">
        Remembered your password?{" "}
        <Link
          href="/sign-in"
          className="font-medium text-[var(--accent-interactive)] hover:text-[var(--accent-interactive-hover)]"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}

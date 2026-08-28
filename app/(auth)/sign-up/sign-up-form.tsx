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
  signUpAction,
} from "../actions";

import {
  initialAuthActionState,
} from "../action-state";

export function SignUpForm() {
  const [
    state,
    formAction,
    pending,
  ] =
    useActionState(
      signUpAction,
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
          Check your email for a confirmation link to finish creating
          your account.
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

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">
          Password
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
          At least 8 characters.
        </p>
      </div>

      <FieldError>
        {state.status === "error" ? state.message : null}
      </FieldError>

      <Button
        type="submit"
        loading={pending}
        className="mt-1"
      >
        Create account
      </Button>

      <p className="text-center text-sm text-[var(--text-secondary)]">
        Already have an account?{" "}
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

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
  signInAction,
} from "../actions";

import {
  initialAuthActionState,
} from "../action-state";

export function SignInForm() {
  const [
    state,
    formAction,
    pending,
  ] =
    useActionState(
      signInAction,
      initialAuthActionState,
    );

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
          autoComplete="current-password"
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
        Sign in
      </Button>

      <p className="text-center text-sm text-[var(--text-secondary)]">
        Don&apos;t have an account?{" "}
        <Link
          href="/sign-up"
          className="font-medium text-[var(--accent-interactive)] hover:text-[var(--accent-interactive-hover)]"
        >
          Sign up
        </Link>
      </p>
    </form>
  );
}

"use client";

import {
  useActionState,
} from "react";

import {
  Input,
} from "../../../components/ui/input";

import {
  Label,
} from "../../../components/ui/label";

import {
  Button,
} from "../../../components/ui/button";

import {
  startDeclarationAction,
} from "./actions";

import {
  initialDeclarationActionState,
} from "./action-state";

const QUARTER_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Annual (no quarter)" },
  { value: "1", label: "Q1" },
  { value: "2", label: "Q2" },
  { value: "3", label: "Q3" },
  { value: "4", label: "Q4" },
];

/**
 * A POST server action (useActionState), not PeriodPicker's own GET
 * `<Form>` -- this form doesn't just navigate to a URL that already
 * shows something, it calls generateOrRefreshDeclarationDraft (a real
 * write: finds-or-creates a DRAFT row) and only then redirects,
 * matching CreateShipmentForm's own "mutation, then navigate to the
 * result" shape rather than PeriodPicker's pure-navigation one.
 */
export function StartDeclarationForm() {
  const [
    state,
    formAction,
    pending,
  ] =
    useActionState(
      startDeclarationAction,
      initialDeclarationActionState,
    );

  return (
    <form
      action={formAction}
      className="flex flex-wrap items-end gap-3"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="start-declaration-year">
          Year
        </Label>

        <Input
          id="start-declaration-year"
          name="year"
          placeholder="2026"
          pattern="\d{4}"
          maxLength={4}
          required
          className="w-24"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="start-declaration-quarter">
          Quarter
        </Label>

        <select
          id="start-declaration-quarter"
          name="quarter"
          defaultValue=""
          className="h-10 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-page)] px-2.5 text-sm text-[var(--text-primary)]"
        >
          {QUARTER_OPTIONS.map(
            (option) => (
              <option
                key={option.value}
                value={option.value}
              >
                {option.label}
              </option>
            ),
          )}
        </select>
      </div>

      <Button
        type="submit"
        loading={pending}
      >
        Start declaration
      </Button>

      {state.status === "error" ? (
        <p className="w-full text-xs text-[var(--color-danger-700)]">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

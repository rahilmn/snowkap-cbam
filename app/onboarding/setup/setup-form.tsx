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
  updateOnboardingSetupAction,
} from "./actions";

import {
  initialOnboardingSetupActionState,
} from "./action-state";

import type {
  CbamSector,
} from "../../../src/domain/organizations/types";

const SECTOR_OPTIONS: { value: CbamSector; label: string }[] =
  [
    { value: "CEMENT", label: "Cement" },
    { value: "FERTILISERS", label: "Fertilisers" },
    { value: "IRON_STEEL", label: "Iron & steel" },
    { value: "ALUMINIUM", label: "Aluminium" },
    { value: "HYDROGEN", label: "Hydrogen" },
  ];

export function OnboardingSetupForm(
  {
    initialSectors,
  }: {
    initialSectors: CbamSector[];
  },
) {
  const [
    state,
    formAction,
    pending,
  ] =
    useActionState(
      updateOnboardingSetupAction,
      initialOnboardingSetupActionState,
    );

  return (
    <form
      action={formAction}
      className="flex max-w-md flex-col gap-4"
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-[var(--text-primary)]">
          Which sectors do you work in?
        </legend>

        <p className="mb-1 text-xs text-[var(--text-tertiary)]">
          Shapes suggestions on the goods picker -- never a requirement
          to use any part of the product.
        </p>

        {SECTOR_OPTIONS.map(
          (option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-center gap-3 rounded-[var(--radius-md)] border border-[var(--border-default)] p-3 transition-colors duration-150 hover:border-[var(--border-strong)]"
            >
              <input
                type="checkbox"
                name="sectors"
                value={option.value}
                defaultChecked={initialSectors.includes(option.value)}
                className="size-4 accent-[var(--accent-interactive)]"
              />

              <span className="text-sm font-medium text-[var(--text-primary)]">
                {option.label}
              </span>
            </label>
          ),
        )}

        <div
          className="flex cursor-not-allowed items-start gap-3 rounded-[var(--radius-md)] border border-[var(--border-default)] p-3 opacity-60"
          title="Not supported in this release -- no default values are loaded for electricity"
        >
          <input
            type="checkbox"
            disabled
            aria-disabled="true"
            className="mt-0.5 size-4"
          />

          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-[var(--text-primary)]">
              Electricity
            </span>

            <span className="text-xs text-[var(--text-secondary)]">
              Not supported in this release -- no default values are
              loaded for electricity.
            </span>
          </span>
        </div>
      </fieldset>

      <FieldError id="onboarding-setup-form-error">
        {state.status === "error" ? state.message : null}
      </FieldError>

      {state.status === "success" ? (
        <p
          role="status"
          className="text-sm text-[var(--color-success-700)]"
        >
          {state.message}
        </p>
      ) : null}

      <Button
        type="submit"
        loading={pending}
      >
        Save
      </Button>
    </form>
  );
}

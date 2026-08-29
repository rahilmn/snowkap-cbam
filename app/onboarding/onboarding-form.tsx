"use client";

import {
  useActionState,
  useState,
} from "react";

import {
  Building2,
  Factory,
} from "lucide-react";

import {
  Button,
} from "../../components/ui/button";

import {
  FieldError,
} from "../../components/ui/field-error";

import {
  Input,
} from "../../components/ui/input";

import {
  Label,
} from "../../components/ui/label";

import {
  cn,
} from "../../lib/utils";

import {
  createOrganizationAction,
} from "./actions";

import {
  initialOnboardingActionState,
} from "./action-state";

function slugify(
  value: string,
): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const CAPABILITY_OPTIONS = [
  {
    value: "IMPORTER_DECLARANT" as const,
    label: "Importer / Declarant",
    description:
      "Bring goods into the EU, classify shipments, and prepare CBAM declarations.",
    icon: Building2,
  },
  {
    value: "PRODUCER_OPERATOR" as const,
    label: "Third-country Producer / Operator",
    description:
      "Run production installations and share verified emissions data with importers.",
    icon: Factory,
  },
];

export function OnboardingForm() {
  const [
    state,
    formAction,
    pending,
  ] =
    useActionState(
      createOrganizationAction,
      initialOnboardingActionState,
    );

  const [
    name,
    setName,
  ] =
    useState(
      "",
    );

  const [
    slug,
    setSlug,
  ] =
    useState(
      "",
    );

  const [
    slugEditedManually,
    setSlugEditedManually,
  ] =
    useState(
      false,
    );

  const [
    selectedCapabilities,
    setSelectedCapabilities,
  ] =
    useState<
      string[]
    >(
      [],
    );

  return (
    <form
      action={formAction}
      className="flex w-full max-w-md flex-col gap-6"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">
          Organization name
        </Label>

        <Input
          id="name"
          name="name"
          required
          invalid={state.status === "error"}
          errorId="onboarding-form-error"
          value={name}
          onChange={(event) => {
            const nextName =
              event.target.value;

            setName(
              nextName,
            );

            if (!slugEditedManually) {
              setSlug(
                slugify(
                  nextName,
                ),
              );
            }
          }}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="slug">
          Organization identifier
        </Label>

        <p className="text-xs text-[var(--text-tertiary)]">
          A unique, URL-safe identifier for your organization.
        </p>

        <div className="flex items-center gap-1.5">
          <Input
            id="slug"
            name="slug"
            required
            invalid={state.status === "error"}
            errorId="onboarding-form-error"
            value={slug}
            onChange={(event) => {
              setSlugEditedManually(
                true,
              );

              setSlug(
                slugify(
                  event.target.value,
                ),
              );
            }}
          />
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-[var(--text-primary)]">
          What does your organization do on Snowkap?
        </legend>

        <p className="mb-1 text-xs text-[var(--text-tertiary)]">
          Choose at least one -- you can add the other later in
          settings.
        </p>

        {CAPABILITY_OPTIONS.map(
          (option) => {
            const checked =
              selectedCapabilities.includes(
                option.value,
              );

            const Icon =
              option.icon;

            return (
              <label
                key={option.value}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-[var(--radius-md)] border p-3 " +
                    "transition-colors duration-150",
                  checked
                    ? "border-[var(--accent-interactive)] bg-[var(--surface-sunken)]"
                    : "border-[var(--border-default)] hover:border-[var(--border-strong)]",
                )}
              >
                <input
                  type="checkbox"
                  name="capabilities"
                  value={option.value}
                  checked={checked}
                  onChange={(event) => {
                    setSelectedCapabilities(
                      (current) =>
                        event.target.checked
                          ? [...current, option.value]
                          : current.filter(
                              (value) => value !== option.value,
                            ),
                    );
                  }}
                  className="mt-0.5 size-4 accent-[var(--accent-interactive)]"
                />

                <span className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-[var(--text-primary)]">
                    <Icon
                      className="size-4"
                      aria-hidden="true"
                    />

                    {option.label}
                  </span>

                  <span className="text-xs text-[var(--text-secondary)]">
                    {option.description}
                  </span>
                </span>
              </label>
            );
          },
        )}
      </fieldset>

      <FieldError id="onboarding-form-error">
        {state.status === "error" ? state.message : null}
      </FieldError>

      <Button
        type="submit"
        loading={pending}
      >
        Create organization
      </Button>
    </form>
  );
}

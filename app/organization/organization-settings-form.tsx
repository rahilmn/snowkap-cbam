"use client";

import {
  useActionState,
} from "react";

import {
  Building2,
  Factory,
} from "lucide-react";

import {
  Button,
} from "../../components/ui/button";

import {
  Input,
} from "../../components/ui/input";

import {
  Label,
} from "../../components/ui/label";

import {
  Badge,
} from "../../components/ui/badge";

import {
  FieldError,
} from "../../components/ui/field-error";

import {
  updateOrganizationAction,
} from "./actions";

import {
  initialOrganizationSettingsActionState,
} from "./action-state";

import type {
  CbamDeclarantStatus,
  OrganizationCapability,
} from "../../src/domain/organizations/types";

const CAPABILITY_LABELS: Record<
  OrganizationCapability,
  { label: string; icon: typeof Building2 }
> = {
  IMPORTER_DECLARANT: {
    label: "Importer / Declarant",
    icon: Building2,
  },

  PRODUCER_OPERATOR: {
    label: "Third-country Producer / Operator",
    icon: Factory,
  },
};

const ALL_CAPABILITIES: OrganizationCapability[] =
  ["IMPORTER_DECLARANT", "PRODUCER_OPERATOR"];

export interface OrganizationProfileFields {
  name: string;
  eoriNumber: string | null;
  cbamDeclarantStatus: CbamDeclarantStatus;
  countryOfEstablishment: string | null;
  capabilities: OrganizationCapability[];
}

export function OrganizationSettingsForm(
  {
    organization,
  }: {
    organization: OrganizationProfileFields;
  },
) {
  const [
    state,
    formAction,
    pending,
  ] =
    useActionState(
      updateOrganizationAction,
      initialOrganizationSettingsActionState,
    );

  const missingCapability =
    ALL_CAPABILITIES.find(
      (capability) =>
        !organization.capabilities.includes(
          capability,
        ),
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
          defaultValue={organization.name}
          disabled={pending}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="eoriNumber">
          EORI number
        </Label>

        <Input
          id="eoriNumber"
          name="eoriNumber"
          placeholder="e.g. DE123456789012345"
          defaultValue={organization.eoriNumber ?? ""}
          disabled={pending}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="cbamDeclarantStatus">
          CBAM declarant status
        </Label>

        <select
          id="cbamDeclarantStatus"
          name="cbamDeclarantStatus"
          defaultValue={organization.cbamDeclarantStatus}
          disabled={pending}
          className="h-10 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-page)] px-2.5 text-sm text-[var(--text-primary)] disabled:opacity-50"
        >
          <option value="NOT_REGISTERED">
            Not registered
          </option>

          <option value="APPLICATION_PENDING">
            Application pending
          </option>

          <option value="AUTHORISED">
            Authorised
          </option>
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="countryOfEstablishment">
          Country of establishment
        </Label>

        <Input
          id="countryOfEstablishment"
          name="countryOfEstablishment"
          placeholder="ISO code, e.g. DE"
          maxLength={2}
          defaultValue={organization.countryOfEstablishment ?? ""}
          disabled={pending}
          className="uppercase"
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-[var(--text-primary)]">
          Capabilities
        </legend>

        <p className="mb-1 text-xs text-[var(--text-tertiary)]">
          Capabilities can be added here but not removed.
        </p>

        <div className="flex flex-col gap-1.5">
          {organization.capabilities.map(
            (capability) => (
              <Badge
                key={capability}
                tone="brand"
                className="w-fit"
              >
                {CAPABILITY_LABELS[capability].label}
              </Badge>
            ),
          )}
        </div>

        {missingCapability ? (
          <label className="mt-1 flex cursor-pointer items-center gap-2 text-sm text-[var(--text-secondary)]">
            <input
              type="checkbox"
              name="addCapability"
              value={missingCapability}
              disabled={pending}
              className="size-4 accent-[var(--accent-interactive)]"
            />

            Also add {CAPABILITY_LABELS[missingCapability].label}
          </label>
        ) : null}
      </fieldset>

      <FieldError>
        {state.status === "error" ? state.message : null}
      </FieldError>

      <Button
        type="submit"
        loading={pending}
        className="w-fit"
      >
        Save changes
      </Button>
    </form>
  );
}

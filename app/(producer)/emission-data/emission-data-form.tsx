"use client";

import {
  useActionState,
} from "react";

import {
  FileText,
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
  recordEmissionDataAction,
} from "./actions";

import {
  initialEmissionDataScreenActionState,
} from "./action-state";

export interface InstallationOption {
  id: string;
  name: string;
}

export function EmissionDataForm(
  {
    installations,
  }: {
    installations: InstallationOption[];
  },
) {
  const [
    state,
    formAction,
    pending,
  ] =
    useActionState(
      recordEmissionDataAction,
      initialEmissionDataScreenActionState,
    );

  if (installations.length === 0) {
    return (
      <p className="p-4 text-sm text-[var(--text-secondary)]">
        Add an installation first, then record its actual emissions here.
      </p>
    );
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 border-b border-[var(--border-default)] p-4"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1.5 lg:col-span-2">
          <Label htmlFor="ed-installationId">
            Installation
          </Label>

          <select
            id="ed-installationId"
            name="installationId"
            required
            disabled={pending}
            defaultValue=""
            className="h-10 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-page)] px-2.5 text-sm text-[var(--text-primary)] disabled:opacity-50"
          >
            <option value="" disabled>
              Choose installation
            </option>

            {installations.map(
              (installation) => (
                <option
                  key={installation.id}
                  value={installation.id}
                >
                  {installation.name}
                </option>
              ),
            )}
          </select>
        </div>

        <div className="flex flex-col gap-1.5 lg:col-span-2">
          <Label htmlFor="ed-cnScope">
            CN codes in scope
          </Label>

          <Input
            id="ed-cnScope"
            name="cnScope"
            required
            placeholder="e.g. 72081000, 72082500"
            disabled={pending}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ed-periodKind">
            Reporting period
          </Label>

          <select
            id="ed-periodKind"
            name="periodKind"
            defaultValue="ANNUAL"
            disabled={pending}
            className="h-10 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-page)] px-2.5 text-sm text-[var(--text-primary)] disabled:opacity-50"
          >
            <option value="ANNUAL">
              Annual
            </option>

            <option value="QUARTERLY">
              Quarterly
            </option>
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ed-periodYear">
            Year
          </Label>

          <Input
            id="ed-periodYear"
            name="periodYear"
            required
            placeholder="e.g. 2026"
            disabled={pending}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ed-periodQuarter">
            Quarter (if quarterly)
          </Label>

          <select
            id="ed-periodQuarter"
            name="periodQuarter"
            defaultValue=""
            disabled={pending}
            className="h-10 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-page)] px-2.5 text-sm text-[var(--text-primary)] disabled:opacity-50"
          >
            <option value="">
              --
            </option>

            <option value="1">
              Q1
            </option>

            <option value="2">
              Q2
            </option>

            <option value="3">
              Q3
            </option>

            <option value="4">
              Q4
            </option>
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ed-methodology">
            Methodology
          </Label>

          <select
            id="ed-methodology"
            name="methodology"
            defaultValue="EU_METHOD"
            disabled={pending}
            className="h-10 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-page)] px-2.5 text-sm text-[var(--text-primary)] disabled:opacity-50"
          >
            <option value="EU_METHOD">
              EU method
            </option>

            <option value="EQUIVALENT_METHOD">
              Equivalent method
            </option>

            <option value="OTHER">
              Other
            </option>
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ed-directSpecific">
            Direct specific emissions
          </Label>

          <Input
            id="ed-directSpecific"
            name="directSpecific"
            required
            placeholder="e.g. 1.85"
            disabled={pending}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ed-indirectSpecific">
            Indirect specific emissions
          </Label>

          <Input
            id="ed-indirectSpecific"
            name="indirectSpecific"
            required
            placeholder="e.g. 0.32"
            disabled={pending}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ed-emissionUnit">
            Unit
          </Label>

          <Input
            id="ed-emissionUnit"
            name="emissionUnit"
            required
            placeholder="e.g. tCO2e/t"
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
        <FileText
          className="size-4"
          aria-hidden="true"
        />

        Record emission data
      </Button>
    </form>
  );
}

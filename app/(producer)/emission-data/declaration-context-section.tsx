"use client";

import {
  useActionState,
  useState,
} from "react";

import {
  StatusBadge,
} from "../../../components/ui/status-badge";

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
  Select,
} from "../../../components/ui/select";

import {
  ConfirmSubmitButton,
} from "../../../components/ui/confirm-submit-button";

import {
  verifierReportBadgeFor,
} from "../../../src/domain/status-vocabulary";

import {
  upsertDeclarationContextAction,
  addPrecursorAction,
  removePrecursorAction,
} from "./actions";

import {
  initialEmissionDataScreenActionState,
} from "./action-state";

import type {
  PrecursorProvenance,
} from "../../../src/domain/emissions/declaration-context-types";

export interface PrecursorListItem {
  id: string;
  materialDescription: string;
  cnCode: string | null;
  sourceDescription: string | null;
  directSpecific: string | null;
  indirectSpecific: string | null;
  emissionUnit: string | null;
  provenance: PrecursorProvenance;
  verifierReportDescription: string | null;
}

export interface DeclarationContextListItem {
  productionProcessDescription: string | null;
  usesPurchasedPrecursors: boolean;
  verifierReportDeclared: boolean;
  verifierReportDescription: string | null;
}

function precursorProvenanceLabel(
  provenance: PrecursorProvenance,
): string {
  if (provenance === "ACTUAL_WITH_DECLARED_REPORT") {
    return "Actual value -- verifier report declared by operator (not validated by Snowkap)";
  }

  if (provenance === "ACTUAL_NO_DECLARED_REPORT") {
    return "Actual value -- no verifier report declared";
  }

  return "Not known";
}

/**
 * S4 (producer/trust/sharing), v2.1.1 sections 9-13: the dossier
 * capture UI, rendered inline per emission_data record -- same
 * always-visible-regardless-of-role placement as EvidenceSection,
 * immediately below it. Unlike evidence (attachable at any point in a
 * record's lifecycle), the edit forms here render ONLY while `editable`
 * (the parent record's own status === "DRAFT") -- section 11's
 * "pre-publication editability, post-verification locking": once a
 * record leaves DRAFT, its context is a read-only historical fact,
 * enforced server-side by upsertDeclarationContext/addPrecursor/
 * removePrecursor (manage-declaration-context.ts, manage-precursors.ts),
 * mirrored here so the UI does not offer a control the server would
 * refuse anyway.
 */
export function DeclarationContextSection(
  {
    emissionDataId,
    editable,
    context,
    precursors,
  }: {
    emissionDataId: string;
    editable: boolean;
    context: DeclarationContextListItem | null;
    precursors: PrecursorListItem[];
  },
) {
  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-[var(--border-default)] pt-2">
      <span className="text-xs font-medium text-[var(--text-secondary)]">
        Dossier context
      </span>

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge
          statusKey={verifierReportBadgeFor(context?.verifierReportDeclared ?? false)}
        />
      </div>

      {editable ? (
        <DeclarationContextForm
          // Remounts whenever the SAVED context actually changes --
          // without this, the "verifier report declared" checkbox
          // (necessarily controlled, so its own onChange can drive the
          // conditional description field below it) keeps whatever
          // the user last toggled across a post-save revalidation,
          // since this component isn't otherwise unmounted (its
          // parent list keeps a stable key={record.id}). The result
          // without this key: the badge above (always derived fresh
          // from `context`) would say DECLARED right after a
          // successful save while the checkbox one section down still
          // showed unchecked, until the next full page load quietly
          // "fixed" it -- a real, if self-correcting, inconsistency.
          key={JSON.stringify(context)}
          emissionDataId={emissionDataId}
          context={context}
        />
      ) : (
        <ReadOnlyContext
          context={context}
        />
      )}

      {(editable || precursors.length > 0) ? (
        <PrecursorsSection
          emissionDataId={emissionDataId}
          editable={editable}
          precursors={precursors}
        />
      ) : null}
    </div>
  );
}

function ReadOnlyContext(
  {
    context,
  }: {
    context: DeclarationContextListItem | null;
  },
) {
  if (!context || (!context.productionProcessDescription && !context.verifierReportDescription)) {
    return (
      <p className="text-xs text-[var(--text-secondary)]">
        No dossier context was captured for this record.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
      {context.productionProcessDescription ? (
        <p>
          {context.productionProcessDescription}
        </p>
      ) : null}

      {context.verifierReportDescription ? (
        <p>
          {context.verifierReportDescription}
        </p>
      ) : null}
    </div>
  );
}

function DeclarationContextForm(
  {
    emissionDataId,
    context,
  }: {
    emissionDataId: string;
    context: DeclarationContextListItem | null;
  },
) {
  const [state, formAction, pending] =
    useActionState(
      upsertDeclarationContextAction,
      initialEmissionDataScreenActionState,
    );

  const [verifierReportDeclared, setVerifierReportDeclared] =
    useState(
      context?.verifierReportDeclared ?? false,
    );

  const fieldPrefix =
    `dossier-${emissionDataId}`;

  return (
    <form
      action={formAction}
      className="flex flex-col gap-2"
    >
      <input
        type="hidden"
        name="emissionDataId"
        value={emissionDataId}
      />

      <div className="flex flex-col gap-1">
        <Label htmlFor={`${fieldPrefix}-process`}>
          Production process (plain language)
        </Label>

        <Input
          id={`${fieldPrefix}-process`}
          name="productionProcessDescription"
          placeholder="e.g. Kiln-fired at 900C using natural gas"
          disabled={pending}
          defaultValue={context?.productionProcessDescription ?? ""}
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
        <input
          type="checkbox"
          name="usesPurchasedPrecursors"
          value="true"
          disabled={pending}
          defaultChecked={context?.usesPurchasedPrecursors ?? false}
        />
        Uses CBAM-covered material purchased from another producer
      </label>

      <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
        <input
          type="checkbox"
          name="verifierReportDeclared"
          value="true"
          disabled={pending}
          checked={verifierReportDeclared}
          onChange={(event) => setVerifierReportDeclared(event.target.checked)}
        />
        A verifier report exists for this record's own figures
      </label>

      {verifierReportDeclared ? (
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${fieldPrefix}-report`}>
            Verifier report details
          </Label>

          <Input
            id={`${fieldPrefix}-report`}
            name="verifierReportDescription"
            placeholder="e.g. Verifier name and date"
            disabled={pending}
            defaultValue={context?.verifierReportDescription ?? ""}
          />

          <p className="text-xs text-[var(--text-tertiary)]">
            This is your own declaration -- Snowkap is not an accredited
            verifier and does not validate this.
          </p>
        </div>
      ) : null}

      <div>
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          loading={pending}
        >
          Save dossier context
        </Button>
      </div>

      {state.status === "error" ? (
        <p className="text-xs text-[var(--color-danger-700)]">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function PrecursorsSection(
  {
    emissionDataId,
    editable,
    precursors,
  }: {
    emissionDataId: string;
    editable: boolean;
    precursors: PrecursorListItem[];
  },
) {
  return (
    <div className="flex flex-col gap-2 border-t border-[var(--border-default)] pt-2">
      <span className="text-xs font-medium text-[var(--text-secondary)]">
        Precursor materials
      </span>

      {precursors.length === 0 ? (
        <p className="text-xs text-[var(--text-secondary)]">
          No precursor materials recorded.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {precursors.map(
            (precursor) => (
              <PrecursorRow
                key={precursor.id}
                precursor={precursor}
                editable={editable}
              />
            ),
          )}
        </ul>
      )}

      {editable ? (
        // Remounted whenever the precursor count changes (an add or a
        // remove), for the same reason DeclarationContextSection keys
        // its own form -- this form's provenance select is controlled
        // and its text fields are uncommitted between submits; without
        // a fresh mount after a successful add, the form would keep
        // showing what was just typed rather than resetting to blank,
        // inviting an accidental duplicate submission.
        <AddPrecursorForm
          key={precursors.length}
          emissionDataId={emissionDataId}
        />
      ) : null}
    </div>
  );
}

function PrecursorRow(
  {
    precursor,
    editable,
  }: {
    precursor: PrecursorListItem;
    editable: boolean;
  },
) {
  const [state, formAction, pending] =
    useActionState(
      removePrecursorAction,
      initialEmissionDataScreenActionState,
    );

  return (
    <li className="flex flex-col gap-1 rounded-[var(--radius-md)] border border-[var(--border-default)] p-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-[var(--text-primary)]">
          {precursor.materialDescription}
          {precursor.cnCode ? ` (${precursor.cnCode})` : ""}
        </span>

        {editable ? (
          <form action={formAction}>
            <input
              type="hidden"
              name="precursorId"
              value={precursor.id}
            />

            <ConfirmSubmitButton
              size="sm"
              variant="destructive"
              pending={pending}
              confirm={
                {
                  title: `Remove ${precursor.materialDescription}?`,
                  description: "This precursor material is removed from the dossier.",
                  confirmLabel: "Remove",
                  variant: "destructive",
                }
              }
            >
              Remove
            </ConfirmSubmitButton>
          </form>
        ) : null}
      </div>

      {precursor.sourceDescription ? (
        <span className="text-[var(--text-secondary)]">
          {precursor.sourceDescription}
        </span>
      ) : null}

      <span className="text-[var(--text-secondary)]">
        {precursor.directSpecific !== null || precursor.indirectSpecific !== null
          ? `Direct ${precursor.directSpecific ?? "--"} / Indirect ${precursor.indirectSpecific ?? "--"} ${precursor.emissionUnit ?? ""}`
          : "No figures provided"}
        {" -- "}
        {precursorProvenanceLabel(precursor.provenance)}
      </span>

      {state.status === "error" ? (
        <p className="text-[var(--color-danger-700)]">
          {state.message}
        </p>
      ) : null}
    </li>
  );
}

function AddPrecursorForm(
  {
    emissionDataId,
  }: {
    emissionDataId: string;
  },
) {
  const [state, formAction, pending] =
    useActionState(
      addPrecursorAction,
      initialEmissionDataScreenActionState,
    );

  const [provenance, setProvenance] =
    useState<PrecursorProvenance>(
      "UNKNOWN",
    );

  const fieldPrefix =
    `precursor-${emissionDataId}`;

  return (
    <form
      action={formAction}
      className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-dashed border-[var(--border-default)] p-2"
    >
      <input
        type="hidden"
        name="emissionDataId"
        value={emissionDataId}
      />

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${fieldPrefix}-material`}>
            Material
          </Label>

          <Input
            id={`${fieldPrefix}-material`}
            name="materialDescription"
            required
            placeholder="e.g. Clinker, purchased"
            disabled={pending}
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor={`${fieldPrefix}-cn`}>
            CN code (optional)
          </Label>

          <Input
            id={`${fieldPrefix}-cn`}
            name="cnCode"
            placeholder="e.g. 25231000"
            disabled={pending}
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor={`${fieldPrefix}-source`}>
            Source (optional)
          </Label>

          <Input
            id={`${fieldPrefix}-source`}
            name="sourceDescription"
            placeholder="e.g. Acme Cement, DE"
            disabled={pending}
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor={`${fieldPrefix}-provenance`}>
            Do you have this precursor's own figures?
          </Label>

          <Select
            id={`${fieldPrefix}-provenance`}
            name="provenance"
            disabled={pending}
            value={provenance}
            onChange={(event) => setProvenance(event.target.value as PrecursorProvenance)}
          >
            <option value="UNKNOWN">
              Not known
            </option>

            <option value="ACTUAL_NO_DECLARED_REPORT">
              Yes -- no verifier report
            </option>

            <option value="ACTUAL_WITH_DECLARED_REPORT">
              Yes -- verifier report declared
            </option>
          </Select>
        </div>

        {provenance !== "UNKNOWN" ? (
          <>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${fieldPrefix}-direct`}>
                Direct specific
              </Label>

              <Input
                id={`${fieldPrefix}-direct`}
                name="directSpecific"
                placeholder="e.g. 0.850"
                disabled={pending}
              />
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor={`${fieldPrefix}-indirect`}>
                Indirect specific
              </Label>

              <Input
                id={`${fieldPrefix}-indirect`}
                name="indirectSpecific"
                placeholder="e.g. 0.120"
                disabled={pending}
              />
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor={`${fieldPrefix}-unit`}>
                Unit
              </Label>

              <Input
                id={`${fieldPrefix}-unit`}
                name="emissionUnit"
                placeholder="e.g. tCO2e/t"
                disabled={pending}
              />
            </div>
          </>
        ) : null}

        {provenance === "ACTUAL_WITH_DECLARED_REPORT" ? (
          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label htmlFor={`${fieldPrefix}-report`}>
              Verifier report details
            </Label>

            <Input
              id={`${fieldPrefix}-report`}
              name="verifierReportDescription"
              placeholder="e.g. Verifier name and date"
              disabled={pending}
            />

            <p className="text-xs text-[var(--text-tertiary)]">
              Your own declaration -- Snowkap is not an accredited
              verifier and does not validate this.
            </p>
          </div>
        ) : null}
      </div>

      <div>
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          loading={pending}
        >
          Add precursor
        </Button>
      </div>

      {state.status === "error" ? (
        <p className="text-xs text-[var(--color-danger-700)]">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

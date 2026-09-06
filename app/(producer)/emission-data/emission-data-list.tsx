"use client";

import {
  useActionState,
} from "react";

import {
  Badge,
} from "../../../components/ui/badge";

import {
  ConfirmSubmitButton,
} from "../../../components/ui/confirm-submit-button";

import {
  Button,
} from "../../../components/ui/button";

import {
  Input,
} from "../../../components/ui/input";

import {
  transitionEmissionDataAction,
  verifyEmissionDataAction,
  rejectEmissionDataAction,
} from "./actions";

import {
  initialEmissionDataScreenActionState,
} from "./action-state";

import {
  EvidenceSection,
  type EvidenceFileListItem,
} from "./evidence-section";

import {
  DeclarationContextSection,
  type DeclarationContextListItem,
  type PrecursorListItem,
} from "./declaration-context-section";

import {
  StatusBadge,
} from "../../../components/ui/status-badge";

import {
  reviewBadgeFor,
  emissionRecordStatusKey,
  methodologyKey,
} from "../../../src/domain/status-vocabulary";

import {
  EVIDENCE_INCOMPLETE_NOTICE,
} from "../../../src/domain/status-vocabulary/owner-sentences";

import type {
  InstallationRecordProvenance,
} from "../../../src/domain/installations/types";

export interface EmissionDataListItem {
  id: string;
  installationName: string;
  // Who stands behind these figures -- the operator that runs the
  // installation, or an importer transcribing what an external
  // operator supplied (owner decision D2). Required, not optional:
  // reviewBadgeFor's review label reads differently for each, and a
  // provenance-free render would badge an importer's own transcription
  // as the operator's internal review (v2.1.1 §3 Correction B / SME
  // plan F13).
  provenance: InstallationRecordProvenance;
  cnScope: string[];
  periodLabel: string;
  directSpecific: string;
  indirectSpecific: string;
  emissionUnit: string;
  methodology: "EU_METHOD" | "EQUIVALENT_METHOD" | "OTHER";
  verificationStatus: "UNVERIFIED" | "VERIFICATION_PENDING" | "VERIFIED" | "REJECTED";
  status: "DRAFT" | "ACTIVE" | "SUPERSEDED" | "DISCARDED";
  rejectionReason: string | null;
  version: number;
  // LIVE completeness, re-derived server-side (page.tsx) from THIS
  // record's current evidence_file_ids on every render via
  // checkEmissionDataEvidenceCompleteness -- never a stored, one-time
  // flag. Shown regardless of verificationStatus/status (owner's
  // blocking-model directive: "preserve auditability of the incomplete
  // state"), including for a nominally VERIFIED/ACTIVE record whose
  // evidence was later removed -- that case must be surfaced honestly,
  // not hidden behind a stale-looking VERIFIED badge.
  evidenceComplete: boolean;
  missingEvidenceFields: string[];
  evidenceFiles: EvidenceFileListItem[];
  declarationContext: DeclarationContextListItem | null;
  precursors: PrecursorListItem[];
}

/**
 * Maps a domain missingFields entry (snapshot-completeness.ts's own
 * field-path vocabulary, e.g. "evidence_file_ids") to the specific,
 * human-readable description the directive requires ("identify what
 * evidence is missing"). checkEmissionDataEvidenceCompleteness
 * currently only ever reports "evidence_file_ids" -- the fallback below
 * exists so a future additive field on that check degrades to its raw
 * name instead of silently vanishing from this list.
 */
function describeMissingEvidenceField(
  field: string,
): string {
  if (field === "evidence_file_ids") {
    return "No evidence attached.";
  }

  return field;
}

export function EmissionDataList(
  {
    records,
    isAdmin,
  }: {
    records: EmissionDataListItem[];
    isAdmin: boolean;
  },
) {
  if (records.length === 0) {
    return (
      <p className="p-4 text-sm text-[var(--text-secondary)]">
        No emission data recorded yet.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-[var(--border-default)]">
      {records.map(
        (record) => (
          <EmissionDataRow
            key={record.id}
            record={record}
            isAdmin={isAdmin}
          />
        ),
      )}
    </ul>
  );
}

function EmissionDataRow(
  {
    record,
    isAdmin,
  }: {
    record: EmissionDataListItem;
    isAdmin: boolean;
  },
) {
  return (
    <li className="flex flex-col gap-2 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-[var(--text-primary)]">
              {record.installationName}
            </span>

            <StatusBadge
              statusKey={emissionRecordStatusKey(record.status)}
            />

            <StatusBadge
              statusKey={reviewBadgeFor(record.verificationStatus, record.provenance)}
            />

            {/*
              Shown regardless of verificationStatus/status -- see this
              file's own EmissionDataListItem doc comment on
              evidenceComplete. Not the same signal as the review badge
              above: a record can be
              VERIFICATION_PENDING (not yet gated) and Incomplete at the
              same time, or -- in the S5 gap this check exists to make
              harmless -- ACTIVE + VERIFIED and Incomplete at the same
              time, if evidence was removed afterward.
            */}
            {!record.evidenceComplete ? (
              <Badge tone="warning">
                Incomplete
              </Badge>
            ) : null}
          </div>

          <span className="text-xs text-[var(--text-secondary)]">
            {record.periodLabel} · {record.cnScope.join(", ") || "no CN codes"} · v{record.version}
          </span>

          <span className="flex items-center gap-1 text-xs text-[var(--text-secondary)]">
            Direct {record.directSpecific} / Indirect {record.indirectSpecific} {record.emissionUnit} ·{" "}
            <StatusBadge statusKey={methodologyKey(record.methodology)} />
          </span>

          {record.rejectionReason ? (
            <span className="text-xs text-[var(--color-danger-700)]">
              Rejected: {record.rejectionReason}
            </span>
          ) : null}

          {/*
            Persistent, always-on state while the record remains
            incomplete -- NOT a dismissible toast, and not conditioned on
            the Verify control being visible, per the owner's
            blocking-model directive ("Do NOT implement this as a
            cosmetic warning-only system" / "must be a persistent,
            visible state on the record"). Lists exactly what
            checkEmissionDataEvidenceCompleteness currently reports
            missing, plus the exact required explanatory copy.
          */}
          {!record.evidenceComplete ? (
            <div className="flex flex-col gap-1 rounded-[var(--radius-md)] border border-[var(--color-warning-300)] bg-[var(--color-warning-100)] p-2 text-xs text-[var(--color-warning-700)]">
              <p className="font-medium">
                Not ready for internal review
              </p>

              <ul className="list-disc pl-4">
                {record.missingEvidenceFields.map(
                  (field) => (
                    <li key={field}>
                      {describeMissingEvidenceField(field)}
                    </li>
                  ),
                )}
              </ul>

              <p>
                {EVIDENCE_INCOMPLETE_NOTICE}
              </p>
            </div>
          ) : null}
        </div>

        <RecordActions
          record={record}
          isAdmin={isAdmin}
        />
      </div>

      {/*
        Evidence attachment is available regardless of status/
        verification_status -- unlike RecordActions above, which only
        renders while status is DRAFT (see availableActions), evidence
        is an append-only supporting-documents list that must stay
        attachable at any point in a record's lifecycle, including
        during/after verification review (see this session's migration
        20260829240000_p7c_evidence_files_schema.sql's header comment
        for why evidence_file_ids was deliberately excluded from
        emission_data's own fact-immutability trigger).
      */}
      <EvidenceSection
        emissionDataId={record.id}
        files={record.evidenceFiles}
      />

      {/*
        Unlike EvidenceSection (attachable at any lifecycle stage), the
        edit forms inside this section render only while the record is
        still DRAFT -- v2.1.1 §11's "pre-publication editability,
        post-verification locking" -- see declaration-context-section.tsx's
        own doc comment.
      */}
      <DeclarationContextSection
        emissionDataId={record.id}
        editable={record.status === "DRAFT"}
        context={record.declarationContext}
        precursors={record.precursors}
      />
    </li>
  );
}

interface AvailableAction {
  kind: "SUBMIT_FOR_VERIFICATION" | "ACTIVATE" | "DISCARD" | "VERIFY" | "REJECT";
  label: string;
  variant: "primary" | "secondary" | "destructive";
  adminOnly: boolean;
}

/**
 * emission_data has two coupled state axes (verification_status,
 * status -- see emission-data-lifecycle.ts's own doc comment), so this
 * cannot be a flat Record<Status, Action[]> the way
 * app/(importer)/shipments/[id]/transition-actions.tsx's
 * ACTIONS_BY_STATUS is for the single-axis ShipmentStatus -- it needs
 * to branch on both. DISCARD is available whenever status is DRAFT
 * regardless of verification_status, matching exactly what the pure
 * transitionEmissionData function itself allows (it only checks
 * record.status, never verification_status, for DISCARD) -- this list
 * does not invent a narrower rule than the domain layer enforces.
 */
function availableActions(
  record: EmissionDataListItem,
): AvailableAction[] {
  if (record.status !== "DRAFT") {
    return [];
  }

  const actions: AvailableAction[] =
    [];

  if (record.verificationStatus === "UNVERIFIED" || record.verificationStatus === "REJECTED") {
    actions.push(
      { kind: "SUBMIT_FOR_VERIFICATION", label: "Submit for internal review", variant: "primary", adminOnly: false },
    );
  }

  if (record.verificationStatus === "VERIFICATION_PENDING") {
    actions.push(
      { kind: "VERIFY", label: "Approve in internal review", variant: "primary", adminOnly: true },
    );

    actions.push(
      // Dead value today: RejectForm below renders its own button text
      // rather than reading action.label (REJECT never flows through
      // TransitionButton -- see this file's RecordActions). Kept in
      // sync with the domain-action label vocabulary anyway.
      { kind: "REJECT", label: "Reject in internal review", variant: "destructive", adminOnly: true },
    );
  }

  if (record.verificationStatus === "VERIFIED") {
    actions.push(
      { kind: "ACTIVATE", label: "Activate", variant: "primary", adminOnly: false },
    );
  }

  actions.push(
    { kind: "DISCARD", label: "Discard", variant: "secondary", adminOnly: false },
  );

  return actions;
}

function RecordActions(
  {
    record,
    isAdmin,
  }: {
    record: EmissionDataListItem;
    isAdmin: boolean;
  },
) {
  // Verify/reject are rendered only for ADMIN+ callers -- matching how
  // this codebase already conditionally renders actions based on
  // caller role elsewhere (e.g. hasAdminAccess call sites in
  // src/application). This is a UI convenience only, not the
  // authorization boundary itself: manage-emission-data.ts's
  // verifyEmissionData/rejectEmissionData re-check hasAdminAccess
  // server-side regardless of what this filter renders.
  const actions =
    availableActions(record).filter(
      (action) => !action.adminOnly || isAdmin,
    );

  if (actions.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-start gap-2">
      {actions.map(
        (action) => {
          if (action.kind === "REJECT") {
            return (
              <RejectForm
                key={action.kind}
                emissionDataId={record.id}
              />
            );
          }

          if (action.kind === "VERIFY") {
            return (
              <VerifyButton
                key={action.kind}
                emissionDataId={record.id}
                label={action.label}
                variant={action.variant}
                blocked={!record.evidenceComplete}
              />
            );
          }

          return (
            <TransitionButton
              key={action.kind}
              emissionDataId={record.id}
              action={action.kind}
              label={action.label}
              variant={action.variant}
              // ACTIVATE also carries the block: a record can turn
              // Incomplete again between VERIFY and ACTIVATE (evidence
              // removed in between -- the defense-in-depth case
              // activateEmissionData itself re-checks server-side).
              // SUBMIT_FOR_VERIFICATION/DISCARD are unaffected -- the
              // directive only blocks verification/activation/consumer
              // use, never editing/submitting a draft.
              blocked={action.kind === "ACTIVATE" && !record.evidenceComplete}
            />
          );
        },
      )}
    </div>
  );
}

function TransitionButton(
  {
    emissionDataId,
    action,
    label,
    variant,
    blocked,
  }: {
    emissionDataId: string;
    action: "SUBMIT_FOR_VERIFICATION" | "ACTIVATE" | "DISCARD";
    label: string;
    variant: "primary" | "secondary" | "destructive";
    // Genuinely disables the button (not just visual discouragement) --
    // the server-side gate in activateEmissionData is still the actual
    // enforcement (manage-emission-data.ts), but the owner's directive
    // is explicit the block must not be cosmetic: a disabled control is
    // no more clickable than a rejected submit would be.
    blocked?: boolean;
  },
) {
  const [
    state,
    formAction,
    pending,
  ] =
    useActionState(
      transitionEmissionDataAction,
      initialEmissionDataScreenActionState,
    );

  return (
    <form action={formAction}>
      <input
        type="hidden"
        name="emissionDataId"
        value={emissionDataId}
      />

      <input
        type="hidden"
        name="action"
        value={action}
      />

      {/*
        * 2026-09-03 (P14, dialog #16). ACTIVATE is a CROSS-PARTY state
        * transition: it supersedes whatever record was ACTIVE for this
        * installation and period, and every importer holding a live
        * grant immediately begins reading the new figures, with their
        * existing determinations marked stale. SUBMIT_FOR_VERIFICATION
        * and DISCARD are not confirmed -- the first is reversible
        * (REJECT returns the record to a submittable state) and the
        * second already carries its own dialog at the call site.
        */}
      {action === "ACTIVATE" && !blocked ? (
        <ConfirmSubmitButton
          variant={variant}
          size="sm"
          pending={pending}
          title={state.status === "error" ? state.message : undefined}
          confirm={
            {
              title: "Activate this record?",
              description:
                "Activating supersedes the record currently active for this installation and period. Any importer you have shared this installation with immediately begins reading these figures instead, and their existing determinations are marked stale until they redetermine.",
              confirmLabel: "Activate",
              cancelLabel: "Cancel",
            }
          }
        >
          {label}
        </ConfirmSubmitButton>
      ) : (
        <Button
          type="submit"
          variant={variant}
          size="sm"
          loading={pending}
          disabled={blocked}
          title={
            blocked
              ? EVIDENCE_INCOMPLETE_NOTICE
              : state.status === "error" ? state.message : undefined
          }
        >
          {label}
        </Button>
      )}

      {state.status === "error" ? (
        <p className="mt-1 max-w-48 text-right text-xs text-[var(--color-danger-700)]">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function VerifyButton(
  {
    emissionDataId,
    label,
    variant,
    blocked,
  }: {
    emissionDataId: string;
    label: string;
    variant: "primary" | "secondary" | "destructive";
    // Genuinely disables the button when the record is Incomplete --
    // see TransitionButton's own doc comment on the same prop. The
    // server-side gate (verifyEmissionData's EVIDENCE_INCOMPLETE
    // rejection, manage-emission-data.ts) is still the actual
    // enforcement; this is what makes the block visibly, not just
    // cosmetically, real in the UI too.
    blocked: boolean;
  },
) {
  const [
    state,
    formAction,
    pending,
  ] =
    useActionState(
      verifyEmissionDataAction,
      initialEmissionDataScreenActionState,
    );

  return (
    <form action={formAction}>
      <input
        type="hidden"
        name="emissionDataId"
        value={emissionDataId}
      />

      {/*
        * 2026-09-03 (P14, dialog #15). Verifying is irreversible in the
        * shape this product offers: availableActions gives a VERIFIED
        * record no path back -- only ACTIVATE and DISCARD -- and once
        * verified, removeEvidenceFile refuses to detach the evidence
        * behind it (upload-evidence.ts, and the RLS in 20260829560000).
        * It is also the gate that makes the record activatable and
        * therefore shareable with an importer. Blocked (incomplete
        * evidence) keeps the plain disabled button: there is nothing to
        * confirm about an action that cannot run.
        */}
      {blocked ? (
        <Button
          type="submit"
          variant={variant}
          size="sm"
          loading={pending}
          disabled
          title={EVIDENCE_INCOMPLETE_NOTICE}
        >
          {label}
        </Button>
      ) : (
        <ConfirmSubmitButton
          variant={variant}
          size="sm"
          pending={pending}
          title={state.status === "error" ? state.message : undefined}
          confirm={
            {
              title: "Approve this record in internal review?",
              description:
                "Approving cannot be undone from this screen -- an approved record offers no path back to pending. The evidence attached to it can no longer be removed, and the record becomes activatable, which is what makes it visible to importers you share the installation with.",
              confirmLabel: "Approve record",
              cancelLabel: "Cancel",
            }
          }
        >
          {label}
        </ConfirmSubmitButton>
      )}

      {state.status === "error" ? (
        <p className="mt-1 max-w-48 text-right text-xs text-[var(--color-danger-700)]">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function RejectForm(
  {
    emissionDataId,
  }: {
    emissionDataId: string;
  },
) {
  const [
    state,
    formAction,
    pending,
  ] =
    useActionState(
      rejectEmissionDataAction,
      initialEmissionDataScreenActionState,
    );

  return (
    <form
      action={formAction}
      className="flex flex-col items-end gap-1"
    >
      <input
        type="hidden"
        name="emissionDataId"
        value={emissionDataId}
      />

      <div className="flex gap-1.5">
        <Input
          name="reason"
          required
          placeholder="Reason for rejection"
          disabled={pending}
          className="h-8 w-44 text-xs"
        />

        <Button
          type="submit"
          variant="destructive"
          size="sm"
          loading={pending}
        >
          Reject in internal review
        </Button>
      </div>

      {state.status === "error" ? (
        <p className="max-w-48 text-right text-xs text-[var(--color-danger-700)]">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

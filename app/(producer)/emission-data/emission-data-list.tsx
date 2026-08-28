"use client";

import {
  useActionState,
} from "react";

import {
  Badge,
  type BadgeProps,
} from "../../../components/ui/badge";

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

export interface EmissionDataListItem {
  id: string;
  installationName: string;
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
  evidenceFiles: EvidenceFileListItem[];
}

const STATUS_TONE: Record<EmissionDataListItem["status"], BadgeProps["tone"]> =
  {
    DRAFT: "neutral",
    ACTIVE: "success",
    SUPERSEDED: "neutral",
    DISCARDED: "danger",
  };

const VERIFICATION_TONE: Record<EmissionDataListItem["verificationStatus"], BadgeProps["tone"]> =
  {
    UNVERIFIED: "neutral",
    VERIFICATION_PENDING: "warning",
    VERIFIED: "success",
    REJECTED: "danger",
  };

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

            <Badge tone={STATUS_TONE[record.status]}>
              {record.status}
            </Badge>

            <Badge tone={VERIFICATION_TONE[record.verificationStatus]}>
              {record.verificationStatus.replace(/_/g, " ")}
            </Badge>
          </div>

          <span className="text-xs text-[var(--text-secondary)]">
            {record.periodLabel} · {record.cnScope.join(", ") || "no CN codes"} · v{record.version}
          </span>

          <span className="text-xs text-[var(--text-secondary)]">
            Direct {record.directSpecific} / Indirect {record.indirectSpecific} {record.emissionUnit} · {record.methodology.replace(/_/g, " ")}
          </span>

          {record.rejectionReason ? (
            <span className="text-xs text-[var(--color-danger-700)]">
              Rejected: {record.rejectionReason}
            </span>
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
      { kind: "SUBMIT_FOR_VERIFICATION", label: "Submit for verification", variant: "primary", adminOnly: false },
    );
  }

  if (record.verificationStatus === "VERIFICATION_PENDING") {
    actions.push(
      { kind: "VERIFY", label: "Verify", variant: "primary", adminOnly: true },
    );

    actions.push(
      { kind: "REJECT", label: "Reject", variant: "destructive", adminOnly: true },
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
  }: {
    emissionDataId: string;
    action: "SUBMIT_FOR_VERIFICATION" | "ACTIVATE" | "DISCARD";
    label: string;
    variant: "primary" | "secondary" | "destructive";
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

      <Button
        type="submit"
        variant={variant}
        size="sm"
        loading={pending}
        title={
          state.status === "error" ? state.message : undefined
        }
      >
        {label}
      </Button>

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
  }: {
    emissionDataId: string;
    label: string;
    variant: "primary" | "secondary" | "destructive";
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

      <Button
        type="submit"
        variant={variant}
        size="sm"
        loading={pending}
        title={
          state.status === "error" ? state.message : undefined
        }
      >
        {label}
      </Button>

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
          Reject
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

"use client";

import {
  useActionState,
  useState,
} from "react";

import {
  Badge,
} from "../../../../components/ui/badge";

import {
  ConfirmSubmitButton,
} from "../../../../components/ui/confirm-submit-button";

import {
  Button,
} from "../../../../components/ui/button";

import {
  Input,
} from "../../../../components/ui/input";

import {
  Label,
} from "../../../../components/ui/label";

import {
  createDeclarationAmendmentAction,
  markDeclarationReadyAction,
  recordDeclarationFiledAction,
  refreshDeclarationDraftAction,
} from "../actions";

import {
  initialDeclarationActionState,
} from "../action-state";

import type {
  DeclarationStatus,
} from "../../../../src/domain/declarations/types";

const BLOCKER_LABEL: Record<string, string> = {
  NO_SHIPMENTS_IN_PERIOD: "No shipments in this period",
  SHIPMENT_NOT_LOCKABLE: "Shipment not READY or LOCKED",
  SHIPMENT_HAS_NO_LINES: "Shipment has no lines",
  LINE_NOT_DETERMINED: "Line not determined",
  LINE_NOT_CALCULATED: "Line not calculated",
};

/**
 * Every mutating action master plan §27 screen 22 names (generate/
 * refresh, mark ready, record filed w/ LOCK warning, create amendment),
 * gated by the declaration's OWN status -- only the action(s) that could
 * actually succeed from the current state are ever rendered, matching
 * TransitionActions.tsx's own ACTIONS_BY_STATUS shape
 * (app/(importer)/shipments/[id]/transition-actions.tsx).
 */
export function DeclarationActions(
  {
    declarationId,
    status,
    reportingPeriodYear,
    reportingPeriodQuarter,
    hasActiveSuccessor,
  }: {
    declarationId: string;
    status: DeclarationStatus;
    reportingPeriodYear: number;
    reportingPeriodQuarter: 1 | 2 | 3 | 4 | null;
    hasActiveSuccessor: boolean;
  },
) {
  if (status === "DRAFT") {
    return (
      <div className="flex flex-col gap-3">
        <RefreshDraftForm
          declarationId={declarationId}
          reportingPeriodYear={reportingPeriodYear}
          reportingPeriodQuarter={reportingPeriodQuarter}
        />

        <MarkReadyForm
          declarationId={declarationId}
        />
      </div>
    );
  }

  if (status === "READY") {
    return (
      <RecordFiledForm
        declarationId={declarationId}
      />
    );
  }

  if (status === "FILED_RECORDED" && !hasActiveSuccessor) {
    return (
      <CreateAmendmentForm
        originalDeclarationId={declarationId}
      />
    );
  }

  return null;
}

function RefreshDraftForm(
  {
    declarationId,
    reportingPeriodYear,
    reportingPeriodQuarter,
  }: {
    declarationId: string;
    reportingPeriodYear: number;
    reportingPeriodQuarter: 1 | 2 | 3 | 4 | null;
  },
) {
  const [
    state,
    formAction,
    pending,
  ] =
    useActionState(
      refreshDeclarationDraftAction,
      initialDeclarationActionState,
    );

  return (
    <form
      action={formAction}
      className="flex flex-col items-end gap-1.5"
    >
      <input type="hidden" name="declarationId" value={declarationId} />
      <input type="hidden" name="year" value={String(reportingPeriodYear)} />
      <input type="hidden" name="quarter" value={reportingPeriodQuarter ? String(reportingPeriodQuarter) : ""} />

      <Button
        type="submit"
        variant="secondary"
        size="sm"
        loading={pending}
      >
        Generate / refresh draft
      </Button>

      {state.status === "error" ? (
        <p className="max-w-64 text-right text-xs text-[var(--color-danger-700)]">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function MarkReadyForm(
  {
    declarationId,
  }: {
    declarationId: string;
  },
) {
  const [
    state,
    formAction,
    pending,
  ] =
    useActionState(
      markDeclarationReadyAction,
      initialDeclarationActionState,
    );

  return (
    <form
      action={formAction}
      className="flex flex-col items-end gap-1.5"
    >
      <input type="hidden" name="declarationId" value={declarationId} />

      <ConfirmSubmitButton
        variant="primary"
        size="sm"
        pending={pending}
        confirm={
          {
            title: "Mark this declaration ready?",

            // Ready freezes the set of member shipments, and there is no
            // route back to draft from this screen -- the period's own
            // PERIOD_HAS_READY_DECLARATION rule then prevents starting
            // another draft for it.
            description:
              "This freezes the set of shipments in this declaration and is the step before recording it as filed. A ready declaration cannot be returned to draft from this screen.",
            confirmLabel: "Mark ready",
            cancelLabel: "Keep as draft",
          }
        }
      >
        Mark ready
      </ConfirmSubmitButton>

      {state.status === "error" ? (
        <div className="flex max-w-80 flex-col gap-1.5 text-right">
          <p className="text-xs text-[var(--color-danger-700)]">
            {state.message}
          </p>

          {state.blockers && state.blockers.length > 0 ? (
            <ul className="flex flex-col gap-1 rounded-[var(--radius-sm)] bg-[var(--color-danger-100)] p-2 text-left">
              {state.blockers.map(
                (blocker, index) => (
                  <li
                    key={`${blocker.reason}-${blocker.shipment_id ?? "period"}-${blocker.line_id ?? index}`}
                    className="flex items-center justify-between gap-2 text-xs text-[var(--color-danger-700)]"
                  >
                    <span>
                      {blocker.shipment_reference ?? "This period"}
                      {blocker.line_number ? ` · line ${blocker.line_number}` : ""}
                    </span>

                    <Badge tone="danger">
                      {BLOCKER_LABEL[blocker.reason] ?? blocker.reason}
                    </Badge>
                  </li>
                ),
              )}
            </ul>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

/**
 * §27's own screen note for this action: "record-filed w/ LOCK
 * warning." A two-step confirm (not a bare submit button) -- typing the
 * reference alone doesn't submit; a visible LOCK warning must be read
 * and an explicit "Yes, record this filing" click follows, since this
 * is the one action in the whole declarations module that is
 * IRREVERSIBLE from the UI (public.record_declaration_filed() LOCKs
 * every member shipment atomically -- there is no "undo" screen).
 */
function RecordFiledForm(
  {
    declarationId,
  }: {
    declarationId: string;
  },
) {
  const [
    confirming,
    setConfirming,
  ] =
    useState(
      false,
    );

  const [
    state,
    formAction,
    pending,
  ] =
    useActionState(
      recordDeclarationFiledAction,
      initialDeclarationActionState,
    );

  return (
    <form
      action={formAction}
      className="flex w-72 flex-col items-end gap-2"
    >
      <input type="hidden" name="declarationId" value={declarationId} />

      <div className="flex w-full flex-col gap-1.5">
        <Label htmlFor="filed-reference">
          Filing reference
        </Label>

        <Input
          id="filed-reference"
          name="filedReference"
          placeholder="Exactly as shown on the official channel"
          required
          onFocus={() => setConfirming(true)}
        />
      </div>

      {confirming ? (
        <div className="w-full rounded-[var(--radius-sm)] bg-[var(--color-warning-100)] px-3 py-2 text-xs text-[var(--color-warning-700)]">
          Recording this filing LOCKS every member shipment permanently
          -- shipment lines can no longer be edited afterward. Enter the
          reference exactly as the declarant recorded it with the
          official CBAM channel; Snowkap never generates or validates
          this value.
        </div>
      ) : null}

      <Button
        type="submit"
        variant="destructive"
        size="sm"
        loading={pending}
        disabled={!confirming}
      >
        Record filed (locks shipments)
      </Button>

      {state.status === "error" ? (
        <p className="text-right text-xs text-[var(--color-danger-700)]">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function CreateAmendmentForm(
  {
    originalDeclarationId,
  }: {
    originalDeclarationId: string;
  },
) {
  const [
    state,
    formAction,
    pending,
  ] =
    useActionState(
      createDeclarationAmendmentAction,
      initialDeclarationActionState,
    );

  return (
    <form
      action={formAction}
      className="flex flex-col items-end gap-1.5"
    >
      <input type="hidden" name="originalDeclarationId" value={originalDeclarationId} />

      <Button
        type="submit"
        variant="secondary"
        size="sm"
        loading={pending}
      >
        Create amendment
      </Button>

      {state.status === "error" ? (
        <p className="max-w-64 text-right text-xs text-[var(--color-danger-700)]">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

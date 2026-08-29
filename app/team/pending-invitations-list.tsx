"use client";

import {
  useActionState,
} from "react";

import {
  X,
} from "lucide-react";

import {
  Button,
} from "../../components/ui/button";

import {
  FieldError,
} from "../../components/ui/field-error";

import {
  revokeInvitationAction,
} from "./actions";

import {
  initialTeamActionState,
} from "./action-state";

import {
  formatDate,
} from "../../lib/utils";

export interface PendingInvitationRow {
  invitationId: string;
  email: string;
  role: "ADMIN" | "MEMBER";
  expiresAt: string;
}

export function PendingInvitationsList(
  {
    invitations,
  }: {
    invitations: PendingInvitationRow[];
  },
) {
  if (invitations.length === 0) {
    return null;
  }

  return (
    <div className="border-b border-[var(--border-default)] p-4">
      <h2 className="mb-2 text-sm font-medium text-[var(--text-secondary)]">
        Pending invitations
      </h2>

      <ul className="flex flex-col gap-1.5">
        {invitations.map(
          (invitation) => (
            <PendingInvitationItem
              key={invitation.invitationId}
              invitation={invitation}
            />
          ),
        )}
      </ul>
    </div>
  );
}

function PendingInvitationItem(
  {
    invitation,
  }: {
    invitation: PendingInvitationRow;
  },
) {
  const [
    state,
    formAction,
    pending,
  ] =
    useActionState(
      revokeInvitationAction,
      initialTeamActionState,
    );

  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-4 text-sm">
        <div className="flex flex-col">
          <span className="text-[var(--text-primary)]">
            {invitation.email}
            <span className="ml-2 text-[var(--text-tertiary)]">
              {invitation.role}
            </span>
          </span>

          <span className="text-xs text-[var(--text-tertiary)]">
            Expires {formatDate(invitation.expiresAt)}
          </span>
        </div>

        <form action={formAction}>
          <input
            type="hidden"
            name="invitationId"
            value={invitation.invitationId}
          />

          <Button
            type="submit"
            variant="ghost"
            size="sm"
            loading={pending}
            aria-label={`Revoke invitation for ${invitation.email}`}
            title={`Revoke invitation for ${invitation.email}`}
          >
            <X
              className="size-4"
              aria-hidden="true"
            />
          </Button>
        </form>
      </div>

      <FieldError>
        {state.status === "error" ? state.message : null}
      </FieldError>
    </li>
  );
}

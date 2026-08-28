"use client";

import {
  useActionState,
} from "react";

import {
  Button,
} from "../../components/ui/button";

import {
  FieldError,
} from "../../components/ui/field-error";

import {
  acceptInvitationAction,
} from "./actions";

import {
  initialAcceptInvitationActionState,
} from "./action-state";

export interface AcceptableInvitation {
  invitationId: string;
  organizationName: string;
  role: "ADMIN" | "MEMBER";
}

export function AcceptInvitationList(
  {
    invitations,
  }: {
    invitations: AcceptableInvitation[];
  },
) {
  return (
    <ul className="flex flex-col gap-3">
      {invitations.map(
        (invitation) => (
          <AcceptInvitationItem
            key={invitation.invitationId}
            invitation={invitation}
          />
        ),
      )}
    </ul>
  );
}

function AcceptInvitationItem(
  {
    invitation,
  }: {
    invitation: AcceptableInvitation;
  },
) {
  const [
    state,
    formAction,
    pending,
  ] =
    useActionState(
      acceptInvitationAction,
      initialAcceptInvitationActionState,
    );

  return (
    <li className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border-default)] p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-sm font-medium text-[var(--text-primary)]">
            {invitation.organizationName}
          </span>

          <span className="text-sm text-[var(--text-secondary)]">
            Invited as {invitation.role}
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
            loading={pending}
          >
            Accept
          </Button>
        </form>
      </div>

      <FieldError>
        {state.status === "error" ? state.message : null}
      </FieldError>
    </li>
  );
}

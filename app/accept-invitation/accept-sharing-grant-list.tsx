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
  acceptSharingGrantInvitationAction,
} from "./actions";

import {
  initialAcceptInvitationActionState,
} from "./action-state";

import {
  formatDate,
} from "../../lib/utils";

export interface AcceptableSharingGrantInvitation {
  grantId: string;
  grantorOrganizationName: string;
  installationName: string;
  // Null = this bootstrap invitation carries no expiry of its own
  // (sharing_grants.expires_at, unlike organization_invitations.expires_at,
  // is nullable -- see accept_sharing_grant_invitation's own handling in
  // 20260829300000/20260829360000, which only checks it "if not null").
  expiresAt: string | null;
}

export function AcceptSharingGrantList(
  {
    invitations,
    activeOrganizationName,
  }: {
    invitations: AcceptableSharingGrantInvitation[];
    // null when the caller isn't a member of any org yet -- accepting
    // requires an active org (see acceptSharingGrantInvitation's own doc
    // comment), so the accept button is disabled with an explanatory
    // note instead of being offered.
    activeOrganizationName: string | null;
  },
) {
  return (
    <ul className="flex flex-col gap-3">
      {invitations.map(
        (invitation) => (
          <AcceptSharingGrantItem
            key={invitation.grantId}
            invitation={invitation}
            activeOrganizationName={activeOrganizationName}
          />
        ),
      )}
    </ul>
  );
}

function AcceptSharingGrantItem(
  {
    invitation,
    activeOrganizationName,
  }: {
    invitation: AcceptableSharingGrantInvitation;
    activeOrganizationName: string | null;
  },
) {
  const [
    state,
    formAction,
    pending,
  ] =
    useActionState(
      acceptSharingGrantInvitationAction,
      initialAcceptInvitationActionState,
    );

  return (
    <li className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border-default)] p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-sm font-medium text-[var(--text-primary)]">
            {invitation.grantorOrganizationName}
          </span>

          <span className="text-sm text-[var(--text-secondary)]">
            Wants to share {invitation.installationName}'s emissions data
            with you
          </span>

          {invitation.expiresAt ? (
            <span className="text-xs text-[var(--text-tertiary)]">
              Expires {formatDate(invitation.expiresAt)}
            </span>
          ) : null}
        </div>

        {activeOrganizationName ? (
          <form action={formAction}>
            <input
              type="hidden"
              name="grantId"
              value={invitation.grantId}
            />

            <Button
              type="submit"
              loading={pending}
            >
              Accept
            </Button>
          </form>
        ) : (
          <Button
            type="button"
            disabled
            title="Join or create an organization first"
          >
            Accept
          </Button>
        )}
      </div>

      {activeOrganizationName ? (
        <span className="text-xs text-[var(--text-tertiary)]">
          Accepting into {activeOrganizationName}.
        </span>
      ) : (
        <span className="text-xs text-[var(--text-tertiary)]">
          You need to belong to an organization before you can accept this.
        </span>
      )}

      <FieldError>
        {state.status === "error" ? state.message : null}
      </FieldError>
    </li>
  );
}

"use client";

import {
  useActionState,
  useId,
  useState,
} from "react";

import {
  Button,
} from "../../components/ui/button";

import {
  ConfirmSubmitButton,
} from "../../components/ui/confirm-submit-button";

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

/**
 * One organization this user could accept INTO: a membership whose
 * organization actually holds IMPORTER_DECLARANT.
 *
 * The page filters by capability rather than offering every membership
 * and letting the server refuse, because that refusal
 * (CAPABILITY_NOT_HELD, migration 20260903100000) is an authorization
 * boundary, and a chooser should not invite the user to cross one.
 */
export interface EligibleAcceptingOrganization {
  orgId: string;
  organizationName: string;
}

export function AcceptSharingGrantList(
  {
    invitations,
    eligibleOrganizations,
  }: {
    invitations: AcceptableSharingGrantInvitation[];
    // Empty when the caller belongs to no organization yet, or to no
    // importer/declarant organization -- accepting requires one, so the
    // accept button is disabled with an explanatory note instead of
    // being offered.
    eligibleOrganizations: EligibleAcceptingOrganization[];
  },
) {
  return (
    <ul className="flex flex-col gap-3">
      {invitations.map(
        (invitation) => (
          <AcceptSharingGrantItem
            key={invitation.grantId}
            invitation={invitation}
            eligibleOrganizations={eligibleOrganizations}
          />
        ),
      )}
    </ul>
  );
}

/**
 * 2026-09-03 (P14). The organization is CHOSEN here and submitted as a
 * form field. It is never read from the active-organization cookie.
 *
 * Accepting binds the producer's verified emissions data to the chosen
 * organization permanently (app.prevent_sharing_grant_fact_change lets
 * grantee_org_id change exactly once, from null) and admits every member
 * of that organization to it. A user belonging to more than one importer
 * organization was previously binding it to whichever one the cookie
 * happened to name, with nothing in the flow surfacing the choice. The
 * server re-validates the submitted id against the caller's own
 * memberships and refuses rather than falling back to a default.
 */
function AcceptSharingGrantItem(
  {
    invitation,
    eligibleOrganizations,
  }: {
    invitation: AcceptableSharingGrantInvitation;
    eligibleOrganizations: EligibleAcceptingOrganization[];
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

  const selectId =
    useId();

  const onlyOrganization =
    eligibleOrganizations.length === 1
      ? eligibleOrganizations[0]
      : null;

  // With exactly one eligible organization there is nothing to choose,
  // so it is preselected and named both in the copy and in the dialog.
  // With more than one, nothing is preselected -- the user picks, and
  // the button stays disabled until they do.
  const [selectedOrgId, setSelectedOrgId] =
    useState<string>(
      onlyOrganization?.orgId ?? "",
    );

  const selectedOrganization =
    eligibleOrganizations.find(
      (organization) =>
        organization.orgId === selectedOrgId,
    ) ?? null;

  return (
    <li className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border-default)] p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col">
          <span className="text-sm font-medium text-[var(--text-primary)]">
            {invitation.grantorOrganizationName}
          </span>

          <span className="text-sm text-[var(--text-secondary)]">
            Wants to share {invitation.installationName}&apos;s emissions
            data with you
          </span>

          {invitation.expiresAt ? (
            <span className="text-xs text-[var(--text-tertiary)]">
              Expires {formatDate(invitation.expiresAt)}
            </span>
          ) : null}
        </div>

        {eligibleOrganizations.length > 0 ? (
          <form
            action={formAction}
            className="flex flex-col items-stretch gap-2 sm:items-end"
          >
            <input
              type="hidden"
              name="grantId"
              value={invitation.grantId}
            />

            {onlyOrganization ? (
              <input
                type="hidden"
                name="orgId"
                value={onlyOrganization.orgId}
              />
            ) : (
              <div className="flex flex-col gap-1">
                <label
                  htmlFor={selectId}
                  className="text-xs font-medium text-[var(--text-secondary)]"
                >
                  Accept into
                </label>

                <select
                  id={selectId}
                  name="orgId"
                  value={selectedOrgId}
                  onChange={(event) =>
                    setSelectedOrgId(event.target.value)
                  }
                  className="h-9 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-default)] px-2 text-sm text-[var(--text-primary)]"
                >
                  <option value="">
                    Choose an organization...
                  </option>

                  {eligibleOrganizations.map(
                    (organization) => (
                      <option
                        key={organization.orgId}
                        value={organization.orgId}
                      >
                        {organization.organizationName}
                      </option>
                    ),
                  )}
                </select>
              </div>
            )}

            <ConfirmSubmitButton
              pending={pending}
              disabled={selectedOrganization === null}
              confirm={{
                title:
                  selectedOrganization
                    ? `Accept shared data into ${selectedOrganization.organizationName}?`
                    : "Accept shared data?",
                description:
                  selectedOrganization
                    ? `Every member of ${selectedOrganization.organizationName} will be able to ` +
                      `read this installation's verified emissions data. The grant is bound to ` +
                      `${selectedOrganization.organizationName} permanently -- ` +
                      `${invitation.grantorOrganizationName} would have to revoke it and invite ` +
                      "you again to move it to a different organization."
                    : undefined,
                confirmLabel:
                  selectedOrganization
                    ? `Accept into ${selectedOrganization.organizationName}`
                    : "Accept",
                cancelLabel: "Cancel",
              }}
            >
              Accept
            </ConfirmSubmitButton>
          </form>
        ) : (
          <Button
            type="button"
            disabled
            title="Join or create an importer / declarant organization first"
          >
            Accept
          </Button>
        )}
      </div>

      {onlyOrganization ? (
        <span className="text-xs text-[var(--text-tertiary)]">
          Accepting into {onlyOrganization.organizationName}.
        </span>
      ) : eligibleOrganizations.length > 1 ? (
        <span className="text-xs text-[var(--text-tertiary)]">
          You belong to more than one importer organization. Choose which
          one this data should be shared with. The choice cannot be
          changed afterwards.
        </span>
      ) : (
        <span className="text-xs text-[var(--text-tertiary)]">
          Shared emissions data can only be accepted into an importer /
          declarant organization. You do not belong to one yet.
        </span>
      )}

      <FieldError>
        {state.status === "error" ? state.message : null}
      </FieldError>
    </li>
  );
}

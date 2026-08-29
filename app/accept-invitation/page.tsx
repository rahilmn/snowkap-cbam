import { redirect } from "next/navigation";

import {
  Wordmark,
} from "../../components/shell/wordmark";

import {
  Card,
} from "../../components/ui/card";

import {
  getServerSupabaseClient,
} from "../../src/infrastructure/supabase/server-client";

import {
  getCurrentOrgSummary,
} from "../../src/application/organizations/get-current-org-context";

import {
  getPreferredOrgId,
} from "../../components/shell/get-preferred-org-id";

import {
  listMyPendingInvitations,
} from "../../src/application/organizations/invitations";

import {
  listMyPendingSharingGrantInvitations,
} from "../../src/application/sharing/manage-sharing-grants";

import {
  AcceptInvitationList,
} from "./accept-invitation-list";

import {
  AcceptSharingGrantList,
} from "./accept-sharing-grant-list";

/**
 * Not under app/(auth) -- that route group is deliberately for the
 * signed-out screens only (see its layout's doc comment). This screen
 * requires a session (RLS -- organization_invitations_select_own_email
 * -- scopes by the caller's authenticated email), so a signed-out
 * visitor is sent to sign in first, same as /onboarding and /team.
 */
export default async function AcceptInvitationPage() {
  const supabase =
    await getServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      "/sign-in",
    );
  }

  const orgSummary =
    await getCurrentOrgSummary(
      supabase,
      await getPreferredOrgId(),
    );

  const [invitations, sharingGrantInvitations] =
    await Promise.all(
      [
        listMyPendingInvitations(
          supabase,
        ),

        listMyPendingSharingGrantInvitations(
          supabase,
          user.email ?? "",
        ),
      ],
    );

  const hasNothingPending =
    invitations.length === 0 &&
    sharingGrantInvitations.length === 0;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-[var(--surface-page)] p-6">
      <Wordmark className="text-lg" />

      <Card className="w-full max-w-md p-6">
        <h1 className="mb-1 text-lg font-semibold text-[var(--text-primary)]">
          Pending invitations
        </h1>

        {hasNothingPending ? (
          <p className="text-sm text-[var(--text-secondary)]">
            No pending invitations for {user.email}.
          </p>
        ) : (
          <p className="mb-4 text-sm text-[var(--text-secondary)]">
            Signed in as {user.email}.
          </p>
        )}

        {invitations.length > 0 ? (
          <AcceptInvitationList
            invitations={invitations.map(
              (item) => (
                {
                  invitationId: item.invitation.id,
                  organizationName: item.organizationName,
                  role: item.invitation.role,
                }
              ),
            )}
          />
        ) : null}

        {sharingGrantInvitations.length > 0 ? (
          <div className={invitations.length > 0 ? "mt-6 flex flex-col gap-2" : "flex flex-col gap-2"}>
            <h2 className="text-sm font-medium text-[var(--text-secondary)]">
              Pending data-sharing invitations
            </h2>

            <AcceptSharingGrantList
              invitations={sharingGrantInvitations.map(
                (item) => (
                  {
                    grantId: item.grant.id,
                    grantorOrganizationName: item.grantorOrganizationName,
                    installationName: item.installationName,
                  }
                ),
              )}
              activeOrganizationName={orgSummary?.organizationName ?? null}
            />
          </div>
        ) : null}
      </Card>
    </div>
  );
}

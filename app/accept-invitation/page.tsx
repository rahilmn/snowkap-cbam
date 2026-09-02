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
  buttonVariants,
} from "../../components/ui/button";

import {
  cn,
} from "../../lib/utils";

import Link from "next/link";

import {
  signOutAction,
} from "../(auth)/actions";

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
          user.email ?? "",
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
          // 2026-09-03 (P14). "No pending invitations" alone told an
          // invitee nothing about WHY, and the three real reasons are
          // all recoverable -- but only if the person knows which one
          // they are in. A real invited user spent a support cycle on
          // exactly this screen.
          //
          // Note the invitee genuinely cannot see a lapsed invitation:
          // organization_invitations_select_own_email carries
          // expires_at > now(), verified against real RLS on 2026-09-03.
          // So expiry has to be explained here rather than shown as a
          // row.
          <div className="flex flex-col gap-3">
            <p className="text-sm text-[var(--text-secondary)]">
              No pending invitations for {user.email}.
            </p>

            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-[var(--text-secondary)]">
              <li>
                Invitations are sent to one specific address. If yours went
                somewhere else, sign out and sign in with that address.
              </li>

              <li>
                Invitations expire after seven days, and an administrator
                can revoke one. Either way, ask them to send a new one.
              </li>

              <li>
                If you were invited but never chose a password, use Set a
                password below and we will email a link to {user.email}.
              </li>
            </ul>

            <div className="mt-1 flex flex-wrap gap-2">
              <Link
                href="/forgot-password"
                className={cn(
                  buttonVariants({ variant: "secondary", size: "sm" }),
                )}
              >
                Set a password
              </Link>

              {orgSummary ? (
                <Link
                  href="/"
                  className={cn(
                    buttonVariants({ variant: "secondary", size: "sm" }),
                  )}
                >
                  Go to dashboard
                </Link>
              ) : (
                <Link
                  href="/onboarding"
                  className={cn(
                    buttonVariants({ variant: "secondary", size: "sm" }),
                  )}
                >
                  Set up an organization
                </Link>
              )}

              <form action={signOutAction}>
                <button
                  type="submit"
                  className={cn(
                    buttonVariants({ variant: "ghost", size: "sm" }),
                  )}
                >
                  Sign out
                </button>
              </form>
            </div>
          </div>
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
                  expiresAt: item.invitation.expires_at,
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
                    expiresAt: item.grant.expires_at,
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

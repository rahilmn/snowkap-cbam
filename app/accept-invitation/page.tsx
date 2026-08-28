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
  listMyPendingInvitations,
} from "../../src/application/organizations/invitations";

import {
  AcceptInvitationList,
} from "./accept-invitation-list";

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

  const invitations =
    await listMyPendingInvitations(
      supabase,
    );

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-[var(--surface-page)] p-6">
      <Wordmark className="text-lg" />

      <Card className="w-full max-w-md p-6">
        <h1 className="mb-1 text-lg font-semibold text-[var(--text-primary)]">
          Pending invitations
        </h1>

        {invitations.length === 0 ? (
          <p className="text-sm text-[var(--text-secondary)]">
            No pending invitations for {user.email}.
          </p>
        ) : (
          <>
            <p className="mb-4 text-sm text-[var(--text-secondary)]">
              Signed in as {user.email}.
            </p>

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
          </>
        )}
      </Card>
    </div>
  );
}

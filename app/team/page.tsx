import { redirect } from "next/navigation";

import {
  AppShell,
} from "../../components/shell/app-shell";

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
  hasAdminAccess,
} from "../../src/application/organizations/org-context";

import {
  listPendingInvitationsForOrg,
} from "../../src/application/organizations/invitations";

import {
  TeamMemberList,
  type TeamMemberRow,
} from "./team-member-list";

import {
  InviteMemberForm,
} from "./invite-member-form";

import {
  PendingInvitationsList,
} from "./pending-invitations-list";

import {
  getPreferredOrgId,
} from "../../components/shell/get-preferred-org-id";

export default async function TeamPage() {
  const supabase =
    await getServerSupabaseClient();

  const orgSummary =
    await getCurrentOrgSummary(
      supabase,
      await getPreferredOrgId(),
    );

  if (!orgSummary) {
    redirect(
      "/onboarding",
    );
  }

  const { data: members, error } =
    await supabase.rpc(
      "list_org_members",
      { p_org_id: orgSummary.context.org_id },
    );

  const memberRows: TeamMemberRow[] =
    error
      ? []
      : (members ?? []).map(
          (
            row: {
              membership_id: string;
              user_id: string;
              email: string;
              role: "OWNER" | "ADMIN" | "MEMBER";
            },
          ) => (
            {
              membershipId: row.membership_id,
              userId: row.user_id,
              email: row.email,
              role: row.role,
            }
          ),
        );

  const canManage =
    hasAdminAccess(
      orgSummary.context,
    );

  const pendingInvitations =
    canManage
      ? await listPendingInvitationsForOrg(
          supabase,
          orgSummary.context.org_id,
        )
      : [];

  return (
    <AppShell
      breadcrumbs={[
        { label: "Team" },
      ]}
      activeNavLabel="Team"
    >
      <h1 className="mb-4 text-2xl font-semibold text-[var(--text-primary)]">
        Team
      </h1>

      <Card className="max-w-2xl">
        {canManage ? (
          <InviteMemberForm />
        ) : null}

        <PendingInvitationsList
          invitations={pendingInvitations.map(
            (invitation) => (
              {
                invitationId: invitation.id,
                email: invitation.email,
                role: invitation.role,
              }
            ),
          )}
        />

        <TeamMemberList
          members={memberRows}
          currentUserId={orgSummary.context.user_id}
          canManage={canManage}
        />
      </Card>
    </AppShell>
  );
}

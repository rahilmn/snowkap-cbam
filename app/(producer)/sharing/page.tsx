import { redirect } from "next/navigation";

import {
  AppShell,
} from "../../../components/shell/app-shell";

import {
  Card,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";

import {
  getServerSupabaseClient,
} from "../../../src/infrastructure/supabase/server-client";

import {
  getCurrentOrgSummary,
} from "../../../src/application/organizations/get-current-org-context";

import {
  hasAdminAccess,
} from "../../../src/application/organizations/org-context";

import {
  getPreferredOrgId,
} from "../../../components/shell/get-preferred-org-id";

import {
  listInstallations,
} from "../../../src/application/installations/manage-installations";

import {
  listSharingGrantsIssued,
} from "../../../src/application/sharing/manage-sharing-grants";

import {
  InviteByEmailForm,
} from "./invite-by-email-form";

import {
  IssuedGrantsList,
  type IssuedGrantRow,
} from "./issued-grants-list";

/**
 * The producer-side "issue a sharing grant" screen -- previously
 * nonexistent (P7-D, 20260829260000, built only the schema + application
 * functions for the direct-org-id grant case; no screen ever issued one).
 * This is that screen's first cut, scoped to the P7-D2 bootstrap-by-email
 * path (20260829300000): a producer invites an importer they don't yet
 * have a known org id for by email, matching the "invite by email"
 * pattern already established for org membership on /team. The direct-
 * org-id path (issueSharingGrant's other branch) has no input here --
 * there is no existing UI or cross-org directory to pick a known
 * grantee org from, and building that lookup UI is out of this slice's
 * scope; issueSharingGrant still accepts a granteeOrgId directly for
 * whenever that surface is built.
 */
export default async function SharingPage() {
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

  const [installations, grants] =
    await Promise.all(
      [
        listInstallations(
          supabase,
          orgSummary.context.org_id,
        ),
        listSharingGrantsIssued(
          supabase,
          orgSummary.context.org_id,
        ),
      ],
    );

  const installationNameById =
    new Map(
      installations.map(
        (installation) => (
          [installation.id, installation.name]
        ),
      ),
    );

  const canManage =
    hasAdminAccess(
      orgSummary.context,
    );

  const grantRows: IssuedGrantRow[] =
    grants.map(
      (grant) => (
        {
          id: grant.id,
          installationName:
            installationNameById.get(grant.installation_id) ?? "Unknown installation",
          granteeLabel:
            grant.invited_email
              ? `Invited: ${grant.invited_email}`
              : "Direct grant",
          status: grant.status,
          canManage,
        }
      ),
    );

  return (
    <AppShell
      experience="producer"
      breadcrumbs={[
        { label: "Sharing" },
      ]}
      activeNavLabel="Sharing"
    >
      <div className="mb-4 flex max-w-2xl items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
          Sharing
        </h1>

        <a
          href="/sharing/status"
          className="text-sm font-medium text-[var(--accent-brand)] hover:underline"
        >
          Shared-data status &rarr;
        </a>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>
            Data-sharing grants
          </CardTitle>
        </CardHeader>

        {canManage ? (
          <InviteByEmailForm
            installations={installations.map(
              (installation) => (
                { id: installation.id, name: installation.name }
              ),
            )}
          />
        ) : null}

        <IssuedGrantsList
          grants={grantRows}
        />
      </Card>
    </AppShell>
  );
}

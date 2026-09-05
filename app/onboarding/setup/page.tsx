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
  getOrganizationSmeProfile,
} from "../../../src/application/organizations/organization-sme-profile";

import {
  OnboardingSetupForm,
} from "./setup-form";

/**
 * The retry/finish path for onboarding-setup (SME plan §7.1) -- where
 * a lost-response reconciliation redirect (app/onboarding/actions.ts)
 * lands, and where an org can (re)declare its sectors afterward.
 * Requires an existing org (this is not the org-creation screen); a
 * user with no membership yet belongs at /onboarding instead.
 */
export default async function OnboardingSetupPage() {
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

  const profile =
    await getOrganizationSmeProfile(
      supabase,
      orgSummary.context.org_id,
    );

  const isAdmin =
    hasAdminAccess(
      orgSummary.context,
    );

  return (
    <AppShell
      breadcrumbs={[
        { label: "Finish setup" },
      ]}
      // Explicit on purpose (components/shell/derive-active-nav-label.ts's
      // own doc comment references this line): /onboarding/setup's
      // pathname matches no real nav item, so pathname-derivation alone
      // would highlight nothing. This keeps the pre-derivation
      // "Dashboard" highlight instead, unchanged since before derived
      // navigation existed -- not a new decision made for this remediation.
      activeNavLabel="Dashboard"
    >
      <h1 className="mb-4 text-2xl font-semibold text-[var(--text-primary)]">
        Finish setting up {orgSummary.organizationName}
      </h1>

      <Card className="max-w-md p-4">
        <CardHeader>
          <CardTitle>
            Sectors
          </CardTitle>
        </CardHeader>

        {isAdmin ? (
          <OnboardingSetupForm
            initialSectors={profile?.sectors ?? []}
          />
        ) : (
          <p className="text-sm text-[var(--text-secondary)]">
            Ask an admin or owner of {orgSummary.organizationName} to
            finish setting up sectors.
          </p>
        )}
      </Card>
    </AppShell>
  );
}

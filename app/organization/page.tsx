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
  getPreferredOrgId,
} from "../../components/shell/get-preferred-org-id";

import {
  getOrganizationProfile,
} from "../../src/application/organizations/organization-profile";

import {
  OrganizationSettingsForm,
} from "./organization-settings-form";

import {
  DangerZone,
} from "./danger-zone";

export default async function OrganizationSettingsPage() {
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

  if (orgSummary.context.role !== "OWNER") {
    redirect(
      "/",
    );
  }

  const organization =
    await getOrganizationProfile(
      supabase,
      orgSummary.context.org_id,
    );

  if (!organization) {
    redirect(
      "/",
    );
  }

  return (
    <AppShell
      breadcrumbs={[
        { label: "Organization" },
      ]}
      activeNavLabel="Organization"
    >
      <h1 className="mb-4 text-2xl font-semibold text-[var(--text-primary)]">
        Organization
      </h1>

      <Card className="max-w-2xl p-6">
        <OrganizationSettingsForm
          organization={{
            name: organization.name,
            eoriNumber: organization.eori_number,
            cbamDeclarantStatus: organization.cbam_declarant_status,
            countryOfEstablishment: organization.country_of_establishment,
            capabilities: organization.capabilities,
          }}
        />
      </Card>

      <div className="mt-6">
        <DangerZone
          organization={{
            id: organization.id,
            slug: organization.slug,
            createdAt: organization.created_at,
          }}
        />
      </div>
    </AppShell>
  );
}

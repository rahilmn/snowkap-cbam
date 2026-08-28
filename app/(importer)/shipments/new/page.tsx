import { redirect } from "next/navigation";

import {
  AppShell,
} from "../../../../components/shell/app-shell";

import {
  Card,
} from "../../../../components/ui/card";

import {
  getServerSupabaseClient,
} from "../../../../src/infrastructure/supabase/server-client";

import {
  getCurrentOrgSummary,
} from "../../../../src/application/organizations/get-current-org-context";

import {
  getPreferredOrgId,
} from "../../../../components/shell/get-preferred-org-id";

import {
  CreateShipmentForm,
} from "./create-shipment-form";

export default async function NewShipmentPage() {
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

  return (
    <AppShell
      breadcrumbs={[
        { label: "Shipments", href: "/shipments" },
        { label: "New" },
      ]}
      activeNavLabel="Shipments"
    >
      <h1 className="mb-4 text-2xl font-semibold text-[var(--text-primary)]">
        New shipment
      </h1>

      <Card className="max-w-md p-6">
        <CreateShipmentForm />
      </Card>
    </AppShell>
  );
}

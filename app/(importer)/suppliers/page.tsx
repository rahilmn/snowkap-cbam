import { redirect } from "next/navigation";

import {
  AppShell,
} from "../../../components/shell/app-shell";

import {
  Card,
} from "../../../components/ui/card";

import {
  getServerSupabaseClient,
} from "../../../src/infrastructure/supabase/server-client";

import {
  getCurrentOrgSummary,
} from "../../../src/application/organizations/get-current-org-context";

import {
  getPreferredOrgId,
} from "../../../components/shell/get-preferred-org-id";

import {
  listSuppliers,
} from "../../../src/application/suppliers/manage-suppliers";

import {
  SupplierForm,
} from "./supplier-form";

import {
  SupplierList,
} from "./supplier-list";

export default async function SuppliersPage() {
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

  const suppliers =
    await listSuppliers(
      supabase,
      orgSummary.context.org_id,
    );

  return (
    <AppShell
      breadcrumbs={[
        { label: "Suppliers" },
      ]}
      activeNavLabel="Suppliers"
    >
      <h1 className="mb-4 text-2xl font-semibold text-[var(--text-primary)]">
        Suppliers
      </h1>

      <Card className="max-w-2xl">
        <SupplierForm />

        <SupplierList
          suppliers={suppliers.map(
            (supplier) => (
              {
                id: supplier.id,
                name: supplier.name,
                country: supplier.country,
                contactEmail: supplier.contact_email,
              }
            ),
          )}
        />
      </Card>
    </AppShell>
  );
}

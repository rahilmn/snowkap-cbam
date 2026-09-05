import Link from "next/link";

import { redirect } from "next/navigation";

import {
  Plus,
} from "lucide-react";

import {
  AppShell,
} from "../../../components/shell/app-shell";

import {
  Card,
} from "../../../components/ui/card";

import {
  Button,
} from "../../../components/ui/button";

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
  listShipments,
} from "../../../src/application/shipments/list-shipments";

import {
  ShipmentsTable,
} from "./shipments-table";

export default async function ShipmentsPage() {
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

  const shipments =
    await listShipments(
      supabase,
      orgSummary.context.org_id,
    );

  return (
    <AppShell
      breadcrumbs={[
        { label: "Shipments" },
      ]}
    >
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
          Shipments
        </h1>

        <Link
          href="/shipments/new"
        >
          <Button>
            <Plus
              className="size-4"
              aria-hidden="true"
            />

            New shipment
          </Button>
        </Link>
      </div>

      <Card>
        <ShipmentsTable
          shipments={shipments}
        />
      </Card>
    </AppShell>
  );
}

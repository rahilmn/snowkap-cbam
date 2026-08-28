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
  Badge,
} from "../../../components/ui/badge";

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
  formatReportingPeriod,
} from "../../../src/domain/shared/reporting-period";

import type {
  ShipmentStatus,
} from "../../../src/domain/shipments/types";

const STATUS_BADGE_TONE: Record<
  ShipmentStatus,
  "neutral" | "brand" | "success" | "warning" | "danger"
> = {
  DRAFT: "neutral",
  READY: "brand",
  LOCKED: "success",
  VOID: "danger",
};

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
      activeNavLabel="Shipments"
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
        {shipments.length === 0 ? (
          <p className="p-6 text-sm text-[var(--text-secondary)]">
            No shipments yet. Create your first shipment to begin
            classifying goods and resolving embedded emissions.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border-default)] text-[var(--text-tertiary)]">
                  <th className="px-4 py-2.5 font-medium">
                    Reference
                  </th>

                  <th className="px-4 py-2.5 font-medium">
                    Release date
                  </th>

                  <th className="px-4 py-2.5 font-medium">
                    Reporting period
                  </th>

                  <th className="px-4 py-2.5 font-medium">
                    Status
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-[var(--border-default)]">
                {shipments.map(
                  (shipment) => (
                    <tr key={shipment.id}>
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/shipments/${shipment.id}`}
                          className="font-medium text-[var(--text-primary)] hover:underline"
                        >
                          {shipment.reference}
                        </Link>
                      </td>

                      <td className="px-4 py-2.5 tabular-nums text-[var(--text-secondary)]">
                        {shipment.release_date}
                      </td>

                      <td className="px-4 py-2.5 tabular-nums text-[var(--text-secondary)]">
                        {formatReportingPeriod(
                          shipment.reporting_period,
                        )}
                      </td>

                      <td className="px-4 py-2.5">
                        <Badge
                          tone={STATUS_BADGE_TONE[shipment.status]}
                        >
                          {shipment.status}
                        </Badge>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </AppShell>
  );
}

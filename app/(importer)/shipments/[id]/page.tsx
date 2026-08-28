import { redirect } from "next/navigation";

import {
  AppShell,
} from "../../../../components/shell/app-shell";

import {
  Card,
} from "../../../../components/ui/card";

import {
  Badge,
} from "../../../../components/ui/badge";

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
  getShipmentDetail,
} from "../../../../src/application/shipments/get-shipment-detail";

import {
  formatReportingPeriod,
} from "../../../../src/domain/shared/reporting-period";

import {
  AddLineForm,
} from "./add-line-form";

import {
  LinesTable,
} from "./lines-table";

import {
  TransitionActions,
} from "./transition-actions";

const STATUS_BADGE_TONE = {
  DRAFT: "neutral" as const,
  READY: "brand" as const,
  LOCKED: "success" as const,
  VOID: "danger" as const,
};

export default async function ShipmentDetailPage(
  {
    params,
  }: {
    params: Promise<{ id: string }>;
  },
) {
  const { id } =
    await params;

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

  const shipment =
    await getShipmentDetail(
      supabase,
      id as never,
    );

  if (!shipment) {
    redirect(
      "/shipments",
    );
  }

  const editable =
    shipment.status === "DRAFT" || shipment.status === "READY";

  return (
    <AppShell
      breadcrumbs={[
        { label: "Shipments", href: "/shipments" },
        { label: shipment.reference },
      ]}
      activeNavLabel="Shipments"
    >
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
            {shipment.reference}
          </h1>

          <Badge
            tone={STATUS_BADGE_TONE[shipment.status]}
          >
            {shipment.status}
          </Badge>
        </div>

        <TransitionActions
          shipmentId={shipment.id}
          status={shipment.status}
          lineCount={shipment.lines.length}
        />
      </div>

      <Card className="mb-4 p-4">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-[var(--text-tertiary)]">
              Release date
            </dt>

            <dd className="tabular-nums text-[var(--text-primary)]">
              {shipment.release_date}
            </dd>
          </div>

          <div>
            <dt className="text-[var(--text-tertiary)]">
              Reporting period
            </dt>

            <dd className="tabular-nums text-[var(--text-primary)]">
              {formatReportingPeriod(
                shipment.reporting_period,
              )}
            </dd>
          </div>

          <div>
            <dt className="text-[var(--text-tertiary)]">
              Customs MRN
            </dt>

            <dd className="text-[var(--text-primary)]">
              {shipment.customs_mrn ?? "—"}
            </dd>
          </div>

          <div>
            <dt className="text-[var(--text-tertiary)]">
              Customs procedure
            </dt>

            <dd className="text-[var(--text-primary)]">
              {shipment.customs_procedure ?? "—"}
            </dd>
          </div>
        </dl>
      </Card>

      <Card className="mb-4">
        <div className="border-b border-[var(--border-default)] p-4">
          <h2 className="text-sm font-medium text-[var(--text-primary)]">
            Lines
          </h2>
        </div>

        <LinesTable
          shipmentId={shipment.id}
          lines={shipment.lines}
          editable={editable}
        />
      </Card>

      {editable ? (
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-primary)]">
            Add a line
          </h2>

          <AddLineForm
            shipmentId={shipment.id}
          />
        </Card>
      ) : null}
    </AppShell>
  );
}

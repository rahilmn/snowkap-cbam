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
  getLatestCalculationsByShipment,
} from "../../../../src/application/calculations/get-latest-calculations";

import {
  listAvailableActualEmissionData,
  type AvailableActualEmissionDataOption,
} from "../../../../src/application/emissions/list-available-actual-data";

import {
  checkActualDeterminationStalenessByShipment,
} from "../../../../src/application/emissions/check-actual-determination-staleness";

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

  const latestCalculations =
    await getLatestCalculationsByShipment(
      supabase,
      shipment.id,
    );

  // Per-line, not org-wide -- listAvailableActualEmissionData now filters
  // by cn_scope against a line's own declared cn_code (see its own doc
  // comment). Fetched once per DISTINCT cn_code among this shipment's
  // lines (not once per line) so two lines declaring the same code don't
  // trigger redundant, identical queries, then fanned back out to every
  // line that declared that code.
  const distinctCnCodes =
    Array.from(
      new Set(
        shipment.lines.map((line) => line.cn_code),
      ),
    );

  const optionsByCnCode =
    new Map(
      await Promise.all(
        distinctCnCodes.map(
          async (cnCode) => (
            [
              cnCode,
              await listAvailableActualEmissionData(
                supabase,
                orgSummary.context.org_id,
                cnCode,
              ),
            ] as const
          ),
        ),
      ),
    );

  const availableActualDataByLineId: Record<string, AvailableActualEmissionDataOption[]> =
    {};

  for (const line of shipment.lines) {
    availableActualDataByLineId[line.id] =
      optionsByCnCode.get(line.cn_code) ?? [];
  }

  // Which ACTUAL-determined lines now have newer producer data available
  // -- purely an informational badge (see EmissionsCell), never anything
  // that changes what determination is actually in force.
  const actualDeterminationStaleness =
    await checkActualDeterminationStalenessByShipment(
      supabase,
      shipment.lines,
      shipment.reporting_period,
    );

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
          latestCalculations={latestCalculations}
          availableActualDataByLineId={availableActualDataByLineId}
          actualDeterminationStaleness={actualDeterminationStaleness}
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

import { redirect } from "next/navigation";

import {
  AppShell,
} from "../../../../components/shell/app-shell";

import {
  Card,
} from "../../../../components/ui/card";

import {
  StatusBadge,
} from "../../../../components/ui/status-badge";

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
  getShipmentEmissionsTotal,
} from "../../../../src/application/calculations/get-shipment-emissions-total";

import {
  markActualOptionsForLine,
  type ActualEmissionDataOptionForLine,
} from "../../../../src/application/emissions/mark-actual-options-for-line";

import {
  listAvailableActualEmissionData,
} from "../../../../src/application/emissions/list-available-actual-data";

import {
  checkActualDeterminationStalenessByShipment,
} from "../../../../src/application/emissions/check-actual-determination-staleness";

import {
  getDefaultReferenceForLine,
} from "../../../../src/application/emissions/get-default-reference-for-line";

import type {
  DefaultReferenceDisplay,
} from "../../../../src/domain/emissions/default-reference";

import {
  getRegulatoryCountryMapper,
  getRegulatoryRepository,
} from "../../../../src/infrastructure/regulatory/get-regulatory-repository";

import {
  formatReportingPeriod,
} from "../../../../src/domain/shared/reporting-period";

import {
  AddLineWizard,
} from "./add-line-wizard";

import {
  LinesTable,
} from "./lines-table";

import {
  TransitionActions,
} from "./transition-actions";

import {
  shipmentStatusKey,
} from "../../../../src/domain/status-vocabulary";

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
      orgSummary.context.org_id,
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
      orgSummary.context.org_id,
      shipment.id,
    );

  // S3 (v2.1.1 §6), prominent result: the one number a user actually
  // came here for. See get-shipment-emissions-total.ts's own doc
  // comment for why a STALE calculation (a line re-determined without
  // being recalculated) must never contribute its superseded figure
  // here -- fixed 2026-09-06 after a fresh independent review (B1).
  const emissionsTotal =
    getShipmentEmissionsTotal(
      shipment.lines,
      latestCalculations,
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

  // Marked PER LINE, on the server: whether choosing a dataset would
  // change anything depends on what that particular line already
  // carries, and the decision is made here from facts the client never
  // receives (the record's evidence set, its verifier -- who for shared
  // data is a member of another organization -- and the grant it is
  // read through). Only the resulting boolean is sent, so the disabled
  // control and the server's own refusal cannot disagree.
  const availableActualDataByLineId: Record<string, ActualEmissionDataOptionForLine[]> =
    {};

  for (const line of shipment.lines) {
    const listing =
      optionsByCnCode.get(line.cn_code);

    availableActualDataByLineId[line.id] =
      listing === undefined
        ? []
        : markActualOptionsForLine(
            listing,
            line.emission_determination,
          );
  }

  // Which ACTUAL-determined lines now have newer producer data available
  // -- purely an informational badge (see EmissionsCell), never anything
  // that changes what determination is actually in force.
  const actualDeterminationStaleness =
    await checkActualDeterminationStalenessByShipment(
      supabase,
      orgSummary.context.org_id,
      shipment.lines,
      shipment.reporting_period,
    );

  // S3 (v2.1.1 §9), default reference display: pure context for a line
  // determined from ACTUAL data -- "what would the regulatory default
  // say for this same classification/origin/route", never used in any
  // calculation. Only fetched for ACTUAL-determined lines: a
  // DEFAULT-determined line's own "Regulatory determination" section
  // already shows these exact figures live, so a second reference
  // fetch for it would be pure duplication.
  const regulatoryRepository =
    getRegulatoryRepository();

  const regulatoryCountryMapper =
    getRegulatoryCountryMapper();

  const actualDeterminedLines =
    shipment.lines.filter(
      (line) => line.emission_determination?.method === "ACTUAL",
    );

  const defaultReferenceByLineId: Record<string, DefaultReferenceDisplay> =
    Object.fromEntries(
      await Promise.all(
        actualDeterminedLines.map(
          async (line) => (
            [
              line.id,
              await getDefaultReferenceForLine(
                supabase,
                regulatoryRepository,
                regulatoryCountryMapper,
                orgSummary.context.org_id,
                {
                  shipmentId: shipment.id,
                  cnCode: line.cn_code,
                  originCountry: line.origin_country,
                  productionRouteIndicator: line.production_route?.source_route_indicator ?? null,
                },
              ),
            ] as const
          ),
        ),
      ),
    );

  const editable =
    shipment.status === "DRAFT" || shipment.status === "READY";

  return (
    <AppShell
      breadcrumbs={[
        { label: "Shipments", href: "/shipments" },
        { label: shipment.reference },
      ]}
    >
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
            {shipment.reference}
          </h1>

          <StatusBadge
            statusKey={shipmentStatusKey(shipment.status)}
          />
        </div>

        <TransitionActions
          shipmentId={shipment.id}
          status={shipment.status}
          lineCount={shipment.lines.length}
        />
      </div>

      <Card className="mb-4 p-4">
        <p className="text-xs font-medium text-[var(--text-tertiary)]">
          Total embedded emissions
        </p>

        {emissionsTotal.status === "NONE" ? (
          <p className="mt-1 text-lg font-medium text-[var(--text-secondary)]">
            Not yet calculated
          </p>
        ) : (
          <>
            <p className="mt-1 text-3xl font-semibold tabular-nums text-[var(--text-primary)]">
              {emissionsTotal.total_tco2e}
              {" "}
              <span className="text-base font-normal text-[var(--text-tertiary)]">
                tCO2e
              </span>
            </p>

            {emissionsTotal.status === "PARTIAL" ? (
              <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                {emissionsTotal.calculatedLineCount} of{" "}
                {emissionsTotal.totalLineCount} lines calculated so far
              </p>
            ) : null}
          </>
        )}
      </Card>

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
          defaultReferenceByLineId={defaultReferenceByLineId}
        />
      </Card>

      {editable ? (
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-primary)]">
            Add a line
          </h2>

          <AddLineWizard
            shipmentId={shipment.id}
          />
        </Card>
      ) : null}
    </AppShell>
  );
}

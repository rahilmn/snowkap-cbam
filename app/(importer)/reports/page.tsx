import { redirect } from "next/navigation";

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
  PeriodPicker,
} from "../../../components/reporting/period-picker";

import {
  ExportPeriodCsvButton,
} from "../../../components/reporting/export-period-csv-button";

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
  buildPeriodSummary,
  type IncompletePeriodLine,
  type PeriodBreakdownEntry,
  type PeriodSummary,
} from "../../../src/application/reporting/build-period-summary";

import {
  buildPeriodExportRows,
} from "../../../src/application/reporting/build-period-export-rows";

import {
  parsePeriodParams,
} from "../../../src/application/reporting/parse-period-params";

import {
  formatReportingPeriod,
} from "../../../src/domain/shared/reporting-period";

const DETERMINATION_METHOD_TONE: Record<string, "neutral" | "brand" | "warning"> = {
  DEFAULT: "brand",
  ACTUAL: "brand",
  NOT_DETERMINED: "warning",
};

/**
 * Master plan §27 screen 21 ("Reports" -- period totals + CSV/XLSX
 * export). The period lives entirely in the URL (`?year=&quarter=`,
 * parsed by parsePeriodParams -- see that module's own doc comment) so
 * a report for a specific period is a bookmarkable/shareable link, the
 * same "URL state" convention app/(importer)/audit/page.tsx already
 * established for its filters.
 *
 * MEMBER+, read-only: no admin gate beyond being signed in with an org,
 * matching every other MEMBER+ screen in this codebase (shipments/page.tsx,
 * audit/page.tsx's own doc comment cites the same precedent for the
 * identical reasoning).
 */
export default async function ReportsPage(
  {
    searchParams,
  }: {
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
  },
) {
  const params =
    await searchParams;

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

  const period =
    parsePeriodParams(
      {
        year: params.year,
        quarter: params.quarter,
      },
    );

  const yearValue =
    typeof params.year === "string" ? params.year : "";

  const quarterValue =
    typeof params.quarter === "string" ? params.quarter : "";

  const summary =
    period
      ? await buildPeriodSummary(
          supabase,
          orgSummary.context.org_id,
          period,
        )
      : null;

  const exportRows =
    period
      ? await buildPeriodExportRows(
          supabase,
          orgSummary.context.org_id,
          period,
        )
      : [];

  const exportQuery =
    period
      ? `?year=${period.year}${period.kind === "QUARTERLY" ? `&quarter=${period.quarter}` : ""}`
      : "";

  return (
    <AppShell
      breadcrumbs={[
        { label: "Reports" },
      ]}
      activeNavLabel="Reports"
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-1">
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
            Reports
          </h1>

          <p className="text-sm text-[var(--text-secondary)]">
            Period totals, breakdowns, and a full per-line export --
            Snowkap&apos;s own preparation summary for your records, not a
            replica of the official CBAM registry filing form.
          </p>
        </div>

        {period && exportRows.length > 0 ? (
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex items-center gap-2">
              <ExportPeriodCsvButton
                rows={exportRows}
                filename={`period-report-${formatReportingPeriod(period)}.csv`}
              />

              <a
                href={`/api/reports/export${exportQuery}`}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface-raised)] px-4 text-sm font-medium text-[var(--text-primary)] transition-colors duration-150 hover:bg-[var(--surface-sunken)]"
              >
                Export XLSX
              </a>
            </div>

            {/*
              * 2026-09-03 (P14). The XLSX has a Notes sheet to carry
              * this; the CSV has no notes surface at all, so the
              * sentence lives beside the buttons where it applies to
              * both. Without it, a spreadsheet named for a reporting
              * period reads as the period's filed figure -- which it is
              * not, and the difference is not cosmetic: this includes
              * DRAFT shipments that no declaration has ever frozen.
              */}
            <p className="max-w-md text-right text-xs text-[var(--text-tertiary)]">
              A live re-read of the period, not a filed declaration. It
              includes DRAFT and READY shipments, and installation names
              reflect current visibility. The authoritative filed figure
              is the declaration&apos;s own snapshot.
            </p>
          </div>
        ) : null}
      </div>

      <PeriodPicker
        year={yearValue}
        quarter={quarterValue}
      />

      {!period || !summary ? (
        <Card>
          <p className="p-6 text-sm text-[var(--text-secondary)]">
            Pick a reporting period above to see its report.
          </p>
        </Card>
      ) : (
        <ReportBody
          summary={summary}
        />
      )}
    </AppShell>
  );
}

function ReportBody(
  {
    summary,
  }: {
    summary: PeriodSummary;
  },
) {
  const periodLabel =
    formatReportingPeriod(
      summary.period,
    );

  if (summary.shipment_count === 0) {
    return (
      <Card>
        <p className="p-6 text-sm text-[var(--text-secondary)]">
          No shipments in {periodLabel} yet.
        </p>
      </Card>
    );
  }

  if (summary.line_count === 0) {
    return (
      <Card>
        <p className="p-6 text-sm text-[var(--text-secondary)]">
          {summary.shipment_count} shipment(s) exist in {periodLabel}, but
          none have any lines yet.
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {summary.calculated_line_count === 0 ? (
        <div className="rounded-[var(--radius-md)] bg-[var(--color-warning-100)] px-4 py-3 text-sm text-[var(--color-warning-700)]">
          {summary.line_count} line(s) exist in {periodLabel}, but none are
          calculated yet -- see the list below.
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile
          label="Shipments"
          value={String(summary.shipment_count)}
        />

        <KpiTile
          label="Lines"
          value={String(summary.line_count)}
        />

        <KpiTile
          label="Calculated lines"
          value={`${summary.calculated_line_count} / ${summary.line_count}`}
        />

        <KpiTile
          label="Total embedded emissions"
          value={
            summary.total_embedded_emissions_tco2e !== null
              ? `${summary.total_embedded_emissions_tco2e} tCO2e`
              : "Not yet available"
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BreakdownCard
          title="By CN / TARIC code"
          entries={summary.breakdown_by_cn_code}
        />

        <BreakdownCard
          title="By origin country"
          entries={summary.breakdown_by_origin_country}
        />

        <BreakdownCard
          title="By production route"
          entries={summary.breakdown_by_production_route}
        />

        <BreakdownCard
          title="By determination method"
          entries={summary.breakdown_by_determination_method}
          toneByKey={DETERMINATION_METHOD_TONE}
        />
      </div>

      <IncompleteLinesCard
        lines={summary.incomplete_lines}
      />
    </div>
  );
}

function KpiTile(
  {
    label,
    value,
  }: {
    label: string;
    value: string;
  },
) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <span className="text-xs text-[var(--text-tertiary)]">
        {label}
      </span>

      <span className="font-mono text-lg font-semibold tabular-nums text-[var(--text-primary)]">
        {value}
      </span>
    </Card>
  );
}

function BreakdownCard(
  {
    title,
    entries,
    toneByKey,
  }: {
    title: string;
    entries: PeriodBreakdownEntry[];
    toneByKey?: Record<string, "neutral" | "brand" | "warning">;
  },
) {
  return (
    <Card>
      <div className="border-b border-[var(--border-default)] p-4">
        <h2 className="text-sm font-medium text-[var(--text-primary)]">
          {title}
        </h2>
      </div>

      {entries.length === 0 ? (
        <p className="p-4 text-sm text-[var(--text-secondary)]">
          No lines.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border-default)] text-[var(--text-tertiary)]">
                <th className="px-4 py-2 font-medium">

                </th>

                <th className="px-4 py-2 font-medium">
                  Lines
                </th>

                <th className="px-4 py-2 font-medium">
                  Emissions (tCO2e)
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-[var(--border-default)]">
              {entries.map(
                (entry) => (
                  <tr key={entry.key}>
                    <td className="px-4 py-2">
                      {toneByKey ? (
                        <Badge tone={toneByKey[entry.key] ?? "neutral"}>
                          {entry.key}
                        </Badge>
                      ) : (
                        <span className="text-[var(--text-primary)]">
                          {entry.key}
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-2 tabular-nums text-[var(--text-secondary)]">
                      {entry.calculated_line_count} / {entry.line_count}
                    </td>

                    <td className="px-4 py-2 font-mono tabular-nums text-[var(--text-secondary)]">
                      {entry.embedded_emissions_tco2e ?? "—"}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function IncompleteLinesCard(
  {
    lines,
  }: {
    lines: IncompletePeriodLine[];
  },
) {
  return (
    <Card>
      <div className="border-b border-[var(--border-default)] p-4">
        <h2 className="text-sm font-medium text-[var(--text-primary)]">
          Not yet complete
        </h2>

        <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">
          Lines with no determination yet, or determined but not yet
          calculated -- excluded from the totals above.
        </p>
      </div>

      {lines.length === 0 ? (
        <p className="p-4 text-sm text-[var(--text-secondary)]">
          Every line in this period is determined and calculated.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border-default)] text-[var(--text-tertiary)]">
                <th className="px-4 py-2 font-medium">
                  Shipment
                </th>

                <th className="px-4 py-2 font-medium">
                  Line
                </th>

                <th className="px-4 py-2 font-medium">
                  CN / TARIC code
                </th>

                <th className="px-4 py-2 font-medium">
                  Why
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-[var(--border-default)]">
              {lines.map(
                (line) => (
                  <tr key={line.line_id}>
                    <td className="px-4 py-2 text-[var(--text-primary)]">
                      {line.shipment_reference}
                    </td>

                    <td className="px-4 py-2 tabular-nums text-[var(--text-secondary)]">
                      {line.line_number}
                    </td>

                    <td className="px-4 py-2 tabular-nums text-[var(--text-secondary)]">
                      {line.cn_code}
                    </td>

                    <td className="px-4 py-2">
                      <Badge tone="warning">
                        {line.reason === "NO_DETERMINATION"
                          ? "Not determined"
                          : "Not calculated"}
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
  );
}

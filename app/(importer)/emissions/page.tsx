import Link from "next/link";

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
  getServerSupabaseClient,
} from "../../../src/infrastructure/supabase/server-client";

import {
  getCurrentOrgSummary,
} from "../../../src/application/organizations/get-current-org-context";

import {
  getPreferredOrgId,
} from "../../../components/shell/get-preferred-org-id";

import {
  listActualDeterminedLines,
  type ActualDeterminedLineOverviewRow,
} from "../../../src/application/emissions/list-actual-determined-lines";

import {
  listAvailableActualEmissionData,
  type AvailableActualEmissionDataOption,
} from "../../../src/application/emissions/list-available-actual-data";

import {
  formatReportingPeriod,
} from "../../../src/domain/shared/reporting-period";

const PROVENANCE_TONE = {
  OWN: "neutral" as const,
  SHARED: "brand" as const,
};

function formatMethodology(
  methodology: string,
): string {
  return methodology.replace(
    /_/g,
    " ",
  );
}

export default async function EmissionsPage() {
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

  // listAvailableActualEmissionData(..., null) -- the unscoped "browse
  // everything" mode that function's own doc comment describes -- rather
  // than listActualDeterminedLines' own per-line calls, since this
  // screen's second section is a catalog of what's AVAILABLE to draw on,
  // not what's already in force on any particular line (see this file's
  // "Shared-in producer data" section below). Narrowed to SHARED rows
  // only here: an org's own data isn't "shared-in," and the
  // determinations-overview section above already covers own-data usage.
  const [
    determinedLines,
    availableActualData,
  ] =
    await Promise.all(
      [
        listActualDeterminedLines(
          supabase,
          orgSummary.context.org_id,
        ),
        listAvailableActualEmissionData(
          supabase,
          orgSummary.context.org_id,
          null,
        ),
      ],
    );

  const sharedInData =
    availableActualData.filter(
      (option) => option.provenance === "SHARED",
    );

  return (
    <AppShell
      breadcrumbs={[
        { label: "Emissions" },
      ]}
      activeNavLabel="Emissions"
    >
      <div className="mb-4">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
          Emissions
        </h1>

        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          A read-only overview of every actual-data determination across your
          shipments, and the producer data shared with your organization.
          Set or change a line&apos;s determination from its shipment.
        </p>
      </div>

      <Card className="mb-4">
        <div className="border-b border-[var(--border-default)] p-4">
          <h2 className="text-sm font-medium text-[var(--text-primary)]">
            Determinations overview
          </h2>

          <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">
            Every shipment line currently determined from actual data.
          </p>
        </div>

        <DeterminedLinesTable
          lines={determinedLines}
        />
      </Card>

      <Card>
        <div className="border-b border-[var(--border-default)] p-4">
          <h2 className="text-sm font-medium text-[var(--text-primary)]">
            Shared-in producer data
          </h2>

          <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">
            Verified data other organizations have shared with you, available
            to determine a line from.
          </p>
        </div>

        <SharedInDataTable
          options={sharedInData}
        />
      </Card>
    </AppShell>
  );
}

function DeterminedLinesTable(
  {
    lines,
  }: {
    lines: ActualDeterminedLineOverviewRow[];
  },
) {
  if (lines.length === 0) {
    return (
      <p className="p-6 text-sm text-[var(--text-secondary)]">
        No shipment lines are determined from actual data yet. Use a
        line&apos;s emissions cell on its shipment detail page to determine
        it from your own or a shared producer&apos;s verified data.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--border-default)] text-[var(--text-tertiary)]">
            <th className="px-4 py-2.5 font-medium">
              Shipment
            </th>

            <th className="px-4 py-2.5 font-medium">
              Line
            </th>

            <th className="px-4 py-2.5 font-medium">
              CN / TARIC code
            </th>

            <th className="px-4 py-2.5 font-medium">
              Origin
            </th>

            <th className="px-4 py-2.5 font-medium">
              Methodology
            </th>

            <th className="px-4 py-2.5 font-medium">
              Provenance
            </th>

            <th className="px-4 py-2.5 font-medium">
              Status
            </th>
          </tr>
        </thead>

        <tbody className="divide-y divide-[var(--border-default)]">
          {lines.map(
            (line) => (
              <tr key={line.line_id}>
                <td className="px-4 py-2.5">
                  <Link
                    href={`/shipments/${line.shipment_id}`}
                    className="font-medium text-[var(--text-primary)] hover:underline"
                  >
                    {line.shipment_reference}
                  </Link>
                </td>

                <td className="px-4 py-2.5 tabular-nums text-[var(--text-secondary)]">
                  {line.line_number}
                </td>

                <td className="px-4 py-2.5">
                  <span className="font-medium tabular-nums text-[var(--text-primary)]">
                    {line.cn_code}
                  </span>

                  {line.goods_description ? (
                    <span className="block text-xs text-[var(--text-tertiary)]">
                      {line.goods_description}
                    </span>
                  ) : null}
                </td>

                <td className="px-4 py-2.5 tabular-nums text-[var(--text-secondary)]">
                  {line.origin_country}
                </td>

                <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                  {formatMethodology(
                    line.methodology,
                  )}
                </td>

                <td className="px-4 py-2.5">
                  <div className="flex flex-col gap-1">
                    <Badge
                      tone={PROVENANCE_TONE[line.provenance]}
                    >
                      {line.provenance === "OWN"
                        ? "Own data"
                        : `Shared by ${line.grantor_organization_name}`}
                    </Badge>

                    {/*
                      The frozen snapshot stays valid and attributable
                      after the grant ends -- that is what freezing it is
                      for -- but the reader should not have to guess that
                      the sharing relationship behind a historical number
                      is still live. Names the past accurately above, the
                      present accurately here.
                    */}
                    {line.sharing_grant_status === "REVOKED" ? (
                      <span className="text-[11px] text-[var(--text-tertiary)]">
                        Access since revoked
                      </span>
                    ) : null}

                    {line.sharing_grant_status === "EXPIRED" ? (
                      <span className="text-[11px] text-[var(--text-tertiary)]">
                        Access since expired
                      </span>
                    ) : null}
                  </div>
                </td>

                <td className="px-4 py-2.5">
                  {line.staleness === "STALE" ? (
                    <Badge tone="warning">
                      Stale — newer data available
                    </Badge>
                  ) : (
                    <Badge tone="success">
                      Current
                    </Badge>
                  )}
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

function SharedInDataTable(
  {
    options,
  }: {
    options: AvailableActualEmissionDataOption[];
  },
) {
  if (options.length === 0) {
    return (
      <p className="p-6 text-sm text-[var(--text-secondary)]">
        No producer data has been shared with your organization yet. Ask a
        producer to issue a sharing grant for one of their installations.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--border-default)] text-[var(--text-tertiary)]">
            <th className="px-4 py-2.5 font-medium">
              Installation
            </th>

            <th className="px-4 py-2.5 font-medium">
              Shared by
            </th>

            <th className="px-4 py-2.5 font-medium">
              Direct
            </th>

            <th className="px-4 py-2.5 font-medium">
              Indirect
            </th>

            <th className="px-4 py-2.5 font-medium">
              Methodology
            </th>

            <th className="px-4 py-2.5 font-medium">
              Reporting period
            </th>
          </tr>
        </thead>

        <tbody className="divide-y divide-[var(--border-default)]">
          {options.map(
            (option) => (
              <tr key={option.emission_data_id}>
                <td className="px-4 py-2.5">
                  <span className="font-medium text-[var(--text-primary)]">
                    {option.installation_name}
                  </span>

                  <span className="block text-xs text-[var(--text-tertiary)]">
                    {option.installation_country}
                  </span>
                </td>

                <td className="px-4 py-2.5">
                  <Badge tone="brand">
                    {option.grantor_organization_name}
                  </Badge>
                </td>

                <td className="px-4 py-2.5 font-mono tabular-nums text-[var(--text-secondary)]">
                  {option.direct_specific} {option.emission_unit}
                </td>

                <td className="px-4 py-2.5 font-mono tabular-nums text-[var(--text-secondary)]">
                  {option.indirect_specific} {option.emission_unit}
                </td>

                <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                  {formatMethodology(
                    option.methodology,
                  )}
                </td>

                <td className="px-4 py-2.5 tabular-nums text-[var(--text-secondary)]">
                  {formatReportingPeriod(
                    option.reporting_period,
                  )}
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

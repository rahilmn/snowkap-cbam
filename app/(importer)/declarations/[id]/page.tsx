import Link from "next/link";

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
  hasAdminAccess,
} from "../../../../src/application/organizations/org-context";

import {
  getPreferredOrgId,
} from "../../../../components/shell/get-preferred-org-id";

import {
  getDeclarationDetail,
} from "../../../../src/application/declarations/get-declaration-detail";

import {
  formatReportingPeriod,
} from "../../../../src/domain/shared/reporting-period";

import type {
  DeclarationStatus,
} from "../../../../src/domain/declarations/types";

import type {
  ShipmentStatus,
} from "../../../../src/domain/shipments/types";

import {
  DeclarationActions,
} from "./declaration-actions";

import {
  CompletenessReportCard,
} from "./completeness-report-card";

import {
  FiledSnapshotCard,
} from "./filed-snapshot-card";

const DECLARATION_STATUS_TONE: Record<
  DeclarationStatus,
  "neutral" | "brand" | "success" | "danger"
> = {
  DRAFT: "neutral",
  READY: "brand",
  FILED_RECORDED: "success",
  VOID: "danger",
};

const SHIPMENT_STATUS_TONE: Record<
  ShipmentStatus,
  "neutral" | "brand" | "success" | "danger"
> = {
  DRAFT: "neutral",
  READY: "brand",
  LOCKED: "success",
  VOID: "danger",
};

/**
 * Master plan §27 screen 22 detail view -- status, the completeness
 * report with named blockers, member shipments, the amendment chain in
 * both directions, the filed snapshot once FILED_RECORDED (see
 * filed-snapshot-card.tsx for this screen's own regulatory-honesty
 * rendering), and every mutating action (declaration-actions.tsx).
 * Gated at the whole-screen level, matching the list screen's own doc
 * comment for why (§27 names screen 22 itself ADMIN+, not a read/write
 * split).
 */
export default async function DeclarationDetailPage(
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

  if (!hasAdminAccess(orgSummary.context)) {
    return (
      <AppShell
        breadcrumbs={[
          { label: "Declarations", href: "/declarations" },
          { label: "Detail" },
        ]}
        activeNavLabel="Declarations"
      >
        <Card>
          <p className="p-6 text-sm text-[var(--text-secondary)]">
            Declaration preparation requires ADMIN or OWNER access. Ask
            an admin on your team to review or file this declaration.
          </p>
        </Card>
      </AppShell>
    );
  }

  const detail =
    await getDeclarationDetail(
      supabase,
      orgSummary.context.org_id,
      id as never,
    );

  if (!detail) {
    redirect(
      "/declarations",
    );
  }

  const { declaration, member_shipments: memberShipments, supersedes, superseded_by: supersededBy } =
    detail;

  const periodLabel =
    formatReportingPeriod(
      declaration.reporting_period,
    );

  return (
    <AppShell
      breadcrumbs={[
        { label: "Declarations", href: "/declarations" },
        { label: periodLabel },
      ]}
      activeNavLabel="Declarations"
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
            {periodLabel}
          </h1>

          <Badge tone={DECLARATION_STATUS_TONE[declaration.status]}>
            {declaration.status.replace(/_/g, " ")}
          </Badge>

          {declaration.supersedes_declaration_id ? (
            <Badge tone="neutral">
              Amendment
            </Badge>
          ) : null}
        </div>

        <DeclarationActions
          declarationId={declaration.id}
          status={declaration.status}
          reportingPeriodYear={declaration.reporting_period.year}
          reportingPeriodQuarter={
            declaration.reporting_period.kind === "QUARTERLY"
              ? declaration.reporting_period.quarter
              : null
          }
          hasActiveSuccessor={supersededBy !== null}
        />
      </div>

      {(supersedes || supersededBy) ? (
        <Card className="mb-4 p-4">
          <h2 className="mb-2 text-sm font-medium text-[var(--text-primary)]">
            Amendment chain
          </h2>

          <div className="flex flex-col gap-1.5 text-sm">
            {supersedes ? (
              <p className="text-[var(--text-secondary)]">
                Supersedes{" "}
                <Link
                  href={`/declarations/${supersedes.id}`}
                  className="font-medium text-[var(--text-primary)] hover:underline"
                >
                  the prior version
                </Link>{" "}
                ({supersedes.status.replace(/_/g, " ")}
                {supersedes.filed_reference ? `, filed "${supersedes.filed_reference}"` : ""}).
              </p>
            ) : null}

            {supersededBy ? (
              <p className="text-[var(--text-secondary)]">
                Superseded by{" "}
                <Link
                  href={`/declarations/${supersededBy.id}`}
                  className="font-medium text-[var(--text-primary)] hover:underline"
                >
                  a later amendment
                </Link>{" "}
                ({supersededBy.status.replace(/_/g, " ")}) -- this is no
                longer the current version of this period.
              </p>
            ) : null}
          </div>
        </Card>
      ) : null}

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CompletenessReportCard
          report={declaration.completeness_report}
        />

        <Card>
          <div className="border-b border-[var(--border-default)] p-4">
            <h2 className="text-sm font-medium text-[var(--text-primary)]">
              Member shipments
            </h2>

            <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">
              {declaration.status === "DRAFT"
                ? "Every shipment in this org and period -- refreshed each time the draft is generated."
                : "Frozen at the moment this declaration was marked ready."}
            </p>
          </div>

          {memberShipments.length === 0 ? (
            <p className="p-4 text-sm text-[var(--text-secondary)]">
              No member shipments yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-default)] text-[var(--text-tertiary)]">
                    <th className="px-4 py-2 font-medium">
                      Reference
                    </th>

                    <th className="px-4 py-2 font-medium">
                      Status
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-[var(--border-default)]">
                  {memberShipments.map(
                    (shipment) => (
                      <tr key={shipment.id}>
                        <td className="px-4 py-2">
                          <Link
                            href={`/shipments/${shipment.id}`}
                            className="font-medium text-[var(--text-primary)] hover:underline"
                          >
                            {shipment.reference}
                          </Link>
                        </td>

                        <td className="px-4 py-2">
                          <Badge tone={SHIPMENT_STATUS_TONE[shipment.status]}>
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
      </div>

      <FiledSnapshotCard
        filedSnapshot={declaration.filed_snapshot}
        filedReference={declaration.filed_reference}
        filedAt={declaration.filed_at}
      />
    </AppShell>
  );
}

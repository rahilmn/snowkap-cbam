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
  hasAdminAccess,
} from "../../../src/application/organizations/org-context";

import {
  getPreferredOrgId,
} from "../../../components/shell/get-preferred-org-id";

import {
  listDeclarations,
} from "../../../src/application/declarations/list-declarations";

import {
  formatReportingPeriod,
} from "../../../src/domain/shared/reporting-period";

import {
  formatTimestamp,
} from "../../../lib/utils";

import type {
  DeclarationStatus,
} from "../../../src/domain/declarations/types";

import {
  StartDeclarationForm,
} from "./start-declaration-form";

const STATUS_BADGE_TONE: Record<
  DeclarationStatus,
  "neutral" | "brand" | "success" | "warning" | "danger"
> = {
  DRAFT: "neutral",
  READY: "brand",
  FILED_RECORDED: "success",
  VOID: "danger",
};

/**
 * Master plan §27 screen 22 ("Declaration preparation" -- ADMIN+). Gated
 * at the WHOLE-screen level (not merely per-action) deliberately: unlike
 * Reports (screen 21, explicitly MEMBER+) or Sharing (screen 31, MEMBER+
 * read / ADMIN+ write), §27 names 22 itself as "ADMIN+" with no read/
 * write split -- declarations_select_own_org's own RLS (20260829330000)
 * is intentionally wider (MEMBER+, matching that migration's own
 * "hiding the row from a MEMBER would only make the shipment LOCK they
 * can already see inexplicable" reasoning), so this screen-level gate is
 * a product decision layered on top of a DB that would technically also
 * serve a MEMBER, not a redundant restatement of RLS.
 */
export default async function DeclarationsPage() {
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
          { label: "Declarations" },
        ]}
        activeNavLabel="Declarations"
      >
        <h1 className="mb-4 text-2xl font-semibold text-[var(--text-primary)]">
          Declarations
        </h1>

        <Card>
          <p className="p-6 text-sm text-[var(--text-secondary)]">
            Declaration preparation requires ADMIN or OWNER access. Ask
            an admin on your team to start, review, or file a
            declaration.
          </p>
        </Card>
      </AppShell>
    );
  }

  const declarations =
    await listDeclarations(
      supabase,
      orgSummary.context.org_id,
    );

  return (
    <AppShell
      breadcrumbs={[
        { label: "Declarations" },
      ]}
      activeNavLabel="Declarations"
    >
      <div className="mb-4 flex max-w-3xl flex-col gap-1">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
          Declarations
        </h1>

        <p className="text-sm text-[var(--text-secondary)]">
          Snowkap&apos;s own preparation summary for each reporting
          period, for your records -- not a replica of the official CBAM
          registry submission form. The authorised declarant files
          through the official channel themselves; Snowkap prepares,
          explains, archives, and records.
        </p>
      </div>

      <Card className="mb-4 max-w-3xl p-4">
        <h2 className="mb-3 text-sm font-medium text-[var(--text-primary)]">
          Start a declaration
        </h2>

        <StartDeclarationForm />
      </Card>

      <Card className="max-w-3xl">
        {declarations.length === 0 ? (
          <p className="p-6 text-sm text-[var(--text-secondary)]">
            No declarations yet. Pick a reporting period above to start
            one.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border-default)] text-[var(--text-tertiary)]">
                  <th className="px-4 py-2.5 font-medium">
                    Period
                  </th>

                  <th className="px-4 py-2.5 font-medium">
                    Status
                  </th>

                  <th className="px-4 py-2.5 font-medium">
                    Amendment
                  </th>

                  <th className="px-4 py-2.5 font-medium">
                    Filed
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-[var(--border-default)]">
                {declarations.map(
                  (declaration) => (
                    <tr key={declaration.id}>
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/declarations/${declaration.id}`}
                          className="font-medium text-[var(--text-primary)] hover:underline"
                        >
                          {formatReportingPeriod(declaration.reporting_period)}
                        </Link>
                      </td>

                      <td className="px-4 py-2.5">
                        <Badge tone={STATUS_BADGE_TONE[declaration.status]}>
                          {declaration.status.replace(/_/g, " ")}
                        </Badge>
                      </td>

                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                        {declaration.supersedes_declaration_id ? "Amendment" : "Original"}
                      </td>

                      <td className="px-4 py-2.5 tabular-nums text-[var(--text-secondary)]">
                        {declaration.filed_at ? formatTimestamp(declaration.filed_at) : "—"}
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

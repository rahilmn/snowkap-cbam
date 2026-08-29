import { redirect } from "next/navigation";

import {
  AppShell,
} from "../../components/shell/app-shell";

import {
  Badge,
  type BadgeProps,
} from "../../components/ui/badge";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";

import {
  getServerSupabaseClient,
} from "../../src/infrastructure/supabase/server-client";

import {
  getCurrentOrgSummary,
} from "../../src/application/organizations/get-current-org-context";

import {
  getPreferredOrgId,
} from "../../components/shell/get-preferred-org-id";

import {
  checkActiveDefaultEmissionValuesDataset,
  type ActiveDefaultEmissionValuesDatasetStatus,
} from "../../src/application/regulatory/check-active-default-emission-values-dataset";

import {
  listActiveRegulatoryDatasets,
  type ActiveRegulatoryDataset,
} from "../../src/application/regulatory/list-active-regulatory-datasets";

function formatTimestamp(
  iso: string,
): string {
  return new Date(
    iso,
  ).toLocaleString(
    "en-GB",
    {
      dateStyle: "medium",
      timeStyle: "short",
    },
  );
}

const DATASET_STATUS_LABEL: Record<
  ActiveDefaultEmissionValuesDatasetStatus,
  string
> = {
  ok:
    "Exactly one ACTIVE dataset",

  missing:
    "No ACTIVE dataset found",

  duplicate:
    "More than one ACTIVE dataset",

  error:
    "Unable to check",
};

const DATASET_STATUS_TONE: Record<
  ActiveDefaultEmissionValuesDatasetStatus,
  BadgeProps["tone"]
> = {
  ok: "success",
  missing: "danger",
  duplicate: "warning",
  error: "danger",
};

/**
 * Master plan §27 screen 6: "System/status -- trust surface; app
 * version (GIT_SHA), ACTIVE dataset versions + verification
 * timestamps, job health · read all." Filed under §27's "Shared/auth"
 * bucket (alongside sign-in, onboarding, the org switcher, and user
 * profile), not either experience's own screen inventory -- this page
 * is intentionally not org-scoped content, but it still gates the same
 * minimal way every other MEMBER+ screen in this codebase does
 * (getCurrentOrgSummary + redirect to /onboarding when the caller isn't
 * a member of any org, matching app/(importer)/audit/page.tsx and
 * app/team/page.tsx) rather than inventing a public/unauthenticated
 * variant -- this repo has no precedent for a genuinely public
 * authenticated-optional page, and "read all" in §27 reads as "no role
 * gate beyond MEMBER+", not "no auth at all".
 *
 * Three sections, each honest about what it can and cannot show:
 *  - App version: GIT_SHA (or "dev"), read the same way
 *    app/api/health/route.ts already does -- never a fabricated commit
 *    hash when the env var is unset (local dev, or a build that didn't
 *    pass --build-arg GIT_SHA).
 *  - Regulatory foundation: the DEFAULT_EMISSION_VALUES exactly-one-
 *    ACTIVE invariant (via checkActiveDefaultEmissionValuesDataset,
 *    shared with the health route -- see that function's doc comment
 *    for why), plus a table of every ACTIVE regulatory_datasets row
 *    across all seven dataset_type values, showing only the columns
 *    that table actually has (version, status, effective_from/to,
 *    source_file_name, source_checksum, imported_at, created_at) --
 *    there is no `verified_at` column, so no "last verified" timestamp
 *    is invented; `imported_at` is the closest real fact (when the
 *    regulatory pipeline loaded these rows).
 *  - Background jobs: this product has no background job runner yet
 *    (master plan §11/§29: pg-boss is adopted only once async work
 *    first exceeds request scope, and no pg-boss/worker code exists
 *    anywhere in this repository as of this phase) -- stated plainly
 *    rather than rendering a fabricated "all jobs healthy" panel for a
 *    job system that doesn't exist.
 *
 * Reads through the caller's own session-scoped Supabase client (same
 * one AppShell/every other screen uses), not the service-role client
 * app/api/health/route.ts uses -- this page runs inside a real user
 * session, and regulatory_datasets already carries an authenticated-
 * read RLS policy (regulatory_datasets_select_authenticated,
 * 20260828100000_authenticated_read_regulatory_data.sql), so there is
 * no reason for it to reach for the RLS-bypassing client the health
 * route needs only because Railway's healthcheck has no user session
 * to scope to.
 */
export default async function StatusPage() {
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

  const gitSha =
    process.env.GIT_SHA ??
    "dev";

  const [
    datasetCheck,
    activeDatasets,
  ] = await Promise.all(
    [
      checkActiveDefaultEmissionValuesDataset(
        supabase,
      ),
      listActiveRegulatoryDatasets(
        supabase,
      ),
    ],
  );

  return (
    <AppShell
      breadcrumbs={[
        { label: "System status" },
      ]}
      activeNavLabel="System status"
    >
      <div className="mb-4 flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
          System status
        </h1>

        <p className="max-w-2xl text-sm text-[var(--text-secondary)]">
          What this deployment is actually running, and what it can
          verify about its own regulatory foundation -- real values
          only, never a fabricated "all clear".
        </p>
      </div>

      <div className="flex max-w-3xl flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Application</CardTitle>
            <CardDescription>
              The exact build currently serving this request.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <dl className="flex items-center gap-2 text-sm">
              <dt className="text-[var(--text-secondary)]">
                Version (GIT_SHA)
              </dt>

              <dd className="font-mono text-[var(--text-primary)]">
                {gitSha}
              </dd>

              {gitSha === "dev" ? (
                <Badge tone="neutral">
                  No GIT_SHA set -- local/dev build
                </Badge>
              ) : null}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Regulatory foundation</CardTitle>
            <CardDescription>
              Every regulatory fact this app relies on enters through a
              versioned regulatory_datasets row -- this is every row
              currently ACTIVE, and the one invariant a broken deploy
              could silently violate.
            </CardDescription>
          </CardHeader>

          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-[var(--text-secondary)]">
                DEFAULT_EMISSION_VALUES:
              </span>

              <Badge tone={DATASET_STATUS_TONE[datasetCheck.status]}>
                {DATASET_STATUS_LABEL[datasetCheck.status]}
              </Badge>
            </div>

            {activeDatasets.status === "error" ? (
              <p className="text-sm text-[var(--color-danger-700)]">
                Unable to load ACTIVE dataset status -- the query
                itself failed. This is not the same as "zero datasets
                are active"; try reloading.
              </p>
            ) : activeDatasets.datasets.length === 0 ? (
              <p className="text-sm text-[var(--color-danger-700)]">
                No ACTIVE regulatory datasets found. This is a real
                outage state, not a loading placeholder.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border-default)] text-[var(--text-secondary)]">
                      <th className="py-1.5 pr-4 font-medium">
                        Dataset type
                      </th>
                      <th className="py-1.5 pr-4 font-medium">
                        Version
                      </th>
                      <th className="py-1.5 pr-4 font-medium">
                        Effective
                      </th>
                      <th className="py-1.5 pr-4 font-medium">
                        Source file
                      </th>
                      <th className="py-1.5 pr-4 font-medium">
                        Checksum
                      </th>
                      <th className="py-1.5 font-medium">
                        Imported / created
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {activeDatasets.datasets.map(
                      (dataset: ActiveRegulatoryDataset) => (
                        <tr
                          key={dataset.id}
                          className="border-b border-[var(--border-default)] last:border-0"
                        >
                          <td className="py-1.5 pr-4 text-[var(--text-primary)]">
                            {dataset.dataset_type}
                          </td>

                          <td className="py-1.5 pr-4 font-mono text-[var(--text-primary)]">
                            {dataset.version}
                          </td>

                          <td className="py-1.5 pr-4 font-mono text-[var(--text-secondary)]">
                            {dataset.effective_from}
                            {dataset.effective_to
                              ? ` – ${dataset.effective_to}`
                              : " – open"}
                          </td>

                          <td className="py-1.5 pr-4 text-[var(--text-secondary)]">
                            {dataset.source_file_name ?? "—"}
                          </td>

                          <td
                            className="max-w-[10rem] truncate py-1.5 pr-4 font-mono text-[var(--text-tertiary)]"
                            title={dataset.source_checksum ?? undefined}
                          >
                            {dataset.source_checksum ?? "—"}
                          </td>

                          <td className="py-1.5 text-[var(--text-secondary)]">
                            {dataset.imported_at
                              ? formatTimestamp(dataset.imported_at)
                              : "imported_at not recorded"}
                            {" · "}
                            {formatTimestamp(dataset.created_at)}
                            {" row created"}
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Background jobs</CardTitle>
            <CardDescription>
              Job health, honestly: there is nothing running yet to
              check.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <div className="flex items-start gap-2 text-sm">
              <Badge tone="neutral">
                Not yet applicable
              </Badge>

              <p className="text-[var(--text-secondary)]">
                This product has no background job runner. Per master
                plan §11/§29, pg-boss (Postgres-backed) is adopted once
                async work first exceeds request scope -- that
                point hasn&apos;t been reached, and no pg-boss/worker
                code exists in this codebase yet. There is no job
                health to report because there is no job system,
                which is a different, more honest thing to say than
                "all jobs healthy".
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

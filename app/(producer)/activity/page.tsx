import { redirect } from "next/navigation";

import {
  AppShell,
} from "../../../components/shell/app-shell";

import {
  Card,
} from "../../../components/ui/card";

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
  listAuditEvents,
} from "../../../src/application/audit/list-audit-events";

import {
  firstParam,
  hasAnyAuditFilterParam,
  parseAuditFilterParams,
} from "../../../src/application/audit/parse-audit-filters";

import {
  AUDIT_EVENT_LIST_LIMIT,
  toAuditEventRowView,
} from "../../../components/audit/audit-event-view";

import {
  AuditFilterBar,
} from "../../../components/audit/audit-filter-bar";

import {
  AuditEventTable,
} from "../../../components/audit/audit-event-table";

import {
  ExportAuditCsvButton,
} from "../../../components/audit/export-audit-csv-button";

interface OrgMemberRow {
  user_id: string;
  email: string;
}

const ACTIVITY_BASE_PATH = "/activity";

/**
 * Master plan §27 screen 34 ("Activity/audit" -- "producer-side
 * timeline incl. sharing events"), P8 scope. Shares its entire data
 * shape with app/(importer)/audit/page.tsx (screen 20) -- same
 * listAuditEvents call, same AuditEventTable/AuditFilterBar/
 * ExportAuditCsvButton components (components/audit/) -- since
 * org_id scoping already limits each org to the event_types that
 * actually happen in it; a producer org's own trail naturally
 * surfaces INSTALLATION/EMISSION_DATA/SHARING_GRANT events (issue/
 * accept/revoke/data_consumed -- §9's "grant lifecycle events... and
 * consumption events... recorded on both orgs' audit streams") rather
 * than needing a second, producer-specific query shape. Only the
 * shell wiring (experience, breadcrumbs, nav label, base path) and
 * this page's own copy differ from the importer screen.
 *
 * Read-only, MEMBER+ -- see app/(importer)/audit/page.tsx's own doc
 * comment for the §41/§27 visibility-decision note, which applies
 * identically here.
 */
export default async function ActivityPage(
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

  const filters =
    parseAuditFilterParams(
      params,
    );

  const events =
    await listAuditEvents(
      supabase,
      orgSummary.context.org_id,
      filters,
      AUDIT_EVENT_LIST_LIMIT,
    );

  let emptyState: "no-events" | "no-matches" | null =
    null;

  if (events.length === 0) {
    if (!hasAnyAuditFilterParam(params)) {
      emptyState =
        "no-events";
    } else {
      // See app/(importer)/audit/page.tsx's identical branch for why
      // this second, unfiltered/limit-1 query exists.
      const anyEventAtAll =
        await listAuditEvents(
          supabase,
          orgSummary.context.org_id,
          undefined,
          1,
        );

      emptyState =
        anyEventAtAll.length > 0
          ? "no-matches"
          : "no-events";
    }
  }

  const { data: members, error: membersError } =
    await supabase.rpc(
      "list_org_members",
      { p_org_id: orgSummary.context.org_id },
    );

  const emailByUserId: Record<string, string> =
    {};

  if (!membersError && members) {
    for (
      const member of members as OrgMemberRow[]
    ) {
      emailByUserId[member.user_id] =
        member.email;
    }
  }

  const rows =
    events.map(
      (event) =>
        toAuditEventRowView(
          event,
          emailByUserId,
        ),
    );

  return (
    <AppShell
      experience="producer"
      breadcrumbs={[
        { label: "Activity" },
      ]}
      activeNavLabel="Activity"
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-1">
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
            Activity
          </h1>

          <p className="text-sm text-[var(--text-secondary)]">
            Every recorded action on this organization&apos;s
            installations, emission data, and sharing grants -- an
            immutable, filterable timeline, including when an importer
            reads data you&apos;ve shared.
          </p>
        </div>

        <ExportAuditCsvButton
          rows={rows}
          filename={`activity-${orgSummary.context.org_id}.csv`}
        />
      </div>

      <AuditFilterBar
        basePath={ACTIVITY_BASE_PATH}
        values={{
          eventTypePrefix: firstParam(params.eventTypePrefix) ?? "",
          aggregateType: firstParam(params.aggregateType) ?? "",
          occurredFrom: firstParam(params.occurredFrom) ?? "",
          occurredTo: firstParam(params.occurredTo) ?? "",
        }}
      />

      <Card>
        <AuditEventTable
          rows={rows}
          emptyState={emptyState}
          limitReached={events.length === AUDIT_EVENT_LIST_LIMIT}
        />
      </Card>
    </AppShell>
  );
}

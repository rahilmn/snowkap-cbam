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

const AUDIT_BASE_PATH = "/audit";

/**
 * Master plan §27 screen 20 ("Audit history" -- "filterable immutable
 * timeline + export"), P8 scope. Read-only, MEMBER+: no admin gate
 * beyond being signed in with an org, matching every other MEMBER+
 * screen in this codebase (shipments/page.tsx, sharing/status/page.tsx)
 * -- §41's "Audit-history visibility (all members vs ADMIN+)" is still
 * an open owner decision, but §27's own screen-20 entry already states
 * MEMBER+, so that's what this screen implements pending that decision
 * (a stricter gate is a one-line change to add later, not a reason to
 * block this screen now).
 *
 * Resolves this org's members (`list_org_members` RPC -- same call
 * site pattern as app/team/page.tsx) purely to turn a USER actor's
 * bare `user_id` into an email for the Actor column; a failed lookup
 * degrades to the id-based fallback in formatActorLabel
 * (audit-event-view.ts) rather than failing the whole page, since the
 * audit trail itself is the load-bearing content here, not the
 * member directory.
 */
export default async function AuditHistoryPage(
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
      // A filtered query came back empty -- before rendering "no
      // matches", confirm the org actually has *some* event ever
      // recorded (unfiltered, capped at 1 row) so a brand-new org
      // visiting this screen with a stale/hand-edited filter link
      // still gets the honest "no events yet" message instead of a
      // misleading "loosen your filters".
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
      breadcrumbs={[
        { label: "Audit history" },
      ]}
      activeNavLabel="Audit"
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-1">
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
            Audit history
          </h1>

          <p className="text-sm text-[var(--text-secondary)]">
            Every recorded mutation in this organization -- shipments,
            determinations, calculations, and shared-data access --
            in one immutable, filterable timeline.
          </p>
        </div>

        <ExportAuditCsvButton
          rows={rows}
          filename={`audit-history-${orgSummary.context.org_id}.csv`}
        />
      </div>

      <AuditFilterBar
        basePath={AUDIT_BASE_PATH}
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

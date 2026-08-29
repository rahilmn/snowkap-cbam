import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  AuditActor,
  AuditAggregateType,
  AuditEvent,
} from "../../domain/audit/types";

import type {
  OrganizationId,
  UserId,
} from "../../domain/shared/ids";

import type {
  IsoTimestamp,
} from "../../domain/shared/reporting-period";

export interface AuditEventFilters {
  // Prefix match against event_type -- e.g. "sharing_grant." to see every
  // sharing-grant lifecycle event regardless of its specific suffix
  // (issued/accepted/revoked/data_consumed). User-supplied free text
  // (AuditFilterBar's eventTypePrefix <Input>, audit-filter-bar.tsx) --
  // this module escapes any LIKE metacharacter the caller's text
  // happens to contain and appends the SQL wildcard itself (see
  // escapeLikePattern and the `ilike` call below), so a caller can
  // never turn "match this literal prefix" into an unintended substring
  // match or an unindexed leading-wildcard scan just by typing `%` or
  // `_` (found wrong in the P8 security review, finding #2: an earlier
  // version of this comment claimed the value was always
  // caller-constructed from the known catalog, which stopped being true
  // once AuditFilterBar's free-text input shipped in this same phase).
  eventTypePrefix?: string;
  aggregateType?: AuditAggregateType;
  occurredFrom?: IsoTimestamp;
  occurredTo?: IsoTimestamp;
}

const AUDIT_EVENT_COLUMNS =
  "id, org_id, occurred_at, actor_type, actor_user_id, event_type, aggregate_type, aggregate_id, payload, correlation_id";

interface AuditEventRow {
  id: string;
  org_id: string | null;
  occurred_at: string;
  actor_type: string;
  actor_user_id: string | null;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown> | null;
  correlation_id: string | null;
}

// This is a read model for a UI list screen (the "Audit"/"Activity" nav
// entries in components/shell/sidebar.tsx, wired to real routes as of
// this same phase -- app/(importer)/audit/ and app/(producer)/activity/),
// not an export pipeline -- master plan §21 already calls out a distinct
// "audit export" surface for the full-history case, which this default
// is deliberately not trying to be. A future async full-export job is
// the right place for "give me everything", not a larger in-request
// limit here. (The client-side CSV button on those same screens,
// export-audit-csv-button.tsx, exports only the already-limited rows
// the page fetched -- it is not that full-export surface.)
const DEFAULT_LIST_LIMIT = 200;

/**
 * Escapes the three characters `ilike`'s pattern treats specially --
 * `%` (any run of characters), `_` (any single character), and `\`
 * (Postgres's own default LIKE/ILIKE escape character) -- by prefixing
 * each with a backslash, so a user-typed `eventTypePrefix` containing
 * any of them is matched as a literal prefix rather than as a live
 * pattern. PostgREST's `ilike.` filter sends the pattern straight
 * through to Postgres with no way to override the ESCAPE clause, so
 * backslash (Postgres's unescaped default) is the only escape character
 * available here -- see listAuditEvents's own doc comment for why this
 * matters (P8 security review, finding #2).
 */
function escapeLikePattern(
  value: string,
): string {
  return value.replace(
    /[\\%_]/g,
    (char) => `\\${char}`,
  );
}

function toAuditActor(
  row: AuditEventRow,
): AuditActor {
  if (row.actor_type === "SYSTEM") {
    return {
      type: "SYSTEM",
    };
  }

  return {
    type: "USER",
    user_id: row.actor_user_id as UserId,
  };
}

function toAuditEvent(
  row: AuditEventRow,
): AuditEvent {
  return {
    id: row.id as AuditEvent["id"],
    org_id: row.org_id as AuditEvent["org_id"],
    occurred_at: row.occurred_at as IsoTimestamp,
    actor: toAuditActor(row),
    event_type: row.event_type,
    aggregate: {
      type: row.aggregate_type as AuditAggregateType,
      id: row.aggregate_id,
    },
    payload: row.payload ?? {},
    correlation_id: row.correlation_id,
  };
}

/**
 * Read model for the audit trail (master plan §21's "Audit history"
 * screen, §41's visibility decision) -- the read-side counterpart to
 * recordAuditEvent (record-audit-event.ts), which has had no query
 * service at all until this file, despite audit_events having been
 * written to since P3. `org_id = orgId` is applied explicitly even
 * though audit_events_select_own_org (20260828070000) already scopes
 * SELECT to the caller's own orgs via app.user_org_ids() -- Wall 1
 * (application) should not depend on Wall 2 (RLS) alone catching this,
 * per docs/plans/MASTER_PLAN.md §126's "two walls, always both", the
 * same discipline listSharedDataStatus (list-shared-data-status.ts) and
 * every other list-service in this codebase already applies to its own
 * org_id filter.
 *
 * `eventTypePrefix` is matched with `ilike` rather than `eq` because the
 * catalog (docs/architecture/ARCHITECTURE.md, "Auditability") is
 * namespaced ("sharing_grant.issued", "sharing_grant.accepted", ...) and
 * a caller filtering the audit screen by category (e.g. "show me
 * everything about this sharing grant's lifecycle") wants every event
 * under that namespace, not one exact literal. Unlike the regulatory
 * resolver's own `ilike` usage (supabase-regulatory-repository.ts),
 * which wraps a genuine, deliberately-live search term in `%...%` on
 * both sides, this one is meant to be a literal prefix match on
 * user-supplied text -- so escapeLikePattern neutralizes any `%`/`_`/`\`
 * the caller's text happens to contain before the trailing `%` wildcard
 * is appended, rather than letting them silently act as live SQL
 * wildcards (or, for a leading `%`, force an unindexed scan of the
 * org's audit table).
 *
 * Ordered `occurred_at desc, id desc` -- the id tiebreak matters because
 * `occurred_at` is a `timestamptz not null default now()` (20260828070000),
 * so two events recorded in the same request (e.g. the supersede +
 * activate pair in activateEmissionData, manage-emission-data.ts) can
 * share a timestamp; without a deterministic second key, Postgres is free
 * to return those two rows in either order on any given call, which would
 * make the UI list's ordering silently flap between page loads.
 *
 * Capped at `limit` (default DEFAULT_LIST_LIMIT) -- see that constant's
 * own comment for why this is a UI-list cap, not an export cap.
 *
 * Returns [] on any query error rather than throwing -- matching this
 * codebase's established read-service convention (listSharedDataStatus,
 * listActualDeterminedLines, listAvailableActualEmissionData) of failing
 * closed to an empty/safe result for a list view, rather than crashing a
 * screen over a transient fetch failure. Nothing about the error itself
 * (message, code) is logged here -- callers that need visibility into
 * *why* a fetch failed should inspect the error at the infrastructure
 * boundary, not have it threaded through a list read-model's return type.
 */
export async function listAuditEvents(
  supabase: SupabaseClient,
  orgId: OrganizationId,
  filters?: AuditEventFilters,
  limit = DEFAULT_LIST_LIMIT,
): Promise<AuditEvent[]> {
  let query =
    supabase
      .from("audit_events")
      .select(
        AUDIT_EVENT_COLUMNS,
      )
      .eq("org_id", orgId);

  if (filters?.eventTypePrefix) {
    query =
      query.ilike(
        "event_type",
        `${escapeLikePattern(filters.eventTypePrefix)}%`,
      );
  }

  if (filters?.aggregateType) {
    query =
      query.eq(
        "aggregate_type",
        filters.aggregateType,
      );
  }

  if (filters?.occurredFrom) {
    query =
      query.gte(
        "occurred_at",
        filters.occurredFrom,
      );
  }

  if (filters?.occurredTo) {
    query =
      query.lte(
        "occurred_at",
        filters.occurredTo,
      );
  }

  const { data, error } =
    await query
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit);

  if (error || !data) {
    return [];
  }

  return (data as AuditEventRow[]).map(
    toAuditEvent,
  );
}

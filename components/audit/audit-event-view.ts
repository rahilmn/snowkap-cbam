import type {
  AuditActor,
  AuditEvent,
} from "../../src/domain/audit/types";

// Mirrors list-audit-events.ts's own (unexported) DEFAULT_LIST_LIMIT.
// Kept as a separate local constant rather than exporting and
// importing that one, so this UI-facing "did we hit the cap" check
// doesn't reach into and start depending on the internals of a module
// another workstream already built, tested, and reported complete;
// both call sites (app/(importer)/audit, app/(producer)/activity)
// pass this explicitly as listAuditEvents's own `limit` argument, so
// the two numbers cannot silently drift out of sync with each other.
export const AUDIT_EVENT_LIST_LIMIT = 200;

export interface AuditEventRowView {
  id: string;
  occurredAt: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  actorLabel: string;
  payloadSummary: string;
  payload: Record<string, unknown>;
}

// A UUID's first segment (8 hex chars, before the first hyphen) is
// enough to tell two rows apart at a glance in a dense table without
// printing the full 36-character id -- same truncation length as
// nothing else in this codebase yet, chosen simply because 8 hex chars
// already gives 2^32 worth of visual distinctness for what's normally
// a handful of members per org.
const ACTOR_ID_PREFIX_LENGTH = 8;

/**
 * Renders an AuditEvent's actor as something a person can read.
 * `emailByUserId` comes from the `list_org_members` RPC (see
 * app/team/page.tsx for the one other call site) -- a *current*
 * membership list, so a USER actor whose membership has since been
 * removed has no entry and falls back to a truncated id, the same
 * "known-but-not-resolvable" fallback shape as
 * shared-data-status-list.tsx's "Unknown organization" for a revoked
 * grant's grantee: the audit row itself must never be dropped or
 * blanked just because the acting member is gone, since the whole
 * point of this screen is an immutable trail that outlives the actors
 * in it.
 */
export function formatActorLabel(
  actor: AuditActor,
  emailByUserId: Record<string, string>,
): string {
  if (actor.type === "SYSTEM") {
    return "System";
  }

  return (
    emailByUserId[actor.user_id] ??
    `User ${actor.user_id.slice(
      0,
      ACTOR_ID_PREFIX_LENGTH,
    )}`
  );
}

// Long enough to show real content (most payloads here are a handful
// of short fields -- reference numbers, statuses, ids) while keeping a
// dense table's row height predictable; the full payload is always one
// click away via the per-row <details> in AuditEventTable, so nothing
// is actually lost to the truncation, just deferred.
const PAYLOAD_SUMMARY_MAX_LENGTH = 140;

function formatPayloadValue(
  value: unknown,
): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(
      value,
    );
  }

  return JSON.stringify(
    value,
  );
}

/**
 * A one-line, scannable rendering of an audit event's payload for the
 * dense table row -- deliberately generic (`key: value, key: value`)
 * rather than a per-event_type template. The 34-entry catalog
 * (docs/architecture/ARCHITECTURE.md, "Auditability") documents each
 * event_type's *trigger and write path*, not its payload's field
 * shape, so this module has no verified source for what any given
 * event_type's payload actually contains; a bespoke per-type summary
 * would mean guessing field names, which is exactly the kind of
 * invented-fact risk this codebase's regulatory data rules exist to
 * prevent (CLAUDE.md, "Never invent a regulatory value... that isn't
 * in the source data") -- applied here to audit payload shape instead.
 * `null`/`undefined` values are dropped rather than printed, since
 * every mutation site's own recordAuditEvent call already treats
 * "field not set" as "field omitted from payload" (see
 * record-audit-event.ts), so printing an explicit "field: null" would
 * suggest a distinction the writers never actually made.
 */
export function summarizePayload(
  payload: Record<string, unknown>,
): string {
  const entries =
    Object.entries(
      payload,
    ).filter(
      ([, value]) => value !== null && value !== undefined,
    );

  if (entries.length === 0) {
    return "No additional details";
  }

  const summary =
    entries
      .map(
        ([key, value]) => `${key}: ${formatPayloadValue(value)}`,
      )
      .join(
        ", ",
      );

  if (summary.length <= PAYLOAD_SUMMARY_MAX_LENGTH) {
    return summary;
  }

  return `${summary.slice(
    0,
    PAYLOAD_SUMMARY_MAX_LENGTH,
  )}…`;
}

export function toAuditEventRowView(
  event: AuditEvent,
  emailByUserId: Record<string, string>,
): AuditEventRowView {
  return {
    id: event.id,
    occurredAt: event.occurred_at,
    eventType: event.event_type,
    aggregateType: event.aggregate.type,
    aggregateId: event.aggregate.id,
    actorLabel: formatActorLabel(
      event.actor,
      emailByUserId,
    ),
    payloadSummary: summarizePayload(
      event.payload,
    ),
    payload: event.payload,
  };
}

import type {
  AuditAggregateType,
} from "../../domain/audit/types";

import {
  parseIsoDate,
} from "../../domain/shared/reporting-period";

import type {
  IsoTimestamp,
} from "../../domain/shared/reporting-period";

import type {
  AuditEventFilters,
} from "./list-audit-events";

/**
 * The full `AuditAggregateType` union, as a runtime array -- the type
 * itself erases at compile time, so anything that needs to iterate the
 * known values (the aggregate-type <select> in AuditFilterBar,
 * app/(importer)/audit and app/(producer)/activity) needs this literal
 * kept in sync by hand. Deliberately mirrors
 * src/domain/audit/types.ts's own union order so a diff there is easy
 * to eyeball against this list.
 */
export const AUDIT_AGGREGATE_TYPES: AuditAggregateType[] = [
  "ORGANIZATION",
  "MEMBERSHIP",
  "SHIPMENT",
  "SHIPMENT_LINE",
  "EMISSION_DATA",
  "INSTALLATION",
  "OPERATOR",
  "SUPPLIER",
  "SHARING_GRANT",
  "CALCULATION_RESULT",
  "DECLARATION",
  "EVIDENCE_FILE",
];

function isKnownAggregateType(
  value: string,
): value is AuditAggregateType {
  return (
    AUDIT_AGGREGATE_TYPES as string[]
  ).includes(
    value,
  );
}

// Mirrors Next's own `searchParams` value shape (a repeated query key
// -- "?aggregateType=A&aggregateType=B" -- decodes to a string[], per
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md)
// so callers can pass a page's `searchParams` object straight through
// without pre-normalizing it themselves.
export interface AuditFilterParams {
  eventTypePrefix?: string | string[];
  aggregateType?: string | string[];
  occurredFrom?: string | string[];
  occurredTo?: string | string[];
}

// Exported (not just an internal helper of parseAuditFilterParams
// below) because AuditFilterBar (audit-filter-bar.tsx) needs the same
// string[] -> string collapsing to seed each <input>'s defaultValue
// from the page's raw searchParams -- reusing this rather than a
// second copy keeps "how a repeated query key resolves" defined in
// exactly one place.
export function firstParam(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value)
    ? value[0]
    : value;
}

/**
 * Parses this screen's four URL filters into the `AuditEventFilters`
 * shape `listAuditEvents` (list-audit-events.ts) actually accepts.
 * Deliberately permissive rather than throwing on a malformed URL --
 * these are user-editable query params (this codebase's "URL state for
 * filters" convention, matched here for the first time for a list
 * screen -- see app/(importer)/audit/page.tsx and
 * app/(producer)/activity/page.tsx), and a hand-edited or stale
 * bookmark link (an unknown aggregateType, a garbled date) should fall
 * back to "no filter on that field" rather than 500 the page.
 *
 * `occurredFrom`/`occurredTo` arrive as plain `YYYY-MM-DD` (an
 * `<input type="date">` value) and are widened to the inclusive
 * start/end instants of that calendar day in UTC before being handed
 * to `listAuditEvents`, which compares them against `occurred_at`
 * (`timestamptz`) with `gte`/`lte` -- a bare date string would
 * otherwise implicitly truncate to midnight and silently exclude the
 * rest of the "to" day. Validated with the domain's own `parseIsoDate`
 * (reporting-period.ts) rather than a second regex, so this module
 * doesn't maintain its own opinion of what a valid calendar date looks
 * like.
 */
export function parseAuditFilterParams(
  params: AuditFilterParams,
): AuditEventFilters {
  const filters: AuditEventFilters =
    {};

  const eventTypePrefix =
    firstParam(
      params.eventTypePrefix,
    )?.trim();

  if (eventTypePrefix) {
    filters.eventTypePrefix =
      eventTypePrefix;
  }

  const aggregateType =
    firstParam(
      params.aggregateType,
    )?.trim();

  if (aggregateType && isKnownAggregateType(aggregateType)) {
    filters.aggregateType =
      aggregateType;
  }

  const occurredFrom =
    firstParam(
      params.occurredFrom,
    );

  if (occurredFrom) {
    const parsed =
      parseIsoDate(
        occurredFrom,
      );

    if (parsed.status === "OK") {
      filters.occurredFrom =
        `${parsed.value}T00:00:00.000Z` as IsoTimestamp;
    }
  }

  const occurredTo =
    firstParam(
      params.occurredTo,
    );

  if (occurredTo) {
    const parsed =
      parseIsoDate(
        occurredTo,
      );

    if (parsed.status === "OK") {
      filters.occurredTo =
        `${parsed.value}T23:59:59.999Z` as IsoTimestamp;
    }
  }

  return filters;
}

/**
 * Whether any of the four filter params carries a value a user
 * actually typed/chose (as opposed to an empty string from a
 * submitted-but-blank form field). Callers use this to distinguish the
 * two zero-row empty states a filtered list can be in ("no events yet"
 * vs "no events match your filters") -- see the `emptyState` prop
 * built in app/(importer)/audit/page.tsx and
 * app/(producer)/activity/page.tsx. Intentionally checks the raw
 * params rather than `Object.keys(parseAuditFilterParams(params))`,
 * so an unrecognized aggregateType or an unparseable date -- silently
 * dropped by parseAuditFilterParams above -- still counts as "the user
 * was filtering", not as "no filter was active".
 */
export function hasAnyAuditFilterParam(
  params: AuditFilterParams,
): boolean {
  return Boolean(
    firstParam(
      params.eventTypePrefix,
    )?.trim() ||
      firstParam(
        params.aggregateType,
      )?.trim() ||
      firstParam(
        params.occurredFrom,
      ) ||
      firstParam(
        params.occurredTo,
      ),
  );
}

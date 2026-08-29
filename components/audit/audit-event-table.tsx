import {
  Badge,
} from "../ui/badge";

import type {
  AuditEventRowView,
} from "./audit-event-view";

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

/**
 * The dense table shared by both audit-trail screens
 * (app/(importer)/audit, app/(producer)/activity) -- the two screens'
 * actual row shape (timestamp, event_type, aggregate, actor, payload)
 * is identical per §27 screens 20/34, so factoring this out avoids two
 * copies of the same `<table>` markup drifting apart; each page still
 * owns its own header, filter bar placement, and empty-state copy,
 * since only the table body is genuinely shared.
 *
 * Per-row payload detail is a native `<details>`/`<summary>` rather
 * than client-side expand/collapse state -- this table needs zero
 * JavaScript to be fully interactive, matching the filter bar
 * (AuditFilterBar) staying a plain GET form for the same reason. See
 * summarizePayload's own doc comment (audit-event-view.ts) for why the
 * visible row only ever shows a generic key:value summary, never a
 * guessed per-event_type rendering.
 *
 * `emptyState` distinguishes "no events yet" (a brand-new org) from
 * "no events match your filters" (the org has events; this filter
 * combination has none) -- computed by the caller page, which is the
 * one place that knows both the filtered result count and whether any
 * filter was actually active (see hasAnyAuditFilterParam,
 * parse-audit-filters.ts). Conflating the two would tell a compliance
 * user "there is no audit trail" when the real answer is "loosen your
 * filters".
 */
export function AuditEventTable(
  {
    rows,
    emptyState,
    limitReached,
  }: {
    rows: AuditEventRowView[];
    emptyState: "no-events" | "no-matches" | null;
    limitReached: boolean;
  },
) {
  if (emptyState === "no-events") {
    return (
      <p className="p-6 text-sm text-[var(--text-secondary)]">
        No audit events recorded yet -- every mutation in this
        organization from here on is appended to this trail.
      </p>
    );
  }

  if (emptyState === "no-matches") {
    return (
      <p className="p-6 text-sm text-[var(--text-secondary)]">
        No audit events match the current filters. Try widening the
        date range or clearing a filter.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--border-default)] text-[var(--text-tertiary)]">
              <th className="px-4 py-2.5 font-medium">
                Occurred at
              </th>

              <th className="px-4 py-2.5 font-medium">
                Event type
              </th>

              <th className="px-4 py-2.5 font-medium">
                Aggregate
              </th>

              <th className="px-4 py-2.5 font-medium">
                Actor
              </th>

              <th className="px-4 py-2.5 font-medium">
                Details
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-[var(--border-default)]">
            {rows.map(
              (row) => (
                <tr key={row.id}>
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-[var(--text-secondary)]">
                    {formatTimestamp(row.occurredAt)}
                  </td>

                  <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">
                    {row.eventType}
                  </td>

                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <Badge tone="neutral">
                        {row.aggregateType}
                      </Badge>

                      <span className="text-xs text-[var(--text-tertiary)]">
                        {row.aggregateId}
                      </span>
                    </div>
                  </td>

                  <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                    {row.actorLabel}
                  </td>

                  <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                    <details>
                      <summary className="cursor-pointer text-[var(--text-primary)] marker:text-[var(--text-tertiary)]">
                        {row.payloadSummary}
                      </summary>

                      <pre className="mt-1.5 max-w-md overflow-x-auto rounded-[var(--radius-sm)] bg-[var(--surface-sunken)] p-2 text-xs text-[var(--text-secondary)]">
                        {JSON.stringify(
                          row.payload,
                          null,
                          2,
                        )}
                      </pre>
                    </details>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>

      {limitReached ? (
        <p className="px-4 text-xs text-[var(--text-tertiary)]">
          Showing the most recent {rows.length} events. Narrow the
          filters above to see further back.
        </p>
      ) : null}
    </div>
  );
}

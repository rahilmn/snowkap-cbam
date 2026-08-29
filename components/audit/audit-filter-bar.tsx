import Form from "next/form";

import Link from "next/link";

import {
  Input,
} from "../ui/input";

import {
  Label,
} from "../ui/label";

import {
  Button,
} from "../ui/button";

import {
  AUDIT_AGGREGATE_TYPES,
} from "../../src/application/audit/parse-audit-filters";

export interface AuditFilterBarValues {
  eventTypePrefix: string;
  aggregateType: string;
  occurredFrom: string;
  occurredTo: string;
}

/**
 * The filter bar for both audit-trail screens (app/(importer)/audit,
 * app/(producer)/activity) -- built as a plain GET `<Form>`
 * (next/form, not a client-side `useState` filter panel) so the filter
 * state lives entirely in the URL, per this codebase's "URL state for
 * filters" convention: a filtered view is a link a user can bookmark,
 * share with a teammate, or open in a second tab, and back/forward
 * just works. `next/form`'s string `action` behaves like a native
 * `method="get"` form (values become query params) but adds
 * client-side navigation + prefetching on top -- see
 * node_modules/next/dist/docs/01-app/03-api-reference/02-components/form.md
 * -- so this needs no "use client" boundary and no onChange handlers
 * of its own; submitting is the only interaction.
 *
 * `values` seeds every field's `defaultValue` from the *current*
 * searchParams (computed by the caller page from its own
 * `searchParams` prop) so the bar always reflects the filter a
 * bookmarked/shared link encodes, rather than resetting to blank on
 * every navigation.
 */
export function AuditFilterBar(
  {
    basePath,
    values,
  }: {
    basePath: string;
    values: AuditFilterBarValues;
  },
) {
  const hasActiveFilter =
    Boolean(
      values.eventTypePrefix ||
        values.aggregateType ||
        values.occurredFrom ||
        values.occurredTo,
    );

  return (
    <Form
      action={basePath}
      className="mb-4 flex flex-wrap items-end gap-3 rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--surface-raised)] p-4"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="audit-filter-eventTypePrefix">
          Event type prefix
        </Label>

        <Input
          id="audit-filter-eventTypePrefix"
          name="eventTypePrefix"
          defaultValue={values.eventTypePrefix}
          placeholder="e.g. shipment. or sharing_grant."
          className="w-56"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="audit-filter-aggregateType">
          Aggregate type
        </Label>

        <select
          id="audit-filter-aggregateType"
          name="aggregateType"
          defaultValue={values.aggregateType}
          className="h-10 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-page)] px-2.5 text-sm text-[var(--text-primary)]"
        >
          <option value="">
            All aggregate types
          </option>

          {AUDIT_AGGREGATE_TYPES.map(
            (aggregateType) => (
              <option
                key={aggregateType}
                value={aggregateType}
              >
                {aggregateType}
              </option>
            ),
          )}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="audit-filter-occurredFrom">
          From
        </Label>

        <Input
          id="audit-filter-occurredFrom"
          type="date"
          name="occurredFrom"
          defaultValue={values.occurredFrom}
          className="w-40"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="audit-filter-occurredTo">
          To
        </Label>

        <Input
          id="audit-filter-occurredTo"
          type="date"
          name="occurredTo"
          defaultValue={values.occurredTo}
          className="w-40"
        />
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit">
          Apply filters
        </Button>

        {hasActiveFilter ? (
          <Link
            href={basePath}
            className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline"
          >
            Clear filters
          </Link>
        ) : null}
      </div>
    </Form>
  );
}

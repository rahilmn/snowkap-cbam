"use client";

import {
  useState,
} from "react";

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
} from "lucide-react";

import {
  cn,
} from "../../lib/utils";

import {
  sortRows,
  type DataTableColumn,
  type DataTableSortDirection,
} from "./data-table-sort";

export type {
  DataTableColumn,
};

/**
 * S3 (importer experience), v2.1.1 DataTable foundation -- the first
 * reusable table primitive in this codebase (every existing list
 * screen hand-rolls its own <table>; see e.g.
 * app/(importer)/shipments/page.tsx before this component existed).
 *
 * Desktop renders a real <table> with sortable-where-authored column
 * headers; below `md` it renders the SAME rows as a stacked card list
 * instead of compressing the table horizontally (no existing screen in
 * this app had a card fallback before this component -- introducing
 * the pattern, not extending one).
 *
 * The first column is treated as the card's own title/identifying
 * line on mobile (matching the existing convention across this app's
 * hand-rolled tables, where the first column is always the row's own
 * link/identifier) -- every OTHER column becomes a label:value pair
 * underneath it.
 */
export function DataTable<Row>(
  {
    columns,
    rows,
    getRowKey,
    emptyMessage,
    caption,
  }: {
    columns: DataTableColumn<Row>[];
    rows: Row[];
    getRowKey: (row: Row) => string;
    emptyMessage?: string;
    /** Visually hidden <caption>, read by screen readers on desktop. */
    caption?: string;
  },
) {
  const [
    sortKey,
    setSortKey,
  ] =
    useState<string | null>(
      null,
    );

  const [
    direction,
    setDirection,
  ] =
    useState<DataTableSortDirection>(
      "asc",
    );

  if (rows.length === 0) {
    return (
      <p className="p-6 text-sm text-[var(--text-secondary)]">
        {emptyMessage ?? "No results."}
      </p>
    );
  }

  const sorted =
    sortRows(
      rows,
      columns,
      sortKey,
      direction,
    );

  function handleSort(
    column: DataTableColumn<Row>,
  ): void {
    if (!column.sortValue) {
      return;
    }

    if (sortKey === column.key) {
      setDirection(
        direction === "asc" ? "desc" : "asc",
      );

      return;
    }

    setSortKey(
      column.key,
    );

    setDirection(
      "asc",
    );
  }

  const [
    titleColumn,
    ...detailColumns
  ] =
    columns;

  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          {caption ? (
            <caption className="sr-only">
              {caption}
            </caption>
          ) : null}

          <thead>
            <tr className="border-b border-[var(--border-default)] text-[var(--text-tertiary)]">
              {columns.map(
                (column) => {
                  const isSorted =
                    sortKey === column.key;

                  return (
                    <th
                      key={column.key}
                      className={cn(
                        "px-4 py-2.5 font-medium",
                        column.className,
                      )}
                      aria-sort={
                        column.sortValue
                          ? isSorted
                            ? direction === "asc" ? "ascending" : "descending"
                            : "none"
                          : undefined
                      }
                    >
                      {column.sortValue ? (
                        <button
                          type="button"
                          onClick={() => handleSort(column)}
                          className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] hover:text-[var(--text-secondary)] focus-visible:outline-2 focus-visible:outline-offset-2"
                        >
                          {column.header}

                          {isSorted ? (
                            direction === "asc" ? (
                              <ArrowUp
                                className="size-3.5"
                                aria-hidden="true"
                              />
                            ) : (
                              <ArrowDown
                                className="size-3.5"
                                aria-hidden="true"
                              />
                            )
                          ) : (
                            <ArrowUpDown
                              className="size-3.5 opacity-40"
                              aria-hidden="true"
                            />
                          )}
                        </button>
                      ) : (
                        column.header
                      )}
                    </th>
                  );
                },
              )}
            </tr>
          </thead>

          <tbody className="divide-y divide-[var(--border-default)]">
            {sorted.map(
              (row) => (
                <tr key={getRowKey(row)}>
                  {columns.map(
                    (column) => (
                      <td
                        key={column.key}
                        className={cn(
                          "px-4 py-2.5",
                          column.className,
                        )}
                      >
                        {column.render(row)}
                      </td>
                    ),
                  )}
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>

      <ul className="flex flex-col gap-2 md:hidden">
        {sorted.map(
          (row) => (
            <li
              key={getRowKey(row)}
              className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-raised)] p-3"
            >
              <div className="mb-2 text-sm font-medium text-[var(--text-primary)]">
                {titleColumn?.render(row)}
              </div>

              <dl className="flex flex-col gap-1.5">
                {detailColumns.map(
                  (column) => (
                    <div
                      key={column.key}
                      className="flex items-baseline justify-between gap-3 text-sm"
                    >
                      <dt className="text-[var(--text-tertiary)]">
                        {column.header}
                      </dt>

                      <dd className="text-right text-[var(--text-secondary)]">
                        {column.render(row)}
                      </dd>
                    </div>
                  ),
                )}
              </dl>
            </li>
          ),
        )}
      </ul>
    </>
  );
}

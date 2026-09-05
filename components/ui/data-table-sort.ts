/**
 * S3 (importer experience), v2.1.1 DataTable foundation. Pure sort
 * logic, kept separate from data-table.tsx so it is unit-testable
 * without a DOM -- this codebase has no React component-testing
 * framework (UI behavior is verified via Playwright E2E instead, see
 * CLAUDE.md-adjacent convention already established across
 * components/guidance/**), but sorting is ordinary data logic and
 * deserves the same TDD discipline as any other pure function.
 */

import type {
  ReactNode,
} from "react";

export type DataTableSortDirection = "asc" | "desc";

export interface DataTableColumn<Row> {
  key: string;
  header: string;
  render: (row: Row) => ReactNode;

  /**
   * Absent means this column cannot be sorted -- DataTable does not
   * render a sort control for it. "sorting/filtering only where
   * actually supported" (v2.1.1): a column's own author states whether
   * it's sortable, rather than DataTable guessing from the rendered
   * output.
   */
  sortValue?: (row: Row) => string | number;

  className?: string;
}

/**
 * Sorts `rows` by the column named `sortKey`, or returns them
 * unchanged (same order, same array identity of each row) when
 * `sortKey` is null, matches no column, or names a column with no
 * `sortValue`. Never mutates `rows`.
 */
export function sortRows<Row>(
  rows: Row[],
  columns: DataTableColumn<Row>[],
  sortKey: string | null,
  direction: DataTableSortDirection,
): Row[] {
  if (sortKey === null) {
    return rows;
  }

  const column =
    columns.find(
      (candidate) => candidate.key === sortKey,
    );

  if (!column?.sortValue) {
    return rows;
  }

  const sortValue =
    column.sortValue;

  const sign =
    direction === "asc" ? 1 : -1;

  return rows
    .slice()
    .sort(
      (a, b) => {
        const left =
          sortValue(a);

        const right =
          sortValue(b);

        if (left < right) {
          return -1 * sign;
        }

        if (left > right) {
          return 1 * sign;
        }

        return 0;
      },
    );
}

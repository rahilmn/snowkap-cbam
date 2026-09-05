import {
  describe,
  expect,
  it,
} from "vitest";

import {
  sortRows,
  type DataTableColumn,
} from "./data-table-sort";

interface Row {
  id: string;
  name: string;
  amount: number;
}

const rows: Row[] =
  [
    { id: "a", name: "Charlie", amount: 30 },
    { id: "b", name: "Alice", amount: 10 },
    { id: "c", name: "Bravo", amount: 20 },
  ];

const columns: DataTableColumn<Row>[] =
  [
    { key: "name", header: "Name", render: (row) => row.name, sortValue: (row) => row.name },
    { key: "amount", header: "Amount", render: (row) => String(row.amount), sortValue: (row) => row.amount },
    { key: "unsortable", header: "Fixed", render: () => "-" },
  ];

describe(
  "sortRows",
  () => {
    it(
      "returns rows unchanged when sortKey is null",
      () => {
        expect(
          sortRows(rows, columns, null, "asc"),
        ).toEqual(
          rows,
        );
      },
    );

    it(
      "sorts ascending by a string sortValue",
      () => {
        expect(
          sortRows(rows, columns, "name", "asc").map((r) => r.id),
        ).toEqual(
          ["b", "c", "a"],
        );
      },
    );

    it(
      "sorts descending by a string sortValue",
      () => {
        expect(
          sortRows(rows, columns, "name", "desc").map((r) => r.id),
        ).toEqual(
          ["a", "c", "b"],
        );
      },
    );

    it(
      "sorts ascending and descending by a numeric sortValue",
      () => {
        expect(
          sortRows(rows, columns, "amount", "asc").map((r) => r.id),
        ).toEqual(
          ["b", "c", "a"],
        );

        expect(
          sortRows(rows, columns, "amount", "desc").map((r) => r.id),
        ).toEqual(
          ["a", "c", "b"],
        );
      },
    );

    it(
      "does not mutate the input array",
      () => {
        const original =
          [...rows];

        sortRows(
          rows,
          columns,
          "name",
          "asc",
        );

        expect(rows).toEqual(
          original,
        );
      },
    );

    it(
      "returns rows unchanged when sortKey names a column with no sortValue",
      () => {
        expect(
          sortRows(rows, columns, "unsortable", "asc"),
        ).toEqual(
          rows,
        );
      },
    );

    it(
      "returns rows unchanged when sortKey does not match any column",
      () => {
        expect(
          sortRows(rows, columns, "does-not-exist", "asc"),
        ).toEqual(
          rows,
        );
      },
    );
  },
);

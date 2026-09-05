import {
  describe,
  expect,
  it,
} from "vitest";

import {
  rankGuidanceItems,
} from "./rank";

import type {
  GuidanceItem,
} from "./types";

function item(
  overrides: Partial<GuidanceItem> & Pick<GuidanceItem, "id">,
): GuidanceItem {
  return {
    rule: "TEST",
    parent: null,
    family: overrides.id,
    priority: "OPTIONAL",
    impact: "INFO",
    actionability: "NAVIGATE",
    title: overrides.id,
    reason: "",
    sortKey: overrides.id,
    ...overrides,
  };
}

describe(
  "rankGuidanceItems",
  () => {
    it(
      "orders REQUIRED before RECOMMENDED before OPTIONAL, regardless of input order",
      () => {
        const items =
          [
            item({ id: "opt", priority: "OPTIONAL" }),
            item({ id: "req", priority: "REQUIRED" }),
            item({ id: "rec", priority: "RECOMMENDED" }),
          ];

        expect(
          rankGuidanceItems(items).map((i) => i.id),
        ).toEqual(
          ["req", "rec", "opt"],
        );
      },
    );

    it(
      "orders by impact severity (FILING > INTEGRITY > APPROVAL > DATA_ENTRY > SETUP > INFO) within the same priority tier",
      () => {
        const items =
          [
            item({ id: "info", priority: "REQUIRED", impact: "INFO" }),
            item({ id: "filing", priority: "REQUIRED", impact: "FILING" }),
            item({ id: "approval", priority: "REQUIRED", impact: "APPROVAL" }),
          ];

        expect(
          rankGuidanceItems(items).map((i) => i.id),
        ).toEqual(
          ["filing", "approval", "info"],
        );
      },
    );

    it(
      "is deterministic for equal priority and impact, tiebreaking on sortKey",
      () => {
        const items =
          [
            item({ id: "b", priority: "REQUIRED", impact: "FILING", sortKey: "b" }),
            item({ id: "a", priority: "REQUIRED", impact: "FILING", sortKey: "a" }),
          ];

        expect(
          rankGuidanceItems(items).map((i) => i.id),
        ).toEqual(
          ["a", "b"],
        );
      },
    );

    it(
      "does not mutate the input array",
      () => {
        const items =
          [
            item({ id: "opt", priority: "OPTIONAL" }),
            item({ id: "req", priority: "REQUIRED" }),
          ];

        const originalOrder =
          items.map((i) => i.id);

        rankGuidanceItems(
          items,
        );

        expect(
          items.map((i) => i.id),
        ).toEqual(
          originalOrder,
        );
      },
    );
  },
);

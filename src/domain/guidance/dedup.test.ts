import {
  describe,
  expect,
  it,
} from "vitest";

import {
  deduplicateGuidanceItems,
} from "./dedup";

import type {
  GuidanceItem,
} from "./types";

function item(
  id: string,
  family: string,
  overrides: Partial<GuidanceItem> = {},
): GuidanceItem {
  return {
    id,
    rule: "TEST",
    parent: null,
    family,
    priority: "OPTIONAL",
    impact: "INFO",
    actionability: "NAVIGATE",
    title: id,
    reason: "",
    sortKey: id,
    ...overrides,
  };
}

describe(
  "deduplicateGuidanceItems",
  () => {
    it(
      "keeps only the highest-priority item within an exclusive family",
      () => {
        const items: GuidanceItem[] =
          [
            item("low", "fam-a", { priority: "OPTIONAL" }),
            item("high", "fam-a", { priority: "REQUIRED" }),
            item("mid", "fam-a", { priority: "RECOMMENDED" }),
          ];

        expect(
          deduplicateGuidanceItems(items).map((i) => i.id),
        ).toEqual(
          ["high"],
        );
      },
    );

    it(
      "leaves items in different families untouched",
      () => {
        const items: GuidanceItem[] =
          [
            item("a1", "fam-a", { priority: "REQUIRED" }),
            item("b1", "fam-b", { priority: "REQUIRED" }),
          ];

        expect(
          deduplicateGuidanceItems(items).map((i) => i.id).sort(),
        ).toEqual(
          ["a1", "b1"],
        );
      },
    );

    it(
      "breaks a same-priority tie within a family using impact severity, then sortKey",
      () => {
        const items: GuidanceItem[] =
          [
            item("info", "fam-a", { priority: "REQUIRED", impact: "INFO", sortKey: "z" }),
            item("filing", "fam-a", { priority: "REQUIRED", impact: "FILING", sortKey: "a" }),
          ];

        expect(
          deduplicateGuidanceItems(items).map((i) => i.id),
        ).toEqual(
          ["filing"],
        );
      },
    );

    it(
      "a family with a single item is unaffected",
      () => {
        const items: GuidanceItem[] =
          [
            item("solo", "fam-a"),
          ];

        expect(
          deduplicateGuidanceItems(items).map((i) => i.id),
        ).toEqual(
          ["solo"],
        );
      },
    );

    it(
      "does not mutate the input array",
      () => {
        const items: GuidanceItem[] =
          [
            item("a", "fam-a"),
            item("b", "fam-a"),
          ];

        deduplicateGuidanceItems(
          items,
        );

        expect(items).toHaveLength(2);
      },
    );
  },
);

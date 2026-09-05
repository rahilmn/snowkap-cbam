import {
  describe,
  expect,
  it,
} from "vitest";

import {
  DASHBOARD_GUIDANCE_CAP,
  capGuidanceItems,
} from "./cap";

import type {
  GuidanceItem,
} from "./types";

function item(
  id: string,
  overrides: Partial<GuidanceItem> = {},
): GuidanceItem {
  return {
    id,
    rule: "TEST",
    parent: null,
    family: id,
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
  "capGuidanceItems",
  () => {
    it(
      "the dashboard cap is 3",
      () => {
        expect(DASHBOARD_GUIDANCE_CAP).toBe(3);
      },
    );

    it(
      "fills up to the cap from REQUIRED, then RECOMMENDED, then OPTIONAL when REQUIRED is under the cap",
      () => {
        const items =
          [
            item("r1", { priority: "REQUIRED" }),
            item("rec1", { priority: "RECOMMENDED" }),
            item("rec2", { priority: "RECOMMENDED" }),
            item("opt1", { priority: "OPTIONAL" }),
          ];

        const result =
          capGuidanceItems(
            items,
          );

        expect(
          result.visible.map((i) => i.id),
        ).toEqual(
          ["r1", "rec1", "rec2"],
        );

        expect(result.requiredOverflowCount).toBe(0);
      },
    );

    it(
      "never drops a REQUIRED item, even when there are more than the cap -- tested explicitly at 3 (fits exactly) vs 4 (exceeds)",
      () => {
        const threeRequired =
          capGuidanceItems(
            [
              item("r1", { priority: "REQUIRED" }),
              item("r2", { priority: "REQUIRED" }),
              item("r3", { priority: "REQUIRED" }),
              item("opt1", { priority: "OPTIONAL" }),
            ],
          );

        expect(
          threeRequired.visible.map((i) => i.id),
        ).toEqual(
          ["r1", "r2", "r3"],
        );

        expect(threeRequired.requiredOverflowCount).toBe(0);

        const fourRequired =
          capGuidanceItems(
            [
              item("r1", { priority: "REQUIRED" }),
              item("r2", { priority: "REQUIRED" }),
              item("r3", { priority: "REQUIRED" }),
              item("r4", { priority: "REQUIRED" }),
              item("opt1", { priority: "OPTIONAL" }),
            ],
          );

        // All 4 REQUIRED items remain VISIBLE -- the cap never hides
        // required work (v2.1.1: "preserve REQUIRED visibility /
        // overflow control"). OPTIONAL does not fit and is dropped.
        expect(
          fourRequired.visible.map((i) => i.id),
        ).toEqual(
          ["r1", "r2", "r3", "r4"],
        );

        // requiredOverflowCount signals to the UI that REQUIRED work
        // exceeded the nominal cap (for an "overflow" visual/count),
        // without it meaning anything was hidden.
        expect(fourRequired.requiredOverflowCount).toBe(1);
      },
    );

    it(
      "an empty list caps to an empty list",
      () => {
        expect(
          capGuidanceItems([]).visible,
        ).toEqual(
          [],
        );
      },
    );

    it(
      "does not mutate the input array",
      () => {
        const items =
          [
            item("a", { priority: "OPTIONAL" }),
          ];

        capGuidanceItems(
          items,
        );

        expect(items).toHaveLength(1);
      },
    );
  },
);

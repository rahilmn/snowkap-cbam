import {
  describe,
  expect,
  it,
} from "vitest";

import {
  applyGuidanceDismissals,
} from "./dismiss";

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
  "applyGuidanceDismissals",
  () => {
    it(
      "hides a dismissed item once it is no longer REQUIRED",
      () => {
        const items =
          [
            item("a", { priority: "RECOMMENDED" }),
          ];

        expect(
          applyGuidanceDismissals(items, new Set(["a"])).map((i) => i.id),
        ).toEqual(
          [],
        );
      },
    );

    it(
      "REQUIRED items ignore dismissal entirely and always remain visible",
      () => {
        const items =
          [
            item("a", { priority: "REQUIRED" }),
          ];

        expect(
          applyGuidanceDismissals(items, new Set(["a"])).map((i) => i.id),
        ).toEqual(
          ["a"],
        );
      },
    );

    it(
      "an item that reappears/escalates to REQUIRED after being dismissed while RECOMMENDED becomes visible again -- no snooze, dismissal simply stops applying",
      () => {
        const dismissed =
          new Set(
            ["a"],
          );

        const whileRecommended =
          applyGuidanceDismissals(
            [item("a", { priority: "RECOMMENDED" })],
            dismissed,
          );

        expect(whileRecommended).toHaveLength(0);

        const afterEscalatingToRequired =
          applyGuidanceDismissals(
            [item("a", { priority: "REQUIRED" })],
            dismissed,
          );

        expect(
          afterEscalatingToRequired.map((i) => i.id),
        ).toEqual(
          ["a"],
        );
      },
    );

    it(
      "an undismissed item is unaffected regardless of priority",
      () => {
        const items =
          [
            item("a", { priority: "OPTIONAL" }),
            item("b", { priority: "RECOMMENDED" }),
            item("c", { priority: "REQUIRED" }),
          ];

        expect(
          applyGuidanceDismissals(items, new Set()).map((i) => i.id),
        ).toEqual(
          ["a", "b", "c"],
        );
      },
    );

    it(
      "does not mutate the input array",
      () => {
        const items =
          [
            item("a", { priority: "RECOMMENDED" }),
          ];

        applyGuidanceDismissals(
          items,
          new Set(["a"]),
        );

        expect(items).toHaveLength(1);
      },
    );
  },
);

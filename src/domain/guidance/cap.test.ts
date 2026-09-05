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

/**
 * 2026-09-05 (S2 remediation, B1, fresh Opus 5 review). capGuidanceItems
 * USED to place every REQUIRED item into `visible` uncapped, while
 * ALSO reporting requiredOverflowCount for the excess -- so the
 * dashboard rendered every REQUIRED card AND a "(+N more required)"
 * label that counted items already on screen. The dashboard cap is now
 * a REAL cap: `visible` is always at most DASHBOARD_GUIDANCE_CAP items,
 * full stop. `hiddenCount`/`requiredOverflowCount` describe what was
 * left OUT of `visible`, for a caller to render an explicit,
 * reachable overflow control (never to inflate what's shown) -- the
 * complete ranked set remains available via /attention
 * (app/attention/page.tsx), which capGuidanceItems has no part in.
 */
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
      "1-3 items -> exactly those items are visible, no overflow",
      () => {
        const oneItem =
          capGuidanceItems(
            [item("a")],
          );

        expect(oneItem.visible.map((i) => i.id)).toEqual(["a"]);
        expect(oneItem.hiddenCount).toBe(0);
        expect(oneItem.requiredOverflowCount).toBe(0);

        const threeItems =
          capGuidanceItems(
            [item("a"), item("b"), item("c")],
          );

        expect(threeItems.visible.map((i) => i.id)).toEqual(["a", "b", "c"]);
        expect(threeItems.hiddenCount).toBe(0);
        expect(threeItems.requiredOverflowCount).toBe(0);
      },
    );

    it(
      "4 non-REQUIRED items -> exactly 3 cards visible, hiddenCount 1, requiredOverflowCount 0 (a generic 'See all' overflow, not a required-specific one)",
      () => {
        const result =
          capGuidanceItems(
            [
              item("rec1", { priority: "RECOMMENDED" }),
              item("rec2", { priority: "RECOMMENDED" }),
              item("opt1", { priority: "OPTIONAL" }),
              item("opt2", { priority: "OPTIONAL" }),
            ],
          );

        expect(result.visible.map((i) => i.id)).toEqual(["rec1", "rec2", "opt1"]);
        expect(result.hiddenCount).toBe(1);
        expect(result.requiredOverflowCount).toBe(0);
      },
    );

    it(
      ">3 REQUIRED items -> exactly 3 cards visible, and requiredOverflowCount is the EXACT count of REQUIRED items left out (not the total hidden, not an approximation)",
      () => {
        const result =
          capGuidanceItems(
            [
              item("r1", { priority: "REQUIRED" }),
              item("r2", { priority: "REQUIRED" }),
              item("r3", { priority: "REQUIRED" }),
              item("r4", { priority: "REQUIRED" }),
              item("r5", { priority: "REQUIRED" }),
            ],
          );

        expect(result.visible.map((i) => i.id)).toEqual(["r1", "r2", "r3"]);
        expect(result.visible).toHaveLength(3);
        expect(result.hiddenCount).toBe(2);
        expect(result.requiredOverflowCount).toBe(2);
      },
    );

    it(
      "no hidden REQUIRED item ever leaks into `visible` past the cap, however many REQUIRED items exist",
      () => {
        const manyRequired =
          Array.from(
            { length: 10 },
            (_, index) => item(`r${index}`, { priority: "REQUIRED" }),
          );

        const result =
          capGuidanceItems(
            manyRequired,
          );

        expect(result.visible).toHaveLength(
          DASHBOARD_GUIDANCE_CAP,
        );

        expect(result.requiredOverflowCount).toBe(
          7,
        );
      },
    );

    it(
      "a mix where REQUIRED fills the cap exactly (3 REQUIRED + 2 OPTIONAL) -> visible is the 3 REQUIRED, hidden are the 2 OPTIONAL, requiredOverflowCount 0",
      () => {
        const result =
          capGuidanceItems(
            [
              item("r1", { priority: "REQUIRED" }),
              item("r2", { priority: "REQUIRED" }),
              item("r3", { priority: "REQUIRED" }),
              item("opt1", { priority: "OPTIONAL" }),
              item("opt2", { priority: "OPTIONAL" }),
            ],
          );

        expect(result.visible.map((i) => i.id)).toEqual(["r1", "r2", "r3"]);
        expect(result.hiddenCount).toBe(2);
        expect(result.requiredOverflowCount).toBe(0);
      },
    );

    it(
      "a mix where REQUIRED overflows PAST the cap alongside other items -> requiredOverflowCount counts only the hidden REQUIRED ones, not the hidden total",
      () => {
        // Ranked order assumed already applied by rank.ts: REQUIRED
        // sorts before RECOMMENDED/OPTIONAL, so the 4th REQUIRED item
        // is what's pushed out of the first 3 slots, not the
        // RECOMMENDED one.
        const result =
          capGuidanceItems(
            [
              item("r1", { priority: "REQUIRED" }),
              item("r2", { priority: "REQUIRED" }),
              item("r3", { priority: "REQUIRED" }),
              item("r4", { priority: "REQUIRED" }),
              item("rec1", { priority: "RECOMMENDED" }),
            ],
          );

        expect(result.visible.map((i) => i.id)).toEqual(["r1", "r2", "r3"]);
        expect(result.hiddenCount).toBe(2);
        expect(result.requiredOverflowCount).toBe(1);
      },
    );

    it(
      "an empty list caps to an empty list, no overflow",
      () => {
        const result =
          capGuidanceItems(
            [],
          );

        expect(result.visible).toEqual(
          [],
        );

        expect(result.hiddenCount).toBe(0);
        expect(result.requiredOverflowCount).toBe(0);
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

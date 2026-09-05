import {
  describe,
  expect,
  it,
} from "vitest";

import {
  runGuidancePipeline,
} from "./pipeline";

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
  "runGuidancePipeline",
  () => {
    it(
      "applies aggregate -> rank -> deduplicate -> dismiss, in that exact order, returning the complete (uncapped) ranked set",
      () => {
        const items =
          [
            // Four line-level items on the same parent -- must collapse
            // to one aggregate BEFORE ranking/dedup/cap see them.
            item("L1", { rule: "LINE", parent: { type: "shipment", id: "S1", label: "S1" }, priority: "OPTIONAL" }),
            item("L2", { rule: "LINE", parent: { type: "shipment", id: "S1", label: "S1" }, priority: "OPTIONAL" }),
            item("L3", { rule: "LINE", parent: { type: "shipment", id: "S1", label: "S1" }, priority: "OPTIONAL" }),
            item("L4", { rule: "LINE", parent: { type: "shipment", id: "S1", label: "S1" }, priority: "REQUIRED" }),

            // A required item, dismissed -- must remain visible anyway.
            item("req-dismissed", { priority: "REQUIRED" }),

            // A recommended item, dismissed -- must be filtered.
            item("rec-dismissed", { priority: "RECOMMENDED" }),

            // Two items sharing a family -- only the higher-priority one survives dedup.
            item("fam-low", { family: "shared-fam", priority: "OPTIONAL" }),
            item("fam-high", { family: "shared-fam", priority: "RECOMMENDED" }),
          ];

        const result =
          runGuidancePipeline(
            items,
            new Set(["req-dismissed", "rec-dismissed"]),
          );

        const ids =
          result.map((i) => i.id);

        // The 4 line items collapsed into one aggregate (REQUIRED,
        // since L4 was REQUIRED -- most-severe-member).
        expect(
          ids.some((id) => id.startsWith("aggregate:LINE:")),
        ).toBe(
          true,
        );

        expect(ids).not.toContain("L1");
        expect(ids).not.toContain("L2");
        expect(ids).not.toContain("L3");
        expect(ids).not.toContain("L4");

        // Dismissal: REQUIRED survives, RECOMMENDED is filtered.
        expect(ids).toContain("req-dismissed");
        expect(ids).not.toContain("rec-dismissed");

        // Dedup: only the higher-priority family member survives.
        expect(ids).toContain("fam-high");
        expect(ids).not.toContain("fam-low");

        // Ranking: REQUIRED items (the aggregate + req-dismissed) sort
        // before the RECOMMENDED fam-high.
        const aggregateIndex =
          ids.findIndex((id) => id.startsWith("aggregate:"));

        const famHighIndex =
          ids.indexOf("fam-high");

        expect(aggregateIndex).toBeLessThan(famHighIndex);
      },
    );

    it(
      "returns an empty list for an empty input",
      () => {
        expect(
          runGuidancePipeline([], new Set()),
        ).toEqual(
          [],
        );
      },
    );

    it(
      "does not cap -- more than DASHBOARD_GUIDANCE_CAP items all remain in the result (capping is the dashboard's own separate step, see cap.ts)",
      () => {
        const items =
          Array.from(
            { length: 10 },
            (_, index) => item(`r${index}`, { priority: "REQUIRED" }),
          );

        const result =
          runGuidancePipeline(
            items,
            new Set(),
          );

        expect(result).toHaveLength(10);
      },
    );
  },
);

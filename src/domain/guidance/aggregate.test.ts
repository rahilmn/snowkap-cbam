import {
  describe,
  expect,
  it,
} from "vitest";

import {
  aggregateGuidanceItems,
} from "./aggregate";

import type {
  GuidanceItem,
} from "./types";

function lineItem(
  id: string,
  shipmentId: string,
  overrides: Partial<GuidanceItem> = {},
): GuidanceItem {
  return {
    id,
    rule: "I_LINE_TEST",
    parent: {
      type: "shipment",
      id: shipmentId,
      label: `SHIP-${shipmentId}`,
    },
    family: id,
    priority: "RECOMMENDED",
    impact: "DATA_ENTRY",
    actionability: "NAVIGATE",
    title: id,
    reason: "",
    sortKey: id,
    ...overrides,
  };
}

describe(
  "aggregateGuidanceItems",
  () => {
    it(
      "leaves 1-3 same-(rule,parent) members individual (unchanged)",
      () => {
        const items =
          [
            lineItem("L1", "S1"),
            lineItem("L2", "S1"),
            lineItem("L3", "S1"),
          ];

        const result =
          aggregateGuidanceItems(
            items,
          );

        expect(
          result,
        ).toHaveLength(
          3,
        );

        expect(
          result.map((i) => i.id),
        ).toEqual(
          ["L1", "L2", "L3"],
        );

        expect(
          result.every((i) => i.aggregateCount === undefined),
        ).toBe(
          true,
        );
      },
    );

    it(
      "collapses 4+ same-(rule,parent) members into exactly one aggregate item -- tested explicitly at the 3-vs-4 boundary",
      () => {
        const three =
          aggregateGuidanceItems(
            [
              lineItem("L1", "S1"),
              lineItem("L2", "S1"),
              lineItem("L3", "S1"),
            ],
          );

        expect(three).toHaveLength(3);

        const four =
          aggregateGuidanceItems(
            [
              lineItem("L1", "S1"),
              lineItem("L2", "S1"),
              lineItem("L3", "S1"),
              lineItem("L4", "S1"),
            ],
          );

        expect(four).toHaveLength(1);
        expect(four[0]?.aggregateCount).toBe(4);
        expect(four[0]?.derivedFrom).toEqual(
          ["L1", "L2", "L3", "L4"],
        );
      },
    );

    it(
      "aggregate priority/impact is the most severe member's",
      () => {
        const result =
          aggregateGuidanceItems(
            [
              lineItem("L1", "S1", { priority: "OPTIONAL", impact: "INFO" }),
              lineItem("L2", "S1", { priority: "REQUIRED", impact: "DATA_ENTRY" }),
              lineItem("L3", "S1", { priority: "RECOMMENDED", impact: "FILING" }),
              lineItem("L4", "S1", { priority: "OPTIONAL", impact: "SETUP" }),
            ],
          );

        expect(result).toHaveLength(1);
        expect(result[0]?.priority).toBe("REQUIRED");
        expect(result[0]?.impact).toBe("FILING");
      },
    );

    it(
      "aggregate sort position is the best (lowest-ranked) member's sortKey",
      () => {
        const result =
          aggregateGuidanceItems(
            [
              lineItem("L1", "S1", { sortKey: "z" }),
              lineItem("L2", "S1", { sortKey: "m" }),
              lineItem("L3", "S1", { sortKey: "a" }),
              lineItem("L4", "S1", { sortKey: "q" }),
            ],
          );

        expect(result[0]?.sortKey).toBe(
          "a",
        );
      },
    );

    it(
      "groups by (rule, parent) -- different shipments never aggregate together, even at 4+ each",
      () => {
        const result =
          aggregateGuidanceItems(
            [
              lineItem("L1", "S1"),
              lineItem("L2", "S1"),
              lineItem("L3", "S1"),
              lineItem("L4", "S1"),
              lineItem("M1", "S2"),
              lineItem("M2", "S2"),
              lineItem("M3", "S2"),
              lineItem("M4", "S2"),
            ],
          );

        expect(result).toHaveLength(2);

        expect(
          result.map((i) => i.aggregateCount).sort(),
        ).toEqual(
          [4, 4],
        );
      },
    );

    it(
      "never aggregates items whose parent is null (org-level/period-level items, and any rule with no specified parent grouping), regardless of count",
      () => {
        const noParent = (
          id: string,
        ): GuidanceItem => (
          {
            id,
            rule: "I19",
            parent: null,
            family: id,
            priority: "REQUIRED",
            impact: "APPROVAL",
            actionability: "NAVIGATE",
            title: id,
            reason: "",
            sortKey: id,
          }
        );

        const result =
          aggregateGuidanceItems(
            [
              noParent("I19:S1"),
              noParent("I19:S2"),
              noParent("I19:S3"),
              noParent("I19:S4"),
              noParent("I19:S5"),
            ],
          );

        expect(result).toHaveLength(5);
        expect(result.every((i) => i.aggregateCount === undefined)).toBe(true);
      },
    );

    it(
      "producer record-level rules group by installation (same (rule,parent) mechanism, different parent type)",
      () => {
        const recordItem = (
          id: string,
          installationId: string,
        ): GuidanceItem => (
          {
            id,
            rule: "I_RECORD_TEST",
            parent: { type: "installation", id: installationId, label: `INST-${installationId}` },
            family: id,
            priority: "RECOMMENDED",
            impact: "DATA_ENTRY",
            actionability: "NAVIGATE",
            title: id,
            reason: "",
            sortKey: id,
          }
        );

        const result =
          aggregateGuidanceItems(
            [
              recordItem("R1", "I1"),
              recordItem("R2", "I1"),
              recordItem("R3", "I1"),
              recordItem("R4", "I1"),
            ],
          );

        expect(result).toHaveLength(1);
        expect(result[0]?.aggregateCount).toBe(4);
        expect(result[0]?.parent?.type).toBe("installation");
      },
    );
  },
);

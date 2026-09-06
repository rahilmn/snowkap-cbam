import {
  describe,
  expect,
  it,
} from "vitest";

import {
  deriveProducerRejectedEmissionDataItems,
} from "./producer-rejected-emission-data";

describe(
  "deriveProducerRejectedEmissionDataItems",
  () => {
    it(
      "derives a REQUIRED, installation-grouped item for a rejected record",
      async () => {
        const items =
          deriveProducerRejectedEmissionDataItems(
            [
              {
                id: "ed-1" as never,
                installation_id: "inst-1" as never,
                installation_name: "Steel Works A",
                rejection_reason: "Missing evidence",
              },
            ],
          );

        expect(items).toHaveLength(
          1,
        );

        const item =
          items[0]!;

        expect(item.rule).toBe(
          "PRODUCER_REJECTED",
        );

        expect(item.priority).toBe(
          "REQUIRED",
        );

        expect(item.parent).toEqual(
          { type: "installation", id: "inst-1", label: "Steel Works A" },
        );

        expect(item.reason).toContain(
          "Missing evidence",
        );

        expect(item.href).toBe(
          "/emission-data",
        );
      },
    );

    it(
      "produces a deterministic id keyed on the record, so a dismissal fingerprint stays stable across re-derivations",
      async () => {
        const items =
          deriveProducerRejectedEmissionDataItems(
            [
              {
                id: "ed-1" as never,
                installation_id: "inst-1" as never,
                installation_name: "Steel Works A",
                rejection_reason: null,
              },
            ],
          );

        expect(items[0]?.id).toBe(
          "PRODUCER_REJECTED:ed-1",
        );

        expect(items[0]?.family).toBe(
          "PRODUCER_REJECTED:ed-1",
        );
      },
    );

    it(
      "falls back to a generic reason when no rejection_reason was recorded",
      async () => {
        const items =
          deriveProducerRejectedEmissionDataItems(
            [
              {
                id: "ed-1" as never,
                installation_id: "inst-1" as never,
                installation_name: "Steel Works A",
                rejection_reason: null,
              },
            ],
          );

        expect(items[0]?.reason).toBe(
          "An admin rejected this record. Fix it and resubmit for verification.",
        );
      },
    );

    it(
      "returns one item per record, independently -- no dedup/grouping performed here (the pipeline's own dedup.ts owns that)",
      async () => {
        const items =
          deriveProducerRejectedEmissionDataItems(
            [
              { id: "ed-1" as never, installation_id: "inst-1" as never, installation_name: "Steel Works A", rejection_reason: null },
              { id: "ed-2" as never, installation_id: "inst-1" as never, installation_name: "Steel Works A", rejection_reason: null },
            ],
          );

        expect(items).toHaveLength(
          2,
        );
      },
    );

    it(
      "returns an empty array for no rejected records",
      async () => {
        expect(
          deriveProducerRejectedEmissionDataItems(
            [],
          ),
        ).toEqual(
          [],
        );
      },
    );
  },
);

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
                installation_provenance: "OPERATOR_PROVIDED",
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
                installation_provenance: "OPERATOR_PROVIDED",
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
                installation_provenance: "OPERATOR_PROVIDED",
                rejection_reason: null,
              },
            ],
          );

        expect(items[0]?.reason).toBe(
          "An admin rejected this record. Fix it and resubmit for internal review.",
        );
      },
    );

    it(
      "2026-09-06 (S5 review remediation, finding D1/S5R-B3): never says 'verification' -- this is internal review, not external verification",
      async () => {
        const items =
          deriveProducerRejectedEmissionDataItems(
            [
              {
                id: "ed-1" as never,
                installation_id: "inst-1" as never,
                installation_name: "Steel Works A",
                installation_provenance: "OPERATOR_PROVIDED",
                rejection_reason: "Missing evidence",
              },
              {
                id: "ed-2" as never,
                installation_id: "inst-1" as never,
                installation_name: "Steel Works A",
                installation_provenance: "OPERATOR_PROVIDED",
                rejection_reason: null,
              },
            ],
          );

        for (const item of items) {
          expect(item.reason).not.toMatch(
            /\bverif(y|ies|ied|ication|ications)\b/i,
          );

          expect(item.reason).toContain(
            "internal review",
          );
        }
      },
    );

    it(
      "2026-09-06 (S5 review remediation, finding D2/EF-B1): routes to /external-emissions for an IMPORTER_ENTERED record, /emission-data for an OPERATOR_PROVIDED one -- the RECORD's own provenance, not a fixed route",
      async () => {
        const items =
          deriveProducerRejectedEmissionDataItems(
            [
              {
                id: "ed-1" as never,
                installation_id: "inst-1" as never,
                installation_name: "Steel Works A",
                installation_provenance: "OPERATOR_PROVIDED",
                rejection_reason: null,
              },
              {
                id: "ed-2" as never,
                installation_id: "inst-2" as never,
                installation_name: "External Supplier B",
                installation_provenance: "IMPORTER_ENTERED",
                rejection_reason: null,
              },
            ],
          );

        expect(items[0]?.href).toBe(
          "/emission-data",
        );

        expect(items[1]?.href).toBe(
          "/external-emissions",
        );
      },
    );

    it(
      "returns one item per record, independently -- no dedup/grouping performed here (the pipeline's own dedup.ts owns that)",
      async () => {
        const items =
          deriveProducerRejectedEmissionDataItems(
            [
              { id: "ed-1" as never, installation_id: "inst-1" as never, installation_name: "Steel Works A", installation_provenance: "OPERATOR_PROVIDED", rejection_reason: null },
              { id: "ed-2" as never, installation_id: "inst-1" as never, installation_name: "Steel Works A", installation_provenance: "OPERATOR_PROVIDED", rejection_reason: null },
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

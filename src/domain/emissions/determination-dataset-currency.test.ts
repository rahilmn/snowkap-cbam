import {
  describe,
  expect,
  it,
} from "vitest";

import {
  determinationDatasetIsCurrent,
} from "./determination-dataset-currency";

describe(
  "determinationDatasetIsCurrent",
  () => {
    it(
      "returns true for a null determination -- meaningless, never itself a blocker",
      () => {
        expect(
          determinationDatasetIsCurrent(
            null,
            new Set(["dataset-1"]),
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "returns true for an ACTUAL determination -- no regulatory dataset is resolved for one",
      () => {
        expect(
          determinationDatasetIsCurrent(
            { method: "ACTUAL", snapshot: {} as never },
            new Set(["dataset-1"]),
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "returns true for a DEFAULT determination whose dataset_id is in the active set",
      () => {
        expect(
          determinationDatasetIsCurrent(
            { method: "DEFAULT", resolution: { dataset_id: "dataset-1" } as never },
            new Set(["dataset-1", "dataset-2"]),
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "returns false for a DEFAULT determination whose dataset_id is NOT in the active set -- superseded",
      () => {
        expect(
          determinationDatasetIsCurrent(
            { method: "DEFAULT", resolution: { dataset_id: "dataset-superseded" } as never },
            new Set(["dataset-1"]),
          ),
        ).toBe(
          false,
        );
      },
    );

    it(
      "2026-09-06 (S5 review remediation, finding A1): returns false, never throws, for a legacy-shape DEFAULT determination with no `resolution` object at all",
      () => {
        expect(
          () =>
            determinationDatasetIsCurrent(
              { method: "DEFAULT", resolved_value_id: null } as never,
              new Set(["dataset-1"]),
            ),
        ).not.toThrow();

        expect(
          determinationDatasetIsCurrent(
            { method: "DEFAULT", resolved_value_id: null } as never,
            new Set(["dataset-1"]),
          ),
        ).toBe(
          false,
        );
      },
    );

    it(
      "returns false, never throws, for a DEFAULT determination whose resolution exists but has no dataset_id",
      () => {
        expect(
          determinationDatasetIsCurrent(
            { method: "DEFAULT", resolution: {} as never },
            new Set(["dataset-1"]),
          ),
        ).toBe(
          false,
        );
      },
    );
  },
);

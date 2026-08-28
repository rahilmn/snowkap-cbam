import {
  describe,
  expect,
  it,
} from "vitest";

import {
  deriveExperience,
} from "./app-shell";

describe(
  "deriveExperience",
  () => {
    it(
      "is importer when the org has only IMPORTER_DECLARANT",
      () => {
        expect(
          deriveExperience(
            ["IMPORTER_DECLARANT"],
          ),
        ).toBe(
          "importer",
        );
      },
    );

    it(
      "is producer when the org has only PRODUCER_OPERATOR",
      () => {
        expect(
          deriveExperience(
            ["PRODUCER_OPERATOR"],
          ),
        ).toBe(
          "producer",
        );
      },
    );

    it(
      "is importer when the org has both capabilities (importer-first release order)",
      () => {
        expect(
          deriveExperience(
            ["IMPORTER_DECLARANT", "PRODUCER_OPERATOR"],
          ),
        ).toBe(
          "importer",
        );
      },
    );

    it(
      "is importer when there is no org yet (undefined capabilities)",
      () => {
        expect(
          deriveExperience(
            undefined,
          ),
        ).toBe(
          "importer",
        );
      },
    );

    it(
      "is importer when capabilities is an empty array",
      () => {
        expect(
          deriveExperience(
            [],
          ),
        ).toBe(
          "importer",
        );
      },
    );
  },
);

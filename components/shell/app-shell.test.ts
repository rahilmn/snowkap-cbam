import {
  describe,
  expect,
  it,
} from "vitest";

import {
  deriveExperience,
  resolveExperience,
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

describe(
  "resolveExperience",
  () => {
    it(
      "honors the cookie preference for a dual-capability org",
      () => {
        expect(
          resolveExperience(
            ["IMPORTER_DECLARANT", "PRODUCER_OPERATOR"],
            "producer",
          ),
        ).toBe(
          "producer",
        );

        expect(
          resolveExperience(
            ["IMPORTER_DECLARANT", "PRODUCER_OPERATOR"],
            "importer",
          ),
        ).toBe(
          "importer",
        );
      },
    );

    it(
      "falls back to deriveExperience's default when a dual-capability org has no cookie preference",
      () => {
        expect(
          resolveExperience(
            ["IMPORTER_DECLARANT", "PRODUCER_OPERATOR"],
            undefined,
          ),
        ).toBe(
          "importer",
        );
      },
    );

    it(
      "ignores the cookie preference entirely for a single-capability org -- a forged/stale cookie can never override the org's real, only-possible layout",
      () => {
        expect(
          resolveExperience(
            ["PRODUCER_OPERATOR"],
            "importer",
          ),
        ).toBe(
          "producer",
        );

        expect(
          resolveExperience(
            ["IMPORTER_DECLARANT"],
            "producer",
          ),
        ).toBe(
          "importer",
        );
      },
    );

    it(
      "ignores the cookie preference when there is no org yet",
      () => {
        expect(
          resolveExperience(
            undefined,
            "producer",
          ),
        ).toBe(
          "importer",
        );
      },
    );
  },
);

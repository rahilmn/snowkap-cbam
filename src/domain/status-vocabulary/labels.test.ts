import {
  describe,
  it,
  expect,
} from "vitest";

import {
  STATUS_LABEL,
  STATUS_TONE,
} from "./labels";

import {
  ALLOWED_VERIFICATION_PHRASES,
} from "./verification-phrases";

const VERIFICATION_WORD =
  /\bverif(y|ies|ied|ication|ications)\b/i;

function escapeRegExp(
  text: string,
): string {
  return text.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
}

function usesOnlyAllowedVerificationPhrases(
  text: string,
): boolean {
  let sanitized =
    text;

  for (
    const phrase of ALLOWED_VERIFICATION_PHRASES
  ) {
    sanitized =
      sanitized.replace(
        new RegExp(
          escapeRegExp(phrase),
          "gi",
        ),
        "",
      );
  }

  return !VERIFICATION_WORD.test(
    sanitized,
  );
}

describe(
  "STATUS_LABEL",
  () => {
    it(
      "has exactly one tone per declared key, and vice versa",
      () => {
        expect(Object.keys(STATUS_LABEL).sort()).toEqual(
          Object.keys(STATUS_TONE).sort(),
        );
      },
    );

    it(
      "never uses \"verified\"/\"verification\" as a synonym for internal review -- v2.1.1 §3 Correction B",
      () => {
        for (
          const [key, label] of Object.entries(STATUS_LABEL)
        ) {
          expect(
            usesOnlyAllowedVerificationPhrases(label),
            `${key}: "${label}" uses "verified"/"verification" outside the allowed phrases`,
          ).toBe(true);
        }
      },
    );

    it(
      "contains no key or label that means \"validated by Snowkap\" -- there is no such key, by design",
      () => {
        for (
          const key of Object.keys(STATUS_LABEL)
        ) {
          expect(key.toLowerCase()).not.toContain("validated");
        }

        for (
          const label of Object.values(STATUS_LABEL)
        ) {
          expect(label.toLowerCase()).not.toContain("validated by snowkap");
        }
      },
    );
  },
);

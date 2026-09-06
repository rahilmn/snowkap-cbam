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

function stripAllowedVerificationPhrases(
  text: string,
): string {
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

  return sanitized;
}

function usesOnlyAllowedVerificationPhrases(
  text: string,
): boolean {
  return !VERIFICATION_WORD.test(
    stripAllowedVerificationPhrases(
      text,
    ),
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

        // Stripped of the allowed phrases first (S4, v2.1.1 sections
        // 10/13 added "verifier_report.DECLARED": "...(not validated
        // by Snowkap)" -- the NEGATION of the exact claim this test
        // bans, already pre-approved in ALLOWED_VERIFICATION_PHRASES
        // as "not validated by snowkap". A bare substring check cannot
        // tell "X is validated by Snowkap" from "X is NOT validated by
        // Snowkap" apart; stripping the allowed (negated) phrase first
        // is what makes this test check what its own title says,
        // rather than banning the one sentence v2.1.1 requires.
        for (
          const label of Object.values(STATUS_LABEL)
        ) {
          expect(
            stripAllowedVerificationPhrases(
              label.toLowerCase(),
            ),
          ).not.toContain("validated by snowkap");
        }
      },
    );
  },
);

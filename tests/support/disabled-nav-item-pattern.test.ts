import {
  describe,
  expect,
  it,
} from "vitest";

import {
  disabledNavItemNamePattern,
} from "./disabled-nav-item-pattern";

/**
 * S1 remediation (independent Opus 5 review, S1 finding #1).
 *
 * tests/e2e/shell.spec.ts used to build this exact pattern inline as
 * `new RegExp(\`^${label} \(.+\)$\`)`. Inside a template literal,
 * `\(`/`\)` are not recognized JS escape sequences, so the backslash
 * is dropped BEFORE the string reaches RegExp -- the pattern RegExp
 * actually received was `^${label} (.+)$`, where the unescaped parens
 * open a capture group instead of matching literal characters. That
 * matches "Label anything", with no parentheses required at all --
 * currently unreachable in the real suite only because no importer
 * nav item is presently a disabled `role: "button"` placeholder.
 */
describe(
  "disabledNavItemNamePattern",
  () => {
    it(
      "matches a disabled item's real accessible name -- label, space, reason in literal parentheses",
      () => {
        expect(
          disabledNavItemNamePattern("Evidence").test(
            "Evidence (Evidence is attached per dataset -- open Emission data and use each record's Evidence section)",
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "requires literal parentheses around the reason -- does not match the label plus arbitrary trailing text",
      () => {
        // The exact case the unescaped-parens bug incorrectly matched:
        // `^${label} (.+)$` (parens read as a capture group, not
        // literal characters) accepts any text after the label with no
        // parentheses required at all.
        expect(
          disabledNavItemNamePattern("Evidence").test(
            "Evidence anything at all, no parens required",
          ),
        ).toBe(
          false,
        );
      },
    );

    it(
      "requires the parenthesized reason to be non-empty",
      () => {
        expect(
          disabledNavItemNamePattern("Evidence").test(
            "Evidence ()",
          ),
        ).toBe(
          false,
        );
      },
    );

    it(
      "anchors to the whole name -- a longer item's accessible name never satisfies a shorter label's pattern",
      () => {
        expect(
          disabledNavItemNamePattern("Evidence").test(
            "Internal review (Internal review is per dataset)",
          ),
        ).toBe(
          false,
        );
      },
    );

    // S1 remediation (fresh Opus 5 review of 030897d, remaining yellow
    // finding #1): `label` was interpolated into the RegExp source
    // unescaped. Two distinct failure modes, both covered below --
    // an unbalanced-paren label THROWS at construction, and a balanced-
    // but-special-character label (a literal ".", "+", etc.) silently
    // changes what the pattern actually matches instead of throwing.
    it(
      "does not throw when a label contains an unbalanced regex metacharacter (an unmatched opening paren)",
      () => {
        expect(
          () =>
            disabledNavItemNamePattern(
              "Great (value",
            ),
        ).not.toThrow();
      },
    );

    it(
      "treats a regex metacharacter in the label as a LITERAL character, not as regex syntax",
      () => {
        const pattern =
          disabledNavItemNamePattern(
            "Sharing v2.0",
          );

        // Positive: the real accessible name still matches.
        expect(
          pattern.test(
            "Sharing v2.0 (Not available in this release)",
          ),
        ).toBe(
          true,
        );

        // Negative: an unescaped "." in the pattern would match ANY
        // character, so "v2X0" would wrongly satisfy "v2.0" if the
        // label were interpolated raw. A correctly-escaped pattern
        // requires a literal dot and must reject this.
        expect(
          pattern.test(
            "Sharing v2X0 (Not available in this release)",
          ),
        ).toBe(
          false,
        );
      },
    );

    it(
      "treats an unbalanced-paren label as literal text, matching only that exact literal accessible name",
      () => {
        const pattern =
          disabledNavItemNamePattern(
            "Great (value",
          );

        expect(
          pattern.test(
            "Great (value (Not available in this release)",
          ),
        ).toBe(
          true,
        );
      },
    );
  },
);

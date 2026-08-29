import {
  describe,
  expect,
  it,
} from "vitest";

import {
  cnScopeCoversCnCode,
} from "./cn-scope-covers-code";

describe(
  "cnScopeCoversCnCode",
  () => {
    it(
      "covers when a cn_scope entry exactly matches the line's CN8 code",
      () => {
        expect(
          cnScopeCoversCnCode(
            ["72081000"],
            "72081000",
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "covers when a cn_scope entry exactly matches the line's TARIC10 code",
      () => {
        expect(
          cnScopeCoversCnCode(
            ["7208100010"],
            "7208100010",
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "covers a TARIC10 line code when cn_scope declares only the broader CN8 heading it falls under -- same coarser-covers-finer specificity relationship resolve-default-value.ts's codeLevelPriority encodes between CN8 and TARIC10",
      () => {
        expect(
          cnScopeCoversCnCode(
            ["72081000"],
            "7208100010",
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "does NOT cover a broader CN8 line code when cn_scope only declares a narrower TARIC10 sub-code -- a narrow declared dataset must never be treated as covering a broader classification than what it actually scoped",
      () => {
        expect(
          cnScopeCoversCnCode(
            ["7208100010"],
            "72081000",
          ),
        ).toBe(
          false,
        );
      },
    );

    it(
      "does not cover an unrelated CN8 code sharing no common prefix",
      () => {
        expect(
          cnScopeCoversCnCode(
            ["72081000"],
            "25232100",
          ),
        ).toBe(
          false,
        );
      },
    );

    it(
      "does not cover a TARIC10 code that merely shares a numeric prefix without the CN8 heading actually matching (e.g. 72081000 vs 72089000-prefixed code)",
      () => {
        expect(
          cnScopeCoversCnCode(
            ["72081000"],
            "7208900010",
          ),
        ).toBe(
          false,
        );
      },
    );

    it(
      "returns true when ANY entry in a multi-entry cn_scope covers the code, even if others don't",
      () => {
        expect(
          cnScopeCoversCnCode(
            ["25232100", "72081000"],
            "7208100099",
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "returns false for an empty cn_scope array",
      () => {
        expect(
          cnScopeCoversCnCode(
            [],
            "72081000",
          ),
        ).toBe(
          false,
        );
      },
    );

    it(
      "normalizes whitespace in both cn_scope entries and the line code before comparing, matching resolve-default-value.ts's own normalizeCode convention",
      () => {
        expect(
          cnScopeCoversCnCode(
            [" 7208 1000 "],
            "72081000",
          ),
        ).toBe(
          true,
        );
      },
    );
  },
);

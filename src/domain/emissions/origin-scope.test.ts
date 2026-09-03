import {
  describe,
  expect,
  it,
} from "vitest";

import {
  EU_MEMBER_STATE_ISO2,
  originScopeIsUnresolved,
} from "./origin-scope";

/**
 * Owner decision 5: an EU-origin line must not silently become a
 * numeric filing result while CBAM's territorial scope for it is
 * unsettled in this repository.
 *
 * The failing direction is the one that matters. Before this gate, an
 * EU member state had no row in the dataset's country table, mapped to
 * UNLISTED, and R7 clause 1 resolved UNLISTED through the
 * "_Other Countries and Territorie" row -- so the line got a number
 * indistinguishable from an unlisted third country's, and that number
 * was persistable and filable.
 */
describe("origin scope", () => {
  it("treats every EU member state as unresolved", () => {
    for (const iso2 of EU_MEMBER_STATE_ISO2) {
      expect(
        originScopeIsUnresolved(iso2),
        `${iso2} must be refused`,
      ).toBe(true);
    }
  });

  it(
    "treats third countries as settled -- the gate must not quietly stop the " +
      "product working for the origins it exists to serve",
    () => {
      for (const iso2 of ["CN", "IN", "TR", "UA", "GB", "US", "KI", "ZZ"]) {
        expect(
          originScopeIsUnresolved(iso2),
          `${iso2} must NOT be refused`,
        ).toBe(false);
      }
    },
  );

  it(
    "is case- and whitespace-tolerant, because a refusal a lowercase code " +
      "walks past is not a refusal",
    () => {
      for (const value of ["de", " DE ", "De", "\tfr"]) {
        expect(originScopeIsUnresolved(value)).toBe(true);
      }
    },
  );

  it("covers both spellings of Greece, since EU documents use EL", () => {
    expect(originScopeIsUnresolved("GR")).toBe(true);
    expect(originScopeIsUnresolved("EL")).toBe(true);
  });

  it("treats a missing origin as settled rather than guessing", () => {
    expect(originScopeIsUnresolved(null)).toBe(false);
    expect(originScopeIsUnresolved(undefined)).toBe(false);
    expect(originScopeIsUnresolved("")).toBe(false);
  });

  it(
    "lists 28 codes -- 27 member states plus EL. Pinned so that adding or " +
      "removing one is a deliberate act, not a drive-by edit to a list that " +
      "decides whether a line can be filed",
    () => {
      expect(EU_MEMBER_STATE_ISO2).toHaveLength(28);
      expect(EU_MEMBER_STATE_ISO2).not.toContain("GB");
    },
  );
});

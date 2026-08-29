function normalizeCode(
  value: string,
): string {
  return value.replace(/\s+/g, "");
}

/**
 * Does one entry in an emission_data row's cn_scope (the CN codes that
 * record's declared actual-emissions values cover) genuinely cover a
 * shipment line's own declared cn_code -- used by
 * listAvailableActualEmissionData (src/application/emissions/list-available-
 * actual-data.ts) to keep the "determine from actual data" picker from
 * offering a producer's dataset for goods it was never scoped to.
 *
 * Matching convention deliberately mirrors the one the regulatory
 * resolver already uses for exactly this CN8/TARIC10 relationship
 * (src/domain/regulatory/resolve-default-value.ts's codeLevelPriority:
 * TARIC10 is a strictly more specific code than the CN8 heading it falls
 * under), rather than inventing a second one:
 *
 *   - An exact match (same normalized digits) always covers.
 *   - A cn_scope entry that is a genuine, strictly-shorter digit PREFIX
 *     of the line's code also covers it -- an 8-digit CN8 scope entry
 *     covers every 10-digit TARIC10 code nested under that heading, the
 *     same "coarser code subsumes its more specific children" relationship
 *     the resolver's own code-level hierarchy encodes.
 *   - The reverse never covers: a cn_scope entry that is LONGER/more
 *     specific than the line's own declared code is never treated as
 *     covering it. A dataset scoped to one narrow TARIC10 sub-code must
 *     never be silently offered as if it covered the whole broader CN8
 *     heading a line declared at -- that would be exactly the kind of
 *     unearned, silently-widened match this codebase's protected
 *     regulatory resolver refuses to make on the trade-code side (see
 *     CLAUDE.md's "never silently pick among ambiguous candidates" rule);
 *     the same conservatism applies here even though cn_scope coverage
 *     isn't itself part of the protected zone.
 *   - Digits that merely share a common numeric prefix without one
 *     string actually being a prefix of the other (e.g. cn_scope
 *     "72081000" against line code "7208900010") do not cover -- prefix
 *     containment is checked with String.prototype.startsWith on the
 *     full normalized strings, not a partial/fuzzy digit comparison.
 *
 * Whitespace is stripped from both sides before comparing, matching
 * resolve-default-value.ts's own normalizeCode.
 */
export function cnScopeCoversCnCode(
  cnScope: string[],
  cnCode: string,
): boolean {
  const normalizedCode =
    normalizeCode(
      cnCode,
    );

  return cnScope.some(
    (scopeEntry) => {
      const normalizedScope =
        normalizeCode(
          scopeEntry,
        );

      if (normalizedScope === normalizedCode) {
        return true;
      }

      return (
        normalizedScope.length < normalizedCode.length &&
        normalizedCode.startsWith(normalizedScope)
      );
    },
  );
}

/**
 * Whether CBAM's territorial scope is settled for a declared origin.
 *
 * ------------------------------------------------------------------
 * WHY THIS EXISTS (owner decision 5, 2026-09-04)
 *
 * An EU member state declared as a line's origin currently has no row
 * in the regulatory dataset's country table, so it maps to UNLISTED,
 * and R7 clause 1 resolves UNLISTED through the
 * "_Other Countries and Territorie" row. The line gets a number, the
 * number is persisted, and it can be filed -- exactly as if the origin
 * were an unlisted third country.
 *
 * That may be right. It may be badly wrong. The repository does not
 * contain the text that would settle it: no article defining CBAM's
 * territorial scope is cited anywhere in docs/, and Annex III's content
 * -- which lists exempted countries and territories -- is referenced
 * twice but never sourced. The open question is whether
 * "Other countries and territories" is a residual table for THIRD
 * countries only, or for any origin not listed. R7 as transcribed
 * carries no scope precondition; whether one exists upstream is
 * unanswered here.
 *
 * The owner's decision is to stop producing a number while that is
 * unanswered.
 *
 * ------------------------------------------------------------------
 * WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT
 *
 * It is a REFUSAL, and only a refusal. The list below is used to
 * decline to compute, never to compute -- so it cannot make a filed
 * figure wrong. The worst it can do is decline a line it should have
 * accepted, which is visible, recoverable, and the direction this
 * codebase fails in by rule ("no value is not a value of zero").
 *
 * It is NOT a claim that CBAM does not apply to these origins. It is
 * not an exemption, and it must not be described as one in the UI or in
 * an export. Fabricating an exclusion would be the same error as
 * fabricating a value, pointed the other way.
 *
 * It is NOT a regulatory dataset. A hardcoded roster of member states
 * is exactly the shape this project's facts-as-datasets rule exists to
 * forbid, and it is tolerable here only because refusing is not a
 * regulatory computation. When the authoritative scope text is
 * obtained, it enters as a versioned `regulatory_datasets` row like
 * every other regulatory fact, and this module is deleted.
 *
 * Historical snapshots are unaffected: this gate runs before a
 * determination is written, never over one that already exists, so
 * adding the real rule later does not rewrite anything already frozen.
 */

/**
 * ISO 3166-1 alpha-2 codes of the EU member states, as a roster of
 * countries rather than an interpretation of the regulation.
 *
 * Includes `EL` alongside `GR`: the EU's own statistical usage writes
 * Greece as EL, and a declarant transcribing from an EU document may
 * type either. Being wrong in the direction of refusing one extra code
 * is cheap here; being wrong the other way produces a filed number.
 */
export const EU_MEMBER_STATE_ISO2: readonly string[] =
  [
    "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR",
    "DE", "GR", "EL", "HU", "IE", "IT", "LV", "LT", "LU", "MT",
    "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  ];

const EU_SET =
  new Set(EU_MEMBER_STATE_ISO2);

/**
 * Is CBAM's treatment of this declared origin unsettled in this
 * repository?
 *
 * Case- and whitespace-tolerant, because the value comes from a
 * declarant's own data entry and a refusal that a lowercase code walks
 * past is not a refusal.
 */
export function originScopeIsUnresolved(
  originCountry: string | null | undefined,
): boolean {
  if (!originCountry) {
    return false;
  }

  return EU_SET.has(
    originCountry.trim().toUpperCase(),
  );
}

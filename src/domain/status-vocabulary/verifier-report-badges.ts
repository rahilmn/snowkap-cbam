import type {
  VerifierReportStatusKey,
} from "./types";

/**
 * The verifier-report axis of the product's provenance vocabulary
 * (v2.1.1 sections 10/13) -- the THIRD independent fact, alongside
 * SOURCE and REVIEW (review-badges.ts). Mirrors reviewBadgeFor's own
 * shape: a required, non-defaulted input, so a call site cannot render
 * this badge without the actual declared value.
 *
 * `declared` is EmissionDataDeclarationContext.verifier_report_declared
 * (src/domain/emissions/declaration-context-types.ts) -- the
 * OPERATOR's own declaration that a verifier report exists. This
 * function, like reviewBadgeFor, is the only place that boolean is
 * allowed to become user-facing text; it never claims Snowkap
 * validated, checked, or independently confirmed anything (see
 * verification-phrases.ts for the exact allowed wording this backs).
 */
export function verifierReportBadgeFor(
  declared: boolean,
): VerifierReportStatusKey {
  return declared
    ? "verifier_report.DECLARED"
    : "verifier_report.NOT_DECLARED";
}

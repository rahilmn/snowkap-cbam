/**
 * A registry for exact-match tests to import from, NOT a scan bypass
 * (v2.1.1 §3 Correction B: the earlier v2.1 draft granted owner
 * sentences an exception from the prose scan; that exception is
 * removed -- tests/architecture/verification-prose-scan.test.ts does
 * not consult this file).
 *
 * EVIDENCE_INCOMPLETE_NOTICE below is a REVISION of the owner's
 * original 2026-08-28 blocking-model-directive sentence ("...can be
 * used as verified data."), not a verbatim preservation of it -- the
 * original used exactly the word this correction removes. The
 * revision is recorded here as the new single source of truth; this
 * file's job going forward is making sure it never drifts, not
 * claiming it is unchanged from what the owner originally wrote.
 *
 * Rendered at app/(producer)/emission-data/emission-data-list.tsx and
 * mirrored server-side at app/(producer)/emission-data/actions.ts's
 * transitionMessageFor -- both import this constant rather than
 * hardcoding the literal, so the two can never drift from each other.
 */
export const EVIDENCE_INCOMPLETE_NOTICE =
  "Additional evidence is required before these actual emissions can be approved in internal review.";

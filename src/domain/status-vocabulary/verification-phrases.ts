/**
 * The closed set of phrases
 * tests/architecture/verification-prose-scan.test.ts lets through
 * unchanged -- every one names a real, different concept from internal
 * review (v2.1.1 §3 Correction B): accredited/Article 8 verification,
 * a verifier report, Snowkap's own disclaimer that it is not an
 * accredited verifier, and GoTrue email verification. Adding a phrase
 * here is a deliberate vocabulary decision, not a way to silence the
 * scan -- each entry carries its own reason, recorded here.
 *
 * Matching is case-insensitive substring removal (see the scan test),
 * so entries are lowercase.
 */
export const ALLOWED_VERIFICATION_PHRASES: readonly string[] =
  [
    // Accredited (Article 8) verification -- the real regulatory
    // concept this product never claims to perform.
    "accredited verifier",
    "accredited verification",
    "article 8 verification",
    "verifier report",
    "verification body",
    // 2026-09-07 (S5 review round 6, finding S5R6-A-Y1). This entry
    // contains no verif-word substring, so it never itself rescues
    // anything from THIS file's own VERIFICATION_WORD check -- every
    // real occurrence sits directly adjacent to "verifier report",
    // which already strips the only verif-word present. Genuinely
    // dead for that purpose, but NOT dead weight overall: labels.test.ts
    // reuses this exact same array for its own, different "no label
    // means validated by Snowkap" check, and strips this exact phrase
    // first specifically so the pre-approved NEGATION ("not validated
    // by Snowkap," the actual v2.1.1-mandated disclaimer) doesn't
    // trip that unrelated ban. Kept for that reason -- verified by
    // reading labels.test.ts before removing it.
    "not validated by snowkap",
    "snowkap is not an accredited verifier and does not provide verification",
    "request verification support",
    // The existing honest negation on the sharing status screen
    // (shared-data-status-list.tsx) -- says the opposite of an
    // accredited claim; kept verbatim.
    "not independently verified proof",
    // GoTrue's own concept (proving control of an email address),
    // unrelated to emissions data.
    "verify your email",
    "email verification",
  ];

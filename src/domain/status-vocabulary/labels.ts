import type {
  StatusKey,
} from "./types";

/**
 * The exact copy for every StatusKey (v2.1 §5.1). "Verified" never
 * appears here as a synonym for internal review, and no key means
 * "validated by Snowkap" -- there is no such key, by design (asserted
 * in labels.test.ts and, across the wider tree, in
 * tests/architecture/verification-prose-scan.test.ts).
 */
export const STATUS_LABEL: Record<StatusKey, string> =
  {
    "review.UNREVIEWED": "Not yet reviewed",
    "review.PENDING": "Awaiting internal review",
    "review.OPERATOR_INTERNAL": "Reviewed internally by the operator's organization",
    // Deliberately viewer-neutral, not "your organisation": this key
    // is reached from more than one viewer's screen --
    // emission-data-list.tsx (own-org, own screen) AND
    // ActualDataPreview when previewing a SHARED option. A dual-
    // capability org can share an IMPORTER_ENTERED installation
    // (provenance-capability.ts), so a grantee can see this badge for
    // a record it did NOT itself transcribe -- "your organisation"
    // would misattribute the review to the viewer. Adversarial review
    // finding (2026-09-05); the original draft said "your
    // organisation" and was wrong on both premises.
    "review.IMPORTER_TRANSCRIPTION": "Transcription reviewed internally by the recording organization",
    "review.REJECTED": "Rejected in internal review",
  };

// "organization", not "organisation" -- matching this codebase's
// existing spelling convention throughout app/** UI copy (e.g.
// actual-data-preview.tsx's own "entered by your organization",
// rendered in the same <dl> as this badge).
export type StatusTone =
  | "neutral"
  | "brand"
  | "success"
  | "warning"
  | "danger";

export const STATUS_TONE: Record<StatusKey, StatusTone> =
  {
    "review.UNREVIEWED": "neutral",
    "review.PENDING": "warning",
    "review.OPERATOR_INTERNAL": "success",
    "review.IMPORTER_TRANSCRIPTION": "success",
    "review.REJECTED": "danger",
  };

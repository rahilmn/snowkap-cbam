/**
 * The product's status/provenance vocabulary -- the discriminated set
 * of short keys every StatusBadge and review label renders through,
 * instead of a raw domain enum value or ad hoc prose.
 *
 * This is the first slice: the "review" axis needed to stop internal
 * review being read as accredited verification (Snowkap CBAM SME
 * Experience v2.1.1 §3 Correction B; v2.1 §5.1). Later slices add the
 * "source" and "verifier" axes as their call sites (the shared trust
 * panel, S3/S4) are built -- see the SME plan's §5.1 for the full
 * catalogue this module implements incrementally. Adding a member here
 * means adding it to STATUS_LABEL and STATUS_TONE too --
 * labels.test.ts asserts the two stay in exact sync.
 */
export type ReviewStatusKey =
  | "review.UNREVIEWED"
  | "review.PENDING"
  | "review.OPERATOR_INTERNAL"
  | "review.IMPORTER_TRANSCRIPTION"
  | "review.REJECTED";

export type StatusKey =
  ReviewStatusKey;

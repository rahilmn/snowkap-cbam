import type {
  StatusKey,
} from "./types";

/**
 * The exact copy for every StatusKey (v2 §9.2; v2.1.1 §3 Correction
 * B). "Verified" never appears here as a synonym for internal review,
 * and no key means "validated by Snowkap" -- there is no such key, by
 * design (asserted in labels.test.ts and, across the wider tree, in
 * tests/architecture/verification-prose-scan.test.ts).
 *
 * `Record<StatusKey, string>` is what makes this exhaustive: every
 * concrete member of every axis in types.ts must have an entry here
 * or this file fails to compile. Two real bugs surfaced by building
 * this exhaustively rather than by hand: declaration-actions.tsx's
 * BLOCKER_LABEL was missing LINE_CALCULATION_STALE entirely (a live,
 * reachable raw-enum leak), and reports/page.tsx's hand-written
 * ternary silently mislabeled CALCULATION_STALE as "Not calculated" --
 * both fixed at their call sites in the same change that added this
 * module's full coverage.
 */
export const STATUS_LABEL: Record<StatusKey, string> =
  {
    // -- review (v2.1.1 §3 Correction B) --
    "review.UNREVIEWED": "Not yet reviewed",
    "review.PENDING": "Awaiting internal review",
    "review.OPERATOR_INTERNAL": "Reviewed internally by the operator's organization",
    "review.IMPORTER_TRANSCRIPTION": "Transcription reviewed internally by the recording organization",
    "review.REJECTED": "Rejected in internal review",

    // -- verifier_report (v2.1.1 sections 10/13 -- the operator's OWN
    // declaration that a verifier report exists, never a Snowkap claim) --
    "verifier_report.NOT_DECLARED": "No verifier report declared",
    "verifier_report.DECLARED": "Verifier report declared by operator (not validated by Snowkap)",

    // -- shipment --
    "shipment.DRAFT": "Draft",
    "shipment.READY": "Ready for declaration",
    "shipment.LOCKED": "Locked",
    "shipment.VOID": "Void",

    // -- declaration --
    "declaration.DRAFT": "Draft",
    "declaration.READY": "Approved for filing",
    "declaration.FILED_RECORDED": "Filed (recorded)",
    "declaration.VOID": "Void",

    // -- emission_record (the producer's dossier lifecycle) --
    "emission_record.DRAFT": "Draft",
    "emission_record.ACTIVE": "Published",
    "emission_record.SUPERSEDED": "Superseded",
    "emission_record.DISCARDED": "Discarded",

    // -- sharing_grant --
    "sharing_grant.INVITED": "Invitation sent",
    "sharing_grant.ACTIVE": "Active",
    "sharing_grant.REVOKED": "Revoked",
    "sharing_grant.EXPIRED": "Expired",

    // -- resolution (protected regulatory zone's own reasons; labels
    // carried over verbatim from the now-retired
    // components/ui/regulatory-status-badge.tsx's REASON_LABEL) --
    "resolution.EXACT_TARIC_MATCH": "Resolved (TARIC)",
    "resolution.EXACT_CN8_MATCH": "Resolved (CN8)",
    "resolution.EXACT_HS6_MATCH": "Resolved (HS6)",
    "resolution.EXACT_HS4_MATCH": "Resolved (HS4)",
    "resolution.OTHER_COUNTRIES_FALLBACK": "Fallback territory",
    "resolution.REFERENCE_REQUIRED": "Reference required",
    "resolution.UNAVAILABLE": "Unavailable",
    "resolution.NOT_APPLICABLE": "Not applicable",
    "resolution.AMBIGUOUS": "Ambiguous",
    "resolution.NO_MATCH": "No match",

    // -- value (a resolved record's own direct/indirect/total status) --
    "value.AVAILABLE": "Available",
    "value.UNAVAILABLE": "Unavailable",
    "value.REFERENCE_REQUIRED": "Reference required",
    "value.NOT_APPLICABLE": "Not applicable",
    "value.SOURCE_TEXT": "See source text",

    // -- calculation --
    "calculation.COMPUTED": "Computed",
    "calculation.INPUT_UNRESOLVED": "Cannot calculate -- input not resolved",
    "calculation.VALUE_UNAVAILABLE": "Cannot calculate -- value unavailable",
    "calculation.UNIT_UNSUPPORTED": "Cannot calculate -- unit not supported",
    "calculation.PARAMETER_DATASET_UNAVAILABLE": "Cannot calculate -- parameter dataset unavailable",

    // -- blocker (declaration completeness) --
    "blocker.NO_SHIPMENTS_IN_PERIOD": "No shipments in this period",
    "blocker.SHIPMENT_NOT_LOCKABLE": "Shipment is not ready for declaration yet",
    "blocker.SHIPMENT_HAS_NO_LINES": "Shipment has no lines",
    "blocker.LINE_NOT_DETERMINED": "Line not determined",
    "blocker.LINE_NOT_CALCULATED": "Line not calculated",
    "blocker.LINE_CALCULATION_STALE": "Calculation is stale -- recalculate after re-determination",

    // -- incomplete_line (importer reports summary) --
    "incomplete_line.NO_DETERMINATION": "Not determined",
    "incomplete_line.NOT_CALCULATED": "Not calculated",
    "incomplete_line.CALCULATION_STALE": "Stale -- recalculate",

    // -- methodology --
    "methodology.EU_METHOD": "EU method",
    "methodology.EQUIVALENT_METHOD": "Equivalent method",
    "methodology.OTHER": "Other",

    // -- role --
    "role.OWNER": "Owner",
    "role.ADMIN": "Admin",
    "role.MEMBER": "Member",
  };

export type StatusTone =
  | "neutral"
  | "brand"
  | "success"
  | "warning"
  | "danger";

/**
 * Five tones (Badge's own set, components/ui/badge.tsx) cover every
 * axis here, replacing regulatory-status-badge.tsx's five bespoke
 * --status-* CSS-variable tones (resolved/fallback/reference-required/
 * unavailable/ambiguous). This does lose one bit of visual distinction
 * (AMBIGUOUS and UNAVAILABLE now share "danger" rather than having
 * their own colors) in exchange for one badge-rendering system instead
 * of two -- a deliberate, stated trade, not an oversight.
 */
export const STATUS_TONE: Record<StatusKey, StatusTone> =
  {
    // -- review --
    "review.UNREVIEWED": "neutral",
    "review.PENDING": "warning",
    "review.OPERATOR_INTERNAL": "success",
    "review.IMPORTER_TRANSCRIPTION": "success",
    "review.REJECTED": "danger",

    // -- verifier_report --
    "verifier_report.NOT_DECLARED": "neutral",
    "verifier_report.DECLARED": "success",

    // -- shipment --
    "shipment.DRAFT": "neutral",
    "shipment.READY": "success",
    "shipment.LOCKED": "brand",
    "shipment.VOID": "danger",

    // -- declaration --
    "declaration.DRAFT": "neutral",
    "declaration.READY": "success",
    "declaration.FILED_RECORDED": "brand",
    "declaration.VOID": "danger",

    // -- emission_record --
    "emission_record.DRAFT": "neutral",
    "emission_record.ACTIVE": "success",
    "emission_record.SUPERSEDED": "neutral",
    "emission_record.DISCARDED": "danger",

    // -- sharing_grant --
    "sharing_grant.INVITED": "warning",
    "sharing_grant.ACTIVE": "success",
    "sharing_grant.REVOKED": "danger",
    "sharing_grant.EXPIRED": "neutral",

    // -- resolution --
    "resolution.EXACT_TARIC_MATCH": "success",
    "resolution.EXACT_CN8_MATCH": "success",
    "resolution.EXACT_HS6_MATCH": "success",
    "resolution.EXACT_HS4_MATCH": "success",
    "resolution.OTHER_COUNTRIES_FALLBACK": "warning",
    "resolution.REFERENCE_REQUIRED": "warning",
    "resolution.UNAVAILABLE": "danger",
    "resolution.NOT_APPLICABLE": "neutral",
    "resolution.AMBIGUOUS": "danger",
    "resolution.NO_MATCH": "danger",

    // -- value --
    "value.AVAILABLE": "success",
    "value.UNAVAILABLE": "danger",
    "value.REFERENCE_REQUIRED": "warning",
    "value.NOT_APPLICABLE": "neutral",
    "value.SOURCE_TEXT": "neutral",

    // -- calculation --
    "calculation.COMPUTED": "success",
    "calculation.INPUT_UNRESOLVED": "warning",
    "calculation.VALUE_UNAVAILABLE": "warning",
    "calculation.UNIT_UNSUPPORTED": "danger",
    "calculation.PARAMETER_DATASET_UNAVAILABLE": "danger",

    // -- blocker (all warning: a real, present block on filing) --
    "blocker.NO_SHIPMENTS_IN_PERIOD": "warning",
    "blocker.SHIPMENT_NOT_LOCKABLE": "warning",
    "blocker.SHIPMENT_HAS_NO_LINES": "warning",
    "blocker.LINE_NOT_DETERMINED": "warning",
    "blocker.LINE_NOT_CALCULATED": "warning",
    "blocker.LINE_CALCULATION_STALE": "warning",

    // -- incomplete_line --
    "incomplete_line.NO_DETERMINATION": "warning",
    "incomplete_line.NOT_CALCULATED": "warning",
    "incomplete_line.CALCULATION_STALE": "warning",

    // -- methodology (descriptive, not a status -- always neutral) --
    "methodology.EU_METHOD": "neutral",
    "methodology.EQUIVALENT_METHOD": "neutral",
    "methodology.OTHER": "neutral",

    // -- role --
    "role.OWNER": "brand",
    "role.ADMIN": "neutral",
    "role.MEMBER": "neutral",
  };

import type {
  VerificationStatus,
} from "../emissions/types";

import type {
  InstallationRecordProvenance,
} from "../installations/types";

import type {
  ReviewStatusKey,
} from "./types";

/**
 * The review axis of the product's provenance vocabulary (v2.1 §5.1):
 * who reviewed a record, phrased so it can never be mistaken for
 * accredited (Article 8) verification. Both parameters are required --
 * deliberately no overload and no default for `provenance` -- so a
 * call site cannot render a review badge without knowing whose data it
 * is; see v2.1.1 §3 Correction B and F13 in the SME plan (provenance
 * is a required input to the review label, not an afterthought).
 *
 * `verificationStatus` is the raw domain enum (VERIFIED means "a
 * second admin approved it against the evidence", nothing more, and
 * carries no claim about accredited verification); this function is
 * the only place that enum is allowed to become user-facing text.
 */
export function reviewBadgeFor(
  verificationStatus: VerificationStatus,
  provenance: InstallationRecordProvenance,
): ReviewStatusKey {
  if (verificationStatus === "UNVERIFIED") {
    return "review.UNREVIEWED";
  }

  if (verificationStatus === "VERIFICATION_PENDING") {
    return "review.PENDING";
  }

  if (verificationStatus === "REJECTED") {
    return "review.REJECTED";
  }

  // VERIFIED. The label differs by provenance -- see this module's
  // own doc comment: an operator's own record was reviewed by a
  // second admin of the OPERATOR's organisation; an importer-entered
  // record was only ever reviewed by a second admin of the IMPORTER's
  // organisation, reviewing a transcription -- never a review of the
  // producer's own emissions.
  return provenance === "IMPORTER_ENTERED"
    ? "review.IMPORTER_TRANSCRIPTION"
    : "review.OPERATOR_INTERNAL";
}

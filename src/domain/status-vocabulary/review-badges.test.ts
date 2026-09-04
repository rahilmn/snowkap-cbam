import {
  describe,
  it,
  expect,
} from "vitest";

import {
  reviewBadgeFor,
} from "./review-badges";

describe(
  "reviewBadgeFor",
  () => {
    it(
      "returns review.UNREVIEWED for UNVERIFIED regardless of provenance",
      () => {
        expect(reviewBadgeFor("UNVERIFIED", "OPERATOR_PROVIDED")).toBe("review.UNREVIEWED");
        expect(reviewBadgeFor("UNVERIFIED", "IMPORTER_ENTERED")).toBe("review.UNREVIEWED");
      },
    );

    it(
      "returns review.PENDING for VERIFICATION_PENDING regardless of provenance",
      () => {
        expect(reviewBadgeFor("VERIFICATION_PENDING", "OPERATOR_PROVIDED")).toBe("review.PENDING");
        expect(reviewBadgeFor("VERIFICATION_PENDING", "IMPORTER_ENTERED")).toBe("review.PENDING");
      },
    );

    it(
      "returns review.REJECTED for REJECTED regardless of provenance",
      () => {
        expect(reviewBadgeFor("REJECTED", "OPERATOR_PROVIDED")).toBe("review.REJECTED");
        expect(reviewBadgeFor("REJECTED", "IMPORTER_ENTERED")).toBe("review.REJECTED");
      },
    );

    it(
      "returns review.OPERATOR_INTERNAL for VERIFIED + OPERATOR_PROVIDED -- the operator's own data, reviewed by a second admin of the operator's own organisation",
      () => {
        expect(reviewBadgeFor("VERIFIED", "OPERATOR_PROVIDED")).toBe("review.OPERATOR_INTERNAL");
      },
    );

    it(
      "returns review.IMPORTER_TRANSCRIPTION for VERIFIED + IMPORTER_ENTERED -- a transcription reviewed by a second admin of the IMPORTER's organisation, never a review of the producer's own emissions",
      () => {
        expect(reviewBadgeFor("VERIFIED", "IMPORTER_ENTERED")).toBe("review.IMPORTER_TRANSCRIPTION");
      },
    );
  },
);

import type {
  EmissionData,
} from "./types";

import type {
  UserId,
} from "../shared/ids";

/**
 * Two coupled state machines on one EmissionData row
 * (docs/architecture/DOMAIN_MODEL.md, "Emissions"):
 *
 *   verification_status: UNVERIFIED --SUBMIT_FOR_VERIFICATION-->
 *     VERIFICATION_PENDING --VERIFY--> VERIFIED
 *                           --REJECT--> REJECTED --SUBMIT_FOR_VERIFICATION-->
 *     VERIFICATION_PENDING (resubmission, clears the prior rejection_reason)
 *
 *   status: DRAFT --ACTIVATE--> ACTIVE   (only once verification_status = VERIFIED)
 *           DRAFT --DISCARD--> DISCARDED
 *
 * ACTIVATE is the producer's explicit "publish" step, separate from
 * verification succeeding -- a record can sit DRAFT + VERIFIED for as
 * long as the producer wants before they choose to make it the
 * installation's current record for its (installation, cn_scope,
 * period). Only ACTIVE + VERIFIED is ever eligible to back an ACTUAL
 * determination (application layer, P7) -- this function only
 * enforces the two state machines' own internal rules, not that
 * broader eligibility rule, which belongs where the determination is
 * made, not where the record's own lifecycle is validated.
 *
 * Superseding a prior ACTIVE record for the same scope (setting its
 * own status to SUPERSEDED) is a two-row operation the application
 * layer coordinates when it calls ACTIVATE, not something this
 * single-record pure function can express.
 */
export type EmissionDataAction =
  | { action: "SUBMIT_FOR_VERIFICATION" }
  | { action: "VERIFY"; verifierUserId: UserId }
  | { action: "REJECT"; rejectionReason: string }
  | { action: "ACTIVATE" }
  | { action: "DISCARD" };

export type EmissionDataTransitionRejectionReason =
  | "RECORD_NOT_DRAFT"
  | "VERIFICATION_NOT_PENDING"
  | "NOT_VERIFIED"
  | "REJECTION_REASON_REQUIRED";

export type TransitionEmissionDataResult =
  | { status: "OK"; record: EmissionData }
  | { status: "REJECTED"; reason: EmissionDataTransitionRejectionReason };

function rejected(
  reason: EmissionDataTransitionRejectionReason,
): TransitionEmissionDataResult {
  return {
    status: "REJECTED",
    reason,
  };
}

function ok(
  record: EmissionData,
): TransitionEmissionDataResult {
  return {
    status: "OK",
    record,
  };
}

export function transitionEmissionData(
  record: EmissionData,
  action: EmissionDataAction,
): TransitionEmissionDataResult {
  switch (action.action) {
    case "SUBMIT_FOR_VERIFICATION": {
      if (record.status !== "DRAFT") {
        return rejected(
          "RECORD_NOT_DRAFT",
        );
      }

      if (
        record.verification_status !== "UNVERIFIED" &&
        record.verification_status !== "REJECTED"
      ) {
        return rejected(
          "VERIFICATION_NOT_PENDING",
        );
      }

      return ok(
        {
          ...record,
          verification_status: "VERIFICATION_PENDING",
          rejection_reason: null,
        },
      );
    }

    case "VERIFY": {
      if (record.verification_status !== "VERIFICATION_PENDING") {
        return rejected(
          "VERIFICATION_NOT_PENDING",
        );
      }

      return ok(
        {
          ...record,
          verification_status: "VERIFIED",
          verifier_user_id: action.verifierUserId,
        },
      );
    }

    case "REJECT": {
      if (record.verification_status !== "VERIFICATION_PENDING") {
        return rejected(
          "VERIFICATION_NOT_PENDING",
        );
      }

      if (action.rejectionReason.trim().length === 0) {
        return rejected(
          "REJECTION_REASON_REQUIRED",
        );
      }

      return ok(
        {
          ...record,
          verification_status: "REJECTED",
          rejection_reason: action.rejectionReason,
        },
      );
    }

    case "ACTIVATE": {
      if (record.status !== "DRAFT") {
        return rejected(
          "RECORD_NOT_DRAFT",
        );
      }

      if (record.verification_status !== "VERIFIED") {
        return rejected(
          "NOT_VERIFIED",
        );
      }

      return ok(
        {
          ...record,
          status: "ACTIVE",
        },
      );
    }

    case "DISCARD": {
      if (record.status !== "DRAFT") {
        return rejected(
          "RECORD_NOT_DRAFT",
        );
      }

      return ok(
        {
          ...record,
          status: "DISCARDED",
        },
      );
    }
  }
}

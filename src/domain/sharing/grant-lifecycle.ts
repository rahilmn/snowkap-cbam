import type {
  SharingGrant,
} from "./types";

import type {
  OrganizationId,
} from "../shared/ids";

import type {
  IsoTimestamp,
} from "../shared/reporting-period";

/**
 * INVITED --ACCEPT--> ACTIVE --REVOKE--> REVOKED
 *   |                    |
 *   +------REVOKE--------+
 *
 * ACTIVE --EXPIRE--> EXPIRED (only once `now` >= expires_at; a grant
 * with no expires_at never auto-expires)
 *
 * REVOKED/EXPIRED are terminal (docs/architecture/DOMAIN_MODEL.md,
 * "Cross-organization sharing": revocation/expiry end *future* reads
 * only -- nothing here touches any ActualEmissionSnapshot already
 * taken through this grant, since those are frozen copies elsewhere).
 */
export type SharingGrantAction =
  | { action: "ACCEPT"; granteeOrgId: OrganizationId }
  | { action: "REVOKE" }
  | { action: "EXPIRE"; now: IsoTimestamp };

export type SharingGrantTransitionRejectionReason =
  | "GRANT_NOT_INVITED"
  | "GRANT_NOT_ACTIVE"
  | "ALREADY_TERMINAL"
  | "NOT_YET_EXPIRED";

export type TransitionSharingGrantResult =
  | { status: "OK"; grant: SharingGrant }
  | { status: "REJECTED"; reason: SharingGrantTransitionRejectionReason };

function rejected(
  reason: SharingGrantTransitionRejectionReason,
): TransitionSharingGrantResult {
  return {
    status: "REJECTED",
    reason,
  };
}

function ok(
  grant: SharingGrant,
): TransitionSharingGrantResult {
  return {
    status: "OK",
    grant,
  };
}

export function transitionSharingGrant(
  grant: SharingGrant,
  action: SharingGrantAction,
): TransitionSharingGrantResult {
  switch (action.action) {
    case "ACCEPT": {
      if (grant.status !== "INVITED") {
        return rejected(
          "GRANT_NOT_INVITED",
        );
      }

      return ok(
        {
          ...grant,
          status: "ACTIVE",
          grantee_org_id: action.granteeOrgId,
        },
      );
    }

    case "REVOKE": {
      if (grant.status === "REVOKED" || grant.status === "EXPIRED") {
        return rejected(
          "ALREADY_TERMINAL",
        );
      }

      return ok(
        {
          ...grant,
          status: "REVOKED",
        },
      );
    }

    case "EXPIRE": {
      if (grant.status !== "ACTIVE") {
        return rejected(
          "GRANT_NOT_ACTIVE",
        );
      }

      if (!grant.expires_at || grant.expires_at > action.now) {
        return rejected(
          "NOT_YET_EXPIRED",
        );
      }

      return ok(
        {
          ...grant,
          status: "EXPIRED",
        },
      );
    }
  }
}

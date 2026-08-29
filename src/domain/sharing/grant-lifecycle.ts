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
 * INVITED --EXPIRE--> EXPIRED / ACTIVE --EXPIRE--> EXPIRED (only once
 * `now` >= expires_at; a grant with no expires_at never auto-expires.
 * 2026-08-29, P11 finding #5's own residual note: EXPIRE previously
 * required status === 'ACTIVE', so a grant that was never accepted
 * and simply lapsed while still INVITED could never reach EXPIRED
 * through this function at all -- only accept_sharing_grant_invitation's
 * own raw SQL lazy-expire, 20260829300000, could do that, for the
 * bootstrap path only. Widened here so the pure function's own state
 * machine actually covers the transition the SQL RPC already performs.)
 *
 * REVOKED/EXPIRED are terminal (docs/architecture/DOMAIN_MODEL.md,
 * "Cross-organization sharing": revocation/expiry end *future* reads
 * only -- nothing here touches any ActualEmissionSnapshot already
 * taken through this grant, since those are frozen copies elsewhere).
 */
export type SharingGrantAction =
  | { action: "ACCEPT"; granteeOrgId: OrganizationId; now: IsoTimestamp }
  | { action: "REVOKE" }
  | { action: "EXPIRE"; now: IsoTimestamp };

export type SharingGrantTransitionRejectionReason =
  | "GRANT_NOT_INVITED"
  | "GRANT_NOT_ACTIVE"
  | "ALREADY_TERMINAL"
  | "GRANT_EXPIRED"
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

      // 2026-08-29 (P11 mandatory security review, SHOULD-FIX finding
      // #5, independently confirmed live by two reviewers): this
      // branch used to check status only -- an INVITED grant whose
      // expires_at had lapsed 400 days ago still accepted cleanly,
      // producing a grant the Sharing screen renders ACTIVE plus a
      // sharing_grant.accepted audit event for access that (per
      // app.user_shared_installation_ids()'s own expiry filter) never
      // actually confers any read. accept_sharing_grant_invitation
      // (the bootstrap-by-email RPC, 20260829300000) already made this
      // exact check -- this brings the direct-grant accept path (this
      // function, wired from acceptSharingGrant in
      // manage-sharing-grants.ts) in line with it, rather than leaving
      // the two accept paths disagreeing about what "still pending"
      // means.
      if (grant.expires_at !== null && grant.expires_at <= action.now) {
        return rejected(
          "GRANT_EXPIRED",
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
      if (grant.status !== "ACTIVE" && grant.status !== "INVITED") {
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

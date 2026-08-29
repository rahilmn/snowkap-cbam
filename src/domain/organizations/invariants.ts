import type {
  MembershipId,
} from "../shared/ids";

import type {
  IsoTimestamp,
} from "../shared/reporting-period";

import type {
  Membership,
  MembershipRole,
} from "./types";

export type MembershipInvariantRejectionReason =
  | "LAST_OWNER"
  | "MEMBERSHIP_NOT_FOUND"
  | "ALREADY_DEACTIVATED"
  | "NOT_DEACTIVATED"
  | "ONLY_OWNER_CAN_GRANT_OWNERSHIP";

export type ChangeMembershipRoleResult =
  | { status: "OK"; memberships: Membership[] }
  | { status: "REJECTED"; reason: MembershipInvariantRejectionReason };

export type RemoveMembershipResult =
  | { status: "OK"; memberships: Membership[] }
  | { status: "REJECTED"; reason: MembershipInvariantRejectionReason };

export type DeactivateMembershipResult =
  | { status: "OK"; memberships: Membership[] }
  | { status: "REJECTED"; reason: MembershipInvariantRejectionReason };

export type ReactivateMembershipResult =
  | { status: "OK"; memberships: Membership[] }
  | { status: "REJECTED"; reason: MembershipInvariantRejectionReason };

/**
 * True when `membership` is an ACTIVE OWNER and no other membership in
 * the same organization is also an active OWNER — i.e. removing,
 * demoting, or deactivating it would leave the organization with zero
 * owners who can actually do anything.
 *
 * "Active" is load-bearing on both sides, and was not always here: this
 * counted OWNER rows outright until deactivation existed
 * (20260829360000), which was correct only because every OWNER row was
 * necessarily active. A deactivated OWNER is skipped by
 * app.user_is_admin_or_owner_of(), so it confers no authority — counting
 * it would have let an org holding one active OWNER plus one deactivated
 * OWNER strip the active one on the grounds that "another OWNER exists",
 * leaving nobody able to manage the org, edit it, or invite a
 * replacement. A deactivated OWNER as the *target* is likewise not a
 * last owner: it has no ownership left to take away, and refusing would
 * only strand a row nobody can clean up.
 */
function isLastActiveOwner(
  memberships: Membership[],
  membership: Membership,
): boolean {
  if (
    membership.role !== "OWNER" ||
    membership.deactivated_at !== null
  ) {
    return false;
  }

  const otherActiveOwnersInSameOrg =
    memberships.filter(
      (candidate) =>
        candidate.id !== membership.id &&
        candidate.org_id === membership.org_id &&
        candidate.role === "OWNER" &&
        candidate.deactivated_at === null,
    );

  return otherActiveOwnersInSameOrg.length === 0;
}

/**
 * Changes one membership's role, refusing a change that would leave its
 * organization with no OWNER. Ownership is counted per-org: a sole OWNER
 * in a different organization never satisfies this org's minimum.
 *
 * `callerRole` is the ACTING caller's own current role (never trust a
 * role embedded in the request itself) -- required so this function can
 * enforce a second invariant: only an existing OWNER may grant OWNER to
 * someone else. 2026-08-29 (P13 audit finding, live-reproduced against
 * real Postgres): without this, an ADMIN could promote a confederate (or
 * themselves) to OWNER -- isLastActiveOwner's own guard only fires when
 * a change would leave an org with ZERO active owners, so it never
 * blocked GRANTING ownership, only removing the last one. Once a second
 * OWNER exists via that path, the org's real founding OWNER can then be
 * demoted (now legal, since another OWNER exists), permanently locking
 * them out of org-settings' danger zone.
 */
export function changeMembershipRole(
  memberships: Membership[],
  membershipId: MembershipId,
  newRole: MembershipRole,
  callerRole: MembershipRole,
): ChangeMembershipRoleResult {
  const target =
    memberships.find(
      (membership) => membership.id === membershipId,
    );

  if (!target) {
    return {
      status: "REJECTED",
      reason: "MEMBERSHIP_NOT_FOUND",
    };
  }

  if (
    newRole === "OWNER" &&
    callerRole !== "OWNER"
  ) {
    return {
      status: "REJECTED",
      reason: "ONLY_OWNER_CAN_GRANT_OWNERSHIP",
    };
  }

  if (
    newRole !== "OWNER" &&
    isLastActiveOwner(
      memberships,
      target,
    )
  ) {
    return {
      status: "REJECTED",
      reason: "LAST_OWNER",
    };
  }

  return {
    status: "OK",
    memberships:
      memberships.map(
        (membership) =>
          membership.id === membershipId
            ? { ...membership, role: newRole }
            : membership,
      ),
  };
}

/**
 * Removes one membership, refusing a removal that would leave its
 * organization with no active OWNER.
 *
 * Removal is the hard-delete path, kept for correcting a genuine
 * mistake (an accidental invite). Normal offboarding is
 * deactivateMembership below — it preserves the row, and with it the
 * only thing that can ever resolve this person's historical
 * audit_events back to a name (master plan §14).
 */
export function removeMembership(
  memberships: Membership[],
  membershipId: MembershipId,
): RemoveMembershipResult {
  const target =
    memberships.find(
      (membership) => membership.id === membershipId,
    );

  if (!target) {
    return {
      status: "REJECTED",
      reason: "MEMBERSHIP_NOT_FOUND",
    };
  }

  if (
    isLastActiveOwner(
      memberships,
      target,
    )
  ) {
    return {
      status: "REJECTED",
      reason: "LAST_OWNER",
    };
  }

  return {
    status: "OK",
    memberships:
      memberships.filter(
        (membership) => membership.id !== membershipId,
      ),
  };
}

/**
 * Deactivates one membership, refusing a deactivation that would leave
 * its organization with no active OWNER — the same invariant, and the
 * same reason, as removeMembership's: a deactivated OWNER is skipped by
 * app.user_is_admin_or_owner_of() (20260829360000), so deactivating the
 * sole owner locks the organization out of its own administration
 * exactly as deleting them would.
 *
 * `deactivatedAt` is supplied by the caller rather than read from the
 * clock here — the same convention transitionSharingGrant's EXPIRE
 * action uses (src/domain/sharing/grant-lifecycle.ts) — so this stays a
 * pure function and the application layer persists precisely the value
 * this returned.
 *
 * Refusing an ALREADY_DEACTIVATED row is not pedantry: treating it as a
 * no-op would overwrite the original offboarding timestamp with a later
 * one, quietly rewriting when the person actually lost access.
 */
export function deactivateMembership(
  memberships: Membership[],
  membershipId: MembershipId,
  deactivatedAt: IsoTimestamp,
): DeactivateMembershipResult {
  const target =
    memberships.find(
      (membership) => membership.id === membershipId,
    );

  if (!target) {
    return {
      status: "REJECTED",
      reason: "MEMBERSHIP_NOT_FOUND",
    };
  }

  if (target.deactivated_at !== null) {
    return {
      status: "REJECTED",
      reason: "ALREADY_DEACTIVATED",
    };
  }

  if (
    isLastActiveOwner(
      memberships,
      target,
    )
  ) {
    return {
      status: "REJECTED",
      reason: "LAST_OWNER",
    };
  }

  return {
    status: "OK",
    memberships:
      memberships.map(
        (membership) =>
          membership.id === membershipId
            ? { ...membership, deactivated_at: deactivatedAt }
            : membership,
      ),
  };
}

/**
 * Restores a deactivated membership at the role it already held.
 *
 * There is no owner-count invariant to check in this direction:
 * reactivation only ever adds an active owner, never removes the last
 * one. The role is deliberately untouched — re-granting access and
 * changing what that access is worth are two separate, separately
 * audited decisions (changeMembershipRole is the other one).
 */
export function reactivateMembership(
  memberships: Membership[],
  membershipId: MembershipId,
): ReactivateMembershipResult {
  const target =
    memberships.find(
      (membership) => membership.id === membershipId,
    );

  if (!target) {
    return {
      status: "REJECTED",
      reason: "MEMBERSHIP_NOT_FOUND",
    };
  }

  if (target.deactivated_at === null) {
    return {
      status: "REJECTED",
      reason: "NOT_DEACTIVATED",
    };
  }

  return {
    status: "OK",
    memberships:
      memberships.map(
        (membership) =>
          membership.id === membershipId
            ? { ...membership, deactivated_at: null }
            : membership,
      ),
  };
}

import type {
  MembershipId,
} from "../shared/ids.js";

import type {
  Membership,
  MembershipRole,
} from "./types.js";

export type MembershipInvariantRejectionReason =
  | "LAST_OWNER"
  | "MEMBERSHIP_NOT_FOUND";

export type ChangeMembershipRoleResult =
  | { status: "OK"; memberships: Membership[] }
  | { status: "REJECTED"; reason: MembershipInvariantRejectionReason };

export type RemoveMembershipResult =
  | { status: "OK"; memberships: Membership[] }
  | { status: "REJECTED"; reason: MembershipInvariantRejectionReason };

/**
 * True when `membership` is an OWNER and no other membership in the same
 * organization also holds OWNER — i.e. removing or demoting it would
 * leave the organization with zero owners.
 */
function isLastOwner(
  memberships: Membership[],
  membership: Membership,
): boolean {
  if (membership.role !== "OWNER") {
    return false;
  }

  const otherOwnersInSameOrg =
    memberships.filter(
      (candidate) =>
        candidate.id !== membership.id &&
        candidate.org_id === membership.org_id &&
        candidate.role === "OWNER",
    );

  return otherOwnersInSameOrg.length === 0;
}

/**
 * Changes one membership's role, refusing a change that would leave its
 * organization with no OWNER. Ownership is counted per-org: a sole OWNER
 * in a different organization never satisfies this org's minimum.
 */
export function changeMembershipRole(
  memberships: Membership[],
  membershipId: MembershipId,
  newRole: MembershipRole,
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
    newRole !== "OWNER" &&
    isLastOwner(
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
 * organization with no OWNER.
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
    isLastOwner(
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

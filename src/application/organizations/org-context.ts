import type {
  MembershipRole,
  OrganizationCapability,
} from "../../domain/organizations/types";

import type {
  OrganizationId,
  UserId,
} from "../../domain/shared/ids";

/**
 * The authenticated caller's tenant context, derived once per request
 * from the session + the caller's membership row (never trusted from
 * client input) and passed explicitly into every use-case service --
 * see docs/plans/MASTER_PLAN.md §10 ("an explicit OrgContext {org_id,
 * user_id, role, capabilities} -- never ambient"). No service may read
 * ambient session state itself; this is the only channel org identity
 * and role flow through.
 */
export interface OrgContext {
  org_id: OrganizationId;
  user_id: UserId;
  role: MembershipRole;
  capabilities: OrganizationCapability[];
}

/**
 * True when `context`'s role is ADMIN or OWNER -- the tier the §14
 * roles matrix grants member-management and most write actions to.
 * MEMBER-only checks are just `context.role === "MEMBER"` directly;
 * this helper exists because "ADMIN or above" is the far more common
 * check across use-case services.
 */
export function hasAdminAccess(
  context: OrgContext,
): boolean {
  return (
    context.role === "ADMIN" ||
    context.role === "OWNER"
  );
}

/**
 * True when `context`'s organization holds `capability`. Use-case
 * services for capability-specific workflows (e.g. producer-only
 * screens) must check this rather than assuming every org can do
 * everything -- see docs/plans/MASTER_PLAN.md §6/§7-§8.
 */
export function hasCapability(
  context: OrgContext,
  capability: OrganizationCapability,
): boolean {
  return context.capabilities.includes(
    capability,
  );
}

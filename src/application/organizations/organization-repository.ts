import type {
  Membership,
  MembershipRole,
  Organization,
} from "../../domain/organizations/types";

import type {
  MembershipId,
  OrganizationId,
  UserId,
} from "../../domain/shared/ids";

/**
 * Application-owned port (docs/plans/MASTER_PLAN.md §10) for
 * organization persistence. Infrastructure adapters implement this;
 * use-case services depend on it, never on a concrete adapter or
 * @supabase/* directly (enforced by tests/architecture/layering.test.ts).
 */
export interface OrganizationRepository {
  findById(
    id: OrganizationId,
  ): Promise<Organization | null>;

  findBySlug(
    slug: string,
  ): Promise<Organization | null>;

  insert(
    organization: Organization,
  ): Promise<void>;
}

/**
 * Application-owned port for membership persistence. Kept separate
 * from OrganizationRepository (one port per aggregate root, matching
 * Membership's own identity/table) rather than folded into it.
 */
export interface MembershipRepository {
  findById(
    id: MembershipId,
  ): Promise<Membership | null>;

  findByOrg(
    orgId: OrganizationId,
  ): Promise<Membership[]>;

  findByUser(
    userId: UserId,
  ): Promise<Membership[]>;

  findByOrgAndUser(
    orgId: OrganizationId,
    userId: UserId,
  ): Promise<Membership | null>;

  insert(
    membership: Membership,
  ): Promise<void>;

  // The domain invariant functions (src/domain/organizations/invariants.ts)
  // decide whether a role change/removal is allowed against the FULL
  // membership list for an org (the last-OWNER guard needs every row to
  // count remaining owners) and return the resulting list -- but a real
  // adapter persists only the one row that actually changed, not the
  // whole collection. Use-case services call findByOrg(), pass the
  // result through changeMembershipRole()/removeMembership(), and on
  // {status: "OK"} persist via these targeted methods.
  updateRole(
    id: MembershipId,
    role: MembershipRole,
  ): Promise<void>;

  delete(
    id: MembershipId,
  ): Promise<void>;
}

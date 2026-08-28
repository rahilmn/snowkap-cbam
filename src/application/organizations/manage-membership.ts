import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import {
  changeMembershipRole,
  removeMembership,
  type MembershipInvariantRejectionReason,
} from "../../domain/organizations/invariants";

import type {
  Membership,
  MembershipRole,
} from "../../domain/organizations/types";

import type {
  MembershipId,
  OrganizationId,
} from "../../domain/shared/ids";

import {
  recordAuditEvent,
} from "../audit/record-audit-event";

export type ManageMembershipResult =
  | { status: "OK" }
  | {
      status: "REJECTED";
      reason: MembershipInvariantRejectionReason | "FETCH_FAILED" | "PERSIST_FAILED";
    };

interface MembershipRow {
  id: string;
  org_id: string;
  user_id: string;
  role: MembershipRole;
  created_at: string;
}

function toMembership(
  row: MembershipRow,
): Membership {
  return {
    id: row.id as Membership["id"],
    org_id: row.org_id as Membership["org_id"],
    user_id: row.user_id as Membership["user_id"],
    role: row.role,
    created_at: row.created_at as Membership["created_at"],
  };
}

/**
 * Fetches every membership in `orgId` (RLS-scoped: the caller only
 * sees this if they're actually a member, and the UPDATE/DELETE below
 * additionally require ADMIN/OWNER via
 * memberships_update_admin_or_owner / memberships_delete_admin_or_owner
 * -- 20260828110000_membership_management_policies.sql), applies the
 * last-OWNER-per-org invariant (src/domain/organizations/invariants.ts,
 * already unit-tested) BEFORE issuing any write, and only then persists.
 * The invariant is deliberately not re-implemented in SQL -- see that
 * migration's header comment for why.
 */
export async function changeMemberRole(
  supabase: SupabaseClient,
  orgId: OrganizationId,
  membershipId: MembershipId,
  newRole: MembershipRole,
): Promise<ManageMembershipResult> {
  const { data: rows, error: fetchError } =
    await supabase
      .from("memberships")
      .select("id, org_id, user_id, role, created_at")
      .eq("org_id", orgId);

  if (fetchError || !rows) {
    return {
      status: "REJECTED",
      reason: "FETCH_FAILED",
    };
  }

  const memberships =
    rows.map(
      toMembership,
    );

  const invariantResult =
    changeMembershipRole(
      memberships,
      membershipId,
      newRole,
    );

  if (invariantResult.status === "REJECTED") {
    return invariantResult;
  }

  const target =
    memberships.find(
      (membership) => membership.id === membershipId,
    );

  const { error: updateError } =
    await supabase
      .from("memberships")
      .update(
        { role: newRole },
      )
      .eq("id", membershipId);

  if (updateError) {
    return {
      status: "REJECTED",
      reason: "PERSIST_FAILED",
    };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    await recordAuditEvent(
      supabase,
      {
        orgId,
        actorUserId: user.id as never,
        eventType: "membership.role_changed",
        aggregateType: "MEMBERSHIP",
        aggregateId: membershipId,
        payload: {
          target_user_id: target?.user_id,
          old_role: target?.role,
          new_role: newRole,
        },
      },
    );
  }

  return {
    status: "OK",
  };
}

/**
 * Same pattern as changeMemberRole -- see its doc comment.
 */
export async function removeMember(
  supabase: SupabaseClient,
  orgId: OrganizationId,
  membershipId: MembershipId,
): Promise<ManageMembershipResult> {
  const { data: rows, error: fetchError } =
    await supabase
      .from("memberships")
      .select("id, org_id, user_id, role, created_at")
      .eq("org_id", orgId);

  if (fetchError || !rows) {
    return {
      status: "REJECTED",
      reason: "FETCH_FAILED",
    };
  }

  const memberships =
    rows.map(
      toMembership,
    );

  const invariantResult =
    removeMembership(
      memberships,
      membershipId,
    );

  if (invariantResult.status === "REJECTED") {
    return invariantResult;
  }

  const target =
    memberships.find(
      (membership) => membership.id === membershipId,
    );

  const { error: deleteError } =
    await supabase
      .from("memberships")
      .delete()
      .eq("id", membershipId);

  if (deleteError) {
    return {
      status: "REJECTED",
      reason: "PERSIST_FAILED",
    };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    await recordAuditEvent(
      supabase,
      {
        orgId,
        actorUserId: user.id as never,
        eventType: "membership.removed",
        aggregateType: "MEMBERSHIP",
        aggregateId: membershipId,
        payload: {
          target_user_id: target?.user_id,
          removed_role: target?.role,
        },
      },
    );
  }

  return {
    status: "OK",
  };
}

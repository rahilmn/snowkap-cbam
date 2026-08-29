import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import {
  changeMembershipRole,
  deactivateMembership,
  reactivateMembership,
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

import type {
  IsoTimestamp,
} from "../../domain/shared/reporting-period";

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
  deactivated_at: string | null;
}

// One column list for all four services below. Named rather than
// inlined four times because every one of them feeds the same
// invariants, and those invariants now depend on deactivated_at being
// present -- a service that quietly omitted it would hand the domain
// `undefined` where it expects `null`, and isLastActiveOwner would stop
// recognising a deactivated OWNER as deactivated.
const MEMBERSHIP_COLUMNS =
  "id, org_id, user_id, role, created_at, deactivated_at";

function toMembership(
  row: MembershipRow,
): Membership {
  return {
    id: row.id as Membership["id"],
    org_id: row.org_id as Membership["org_id"],
    user_id: row.user_id as Membership["user_id"],
    role: row.role,
    created_at: row.created_at as Membership["created_at"],
    deactivated_at:
      (row.deactivated_at ?? null) as Membership["deactivated_at"],
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
      .select(MEMBERSHIP_COLUMNS)
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

  // .select("id") + the zero-rows check below close a gap the P10
  // review found live (correctness review BLOCKING-adjacent SHOULD-FIX,
  // auth review SHOULD-FIX #2, 2026-08-29): PostgREST reports no error
  // for an UPDATE that RLS (memberships_update_admin_or_owner) silently
  // filters to zero rows, so without reading the affected rows back, an
  // unauthorized caller (e.g. a plain MEMBER) got {status:"OK"} plus a
  // fabricated membership.role_changed audit event for a role that
  // never changed. Same reasoning, same fix shape, as deactivateMember
  // below and reactivateMember's own comment -- this function just has
  // no ALREADY_X/NOT_X row state to CAS against, so PERSIST_FAILED
  // (this codebase's own established reason for "the write did not
  // happen", e.g. manage-lines.ts's classifyLineWriteError) is what a
  // blocked write reports here.
  const { data: updated, error: updateError } =
    await supabase
      .from("memberships")
      .update(
        { role: newRole },
      )
      .eq("id", membershipId)
      .select("id");

  if (updateError || !updated || updated.length === 0) {
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
 *
 * This is the hard-delete path, and stays available for correcting a
 * genuine mistake (an accidental invite, where there is no audit
 * identity worth preserving). deactivateMember below is what master
 * plan §14 actually calls offboarding.
 */
export async function removeMember(
  supabase: SupabaseClient,
  orgId: OrganizationId,
  membershipId: MembershipId,
): Promise<ManageMembershipResult> {
  const { data: rows, error: fetchError } =
    await supabase
      .from("memberships")
      .select(MEMBERSHIP_COLUMNS)
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

  // Same .select("id") + zero-rows guard as changeMemberRole's UPDATE
  // above, applied to this DELETE -- PostgREST reports no error for a
  // DELETE that memberships_delete_admin_or_owner silently filters to
  // zero rows either, and this function had the identical false-OK gap
  // (P10 review, 2026-08-29).
  const { data: deleted, error: deleteError } =
    await supabase
      .from("memberships")
      .delete()
      .eq("id", membershipId)
      .select("id");

  if (deleteError || !deleted || deleted.length === 0) {
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

/**
 * Offboards a member: the memberships row survives (so their historical
 * audit_events keep resolving to a person) but confers no access
 * anywhere, because app.user_org_ids() and
 * app.user_is_admin_or_owner_of() both skip rows with a non-null
 * deactivated_at as of 20260829360000 -- master plan §14's
 * "deactivation severs sessions and memberships without deleting audit
 * identity".
 *
 * Same fetch-invariant-persist-audit shape as changeMemberRole; see its
 * doc comment. The one addition is the clock: the timestamp is read
 * once here and both handed to the (pure) invariant and written to the
 * row, so the value the domain reasoned about and the value that lands
 * in Postgres cannot diverge -- `now()` in the UPDATE would have been a
 * second, slightly different reading.
 */
export async function deactivateMember(
  supabase: SupabaseClient,
  orgId: OrganizationId,
  membershipId: MembershipId,
): Promise<ManageMembershipResult> {
  const { data: rows, error: fetchError } =
    await supabase
      .from("memberships")
      .select(MEMBERSHIP_COLUMNS)
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

  const deactivatedAt =
    new Date().toISOString() as IsoTimestamp;

  const invariantResult =
    deactivateMembership(
      memberships,
      membershipId,
      deactivatedAt,
    );

  if (invariantResult.status === "REJECTED") {
    return invariantResult;
  }

  const target =
    memberships.find(
      (membership) => membership.id === membershipId,
    );

  // .is("deactivated_at", null) is a compare-and-swap, not a
  // restatement of the invariant above: the fetch and this UPDATE are
  // two separate round trips, so a concurrent deactivation landing
  // between them would otherwise be silently overwritten with this
  // call's later timestamp -- the exact ALREADY_DEACTIVATED case the
  // domain refuses. Same reasoning as accept_sharing_grant_invitation's
  // own `and sg.status = 'INVITED'` CAS guard (20260829300000).
  //
  // .select() is what makes the guard observable: without it PostgREST
  // reports no error for an UPDATE that matched nothing, and losing the
  // race would return OK and then record a membership.deactivated event
  // naming a timestamp the row does not carry -- a false entry in a log
  // that has no UPDATE or DELETE policy to correct it with.
  const { data: updated, error: updateError } =
    await supabase
      .from("memberships")
      .update(
        { deactivated_at: deactivatedAt },
      )
      .eq("id", membershipId)
      .is("deactivated_at", null)
      .select("id");

  if (updateError) {
    return {
      status: "REJECTED",
      reason: "PERSIST_FAILED",
    };
  }

  if (!updated || updated.length === 0) {
    return {
      status: "REJECTED",
      reason: "ALREADY_DEACTIVATED",
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
        eventType: "membership.deactivated",
        aggregateType: "MEMBERSHIP",
        aggregateId: membershipId,
        payload: {
          target_user_id: target?.user_id,
          // The role is retained on the row, so this records what
          // access was severed -- without it the audit trail would say
          // someone was offboarded but not what they had been.
          deactivated_role: target?.role,
          deactivated_at: deactivatedAt,
        },
      },
    );
  }

  return {
    status: "OK",
  };
}

/**
 * Restores a deactivated member at the role they already held -- the
 * reverse of deactivateMember, and the reason deactivation is not a
 * DELETE.
 *
 * Same pattern as deactivateMember, including its CAS guard -- this doc
 * comment used to claim that while the code did not actually do it
 * (P10 mandatory authorization review AND the correctness review, both
 * 2026-08-29, independently found live: BLOCKING finding #1). The
 * UPDATE below had no .select() and no row-count check, so when RLS
 * (memberships_update_admin_or_owner) blocked the write because the
 * caller wasn't ADMIN/OWNER, this function still returned
 * {status:"OK"} and recorded a membership.reactivated audit event
 * claiming a reactivation that never happened. Reproduced live: a
 * plain MEMBER called reactivateMember() on a deactivated ADMIN, got
 * {"status":"OK"} back, the row stayed deactivated, and a false
 * audit_events row landed in a log with no UPDATE/DELETE policy to
 * retract it. Fixed to match deactivateMember's own
 * .is("deactivated_at", null).select("id") guard, mirrored for this
 * function's reverse direction. No clock is needed in this direction:
 * clearing deactivated_at needs no timestamp, and the reactivation
 * itself is dated by its own audit event's occurred_at.
 */
export async function reactivateMember(
  supabase: SupabaseClient,
  orgId: OrganizationId,
  membershipId: MembershipId,
): Promise<ManageMembershipResult> {
  const { data: rows, error: fetchError } =
    await supabase
      .from("memberships")
      .select(MEMBERSHIP_COLUMNS)
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
    reactivateMembership(
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

  // .not("deactivated_at", "is", null) is this function's CAS
  // predicate, mirroring deactivateMember's `.is("deactivated_at",
  // null)` above but for the reverse direction: it only lets the
  // UPDATE through when the row is still the deactivated one this call
  // read at fetch time. That covers two distinct cases the same way --
  // a concurrent reactivation racing this one (NOT_DEACTIVATED is
  // correct on its own terms), and an RLS-blocked unauthorized write
  // (0 rows, for a reason RLS never explains) -- both surface as a
  // rejection instead of the fabricated success this function used to
  // report. See this function's own doc comment above for the finding
  // that made this fix necessary, and .select("id") is what makes
  // either case observable at all (PostgREST is silent otherwise).
  const { data: updated, error: updateError } =
    await supabase
      .from("memberships")
      .update(
        { deactivated_at: null },
      )
      .eq("id", membershipId)
      .not("deactivated_at", "is", null)
      .select("id");

  if (updateError) {
    return {
      status: "REJECTED",
      reason: "PERSIST_FAILED",
    };
  }

  if (!updated || updated.length === 0) {
    return {
      status: "REJECTED",
      reason: "NOT_DEACTIVATED",
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
        eventType: "membership.reactivated",
        aggregateType: "MEMBERSHIP",
        aggregateId: membershipId,
        payload: {
          target_user_id: target?.user_id,
          reactivated_role: target?.role,
        },
      },
    );
  }

  return {
    status: "OK",
  };
}

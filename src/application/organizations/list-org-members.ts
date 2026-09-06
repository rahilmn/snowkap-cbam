import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  MembershipRole,
} from "../../domain/organizations/types";

import type {
  OrganizationId,
} from "../../domain/shared/ids";

export interface OrgMember {
  membership_id: string;
  user_id: string;
  email: string;
  role: MembershipRole;
  deactivated_at: string | null;
}

interface ListOrgMembersRpcRow {
  membership_id: string;
  user_id: string;
  email: string;
  role: MembershipRole;
  deactivated_at: string | null;
}

/**
 * Wraps the `list_org_members` RPC (20260828120000) -- moved out of
 * app/team/page.tsx (SME plan S1) so the page component itself no
 * longer calls `supabase.rpc(...)` directly, matching every other
 * screen's own application-service indirection. The RPC itself is
 * unchanged; this is presentation-layer extraction only.
 *
 * Degrades to an empty array on error rather than throwing -- matches
 * the exact behaviour team/page.tsx already had (`error ? [] :
 * ...map(...)`), preserved here rather than silently changed. Note
 * this means a read failure and a genuinely-empty org are today
 * indistinguishable to a caller of this function; a guidance
 * consumer that needs to tell them apart (v2.1.1 §9, not yet built)
 * would need a FactRead-shaped sibling, not a change to this one.
 */
export async function listOrgMembers(
  supabase: SupabaseClient,
  orgId: OrganizationId,
): Promise<OrgMember[]> {
  const { data, error } =
    await supabase.rpc(
      "list_org_members",
      { p_org_id: orgId },
    );

  // 2026-09-07 (S5 review round 3, finding S5R3-EMPTY-B2). THROWS on a
  // genuine query error rather than degrading to [] -- the one caller
  // (app/team/page.tsx) is a plain server component with no try/catch
  // of its own, and this is one of the page's two main sections, so a
  // transport failure previously rendered as the affirmative "no team
  // members" instead of failing loud.
  if (error) {
    throw new Error(
      `list-org-members: org members fetch failed (${error.message}).`,
    );
  }

  return ((data ?? []) as ListOrgMembersRpcRow[]).map(
    (row) => (
      {
        membership_id: row.membership_id,
        user_id: row.user_id,
        email: row.email,
        role: row.role,
        deactivated_at: row.deactivated_at,
      }
    ),
  );
}

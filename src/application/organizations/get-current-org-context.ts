import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  OrgContext,
} from "./org-context";

/**
 * OrgContext plus display-only fields the shell needs (org name) that
 * OrgContext itself deliberately excludes -- OrgContext is for
 * authorization decisions, not UI rendering, so it stays minimal.
 */
export interface CurrentOrgSummary {
  context: OrgContext;
  organizationName: string;
}

/**
 * Resolves the current org context (+ display name) from a session-
 * scoped Supabase client (never the service-role one -- this must
 * only ever see what the signed-in user is actually a member of, via
 * RLS). Takes the client as a parameter rather than constructing one
 * itself, so this stays pure application-layer code with no direct
 * infrastructure import (docs/plans/MASTER_PLAN.md §10: "an explicit
 * OrgContext... never ambient").
 *
 * Returns null when signed out, or when signed in but not yet a
 * member of any organization (the onboarding case). Picks the first
 * membership found -- real multi-org switching (an org-switcher
 * actually choosing between several) is not yet built; this always
 * resolves to "the org this user happens to belong to first" until
 * that UI exists.
 */
export async function getCurrentOrgSummary(
  supabase: SupabaseClient,
): Promise<CurrentOrgSummary | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data: membership } =
    await supabase
      .from("memberships")
      .select(
        "org_id, role, organizations(name, capabilities)",
      )
      .limit(1)
      .maybeSingle();

  if (!membership) {
    return null;
  }

  const organization =
    Array.isArray(membership.organizations)
      ? membership.organizations[0]
      : membership.organizations;

  if (!organization) {
    return null;
  }

  return {
    context: {
      org_id: membership.org_id,
      user_id: user.id,
      role: membership.role,
      capabilities: organization.capabilities ?? [],
    } as OrgContext,

    organizationName: organization.name,
  };
}

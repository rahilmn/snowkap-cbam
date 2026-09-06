import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  OrgContext,
} from "./org-context";

/**
 * One organization the current user belongs to -- enough to render an
 * org-switcher option and, once selected, to become the active
 * OrgContext.
 */
export interface OrgMembershipSummary {
  orgId: OrgContext["org_id"];
  organizationName: string;
  role: OrgContext["role"];
  capabilities: OrgContext["capabilities"];
}

/**
 * OrgContext plus display-only fields the shell needs (org name,
 * every org this user could switch to) that OrgContext itself
 * deliberately excludes -- OrgContext is for authorization decisions,
 * not UI rendering, so it stays minimal.
 */
export interface CurrentOrgSummary {
  context: OrgContext;
  organizationName: string;
  availableOrganizations: OrgMembershipSummary[];
}

/**
 * Resolves the current org context (+ display name + switchable org
 * list) from a session-scoped Supabase client (never the service-role
 * one -- this must only ever see what the signed-in user is actually
 * a member of, via RLS). Takes the client as a parameter rather than
 * constructing one itself, so this stays pure application-layer code
 * with no direct infrastructure import (docs/plans/MASTER_PLAN.md
 * §10: "an explicit OrgContext... never ambient").
 *
 * `preferredOrgId` is the caller's active-org preference (the UI layer
 * reads this from a cookie -- see components/shell/org-switcher.tsx --
 * this function stays framework-independent and just takes the value
 * as a plain parameter). When it doesn't match any of the user's
 * memberships (stale cookie, no longer a member, or unset), falls back
 * to their oldest membership -- a stable, deterministic default rather
 * than an arbitrary unordered pick.
 *
 * Returns null when signed out, or when signed in but not yet a
 * member of any organization (the onboarding case).
 *
 * Revocation-on-role-change (P10 session hardening, master plan §14):
 * this function is what makes it true by construction, with nothing to
 * invalidate. There is no caching layer anywhere in this path --
 * `getServerSupabaseClient()` (src/infrastructure/supabase/server-
 * client.ts) is deliberately un-memoized per-request, the `memberships`
 * query above runs live against Postgres on every single call (no
 * `unstable_cache`/`React.cache()` wraps it or this function -- checked
 * across every call site: components/shell/app-shell.tsx and every
 * `app/**\/page.tsx`/`actions.ts` that imports it), and role/
 * capabilities are never baked into a custom JWT claim (`supabase/
 * config.toml`'s `[auth.hook.custom_access_token]` is disabled) that
 * could keep asserting a stale role until the token itself expires. So
 * an ADMIN demoted to MEMBER (or removed from the org entirely, which
 * just drops their row out of `memberships` and this function's
 * returned `summaries`) has that reflected on their very next request
 * -- the next Server Component render or server action, not "after the
 * access token expires." Guard this invariant if a caching layer is
 * ever introduced here: it would need to key on more than `user_id`
 * (a role change doesn't rotate the session) or be invalidated
 * explicitly on every membership write.
 */
export async function getCurrentOrgSummary(
  supabase: SupabaseClient,
  preferredOrgId?: string,
): Promise<CurrentOrgSummary | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data: memberships, error } =
    await supabase
      .from("memberships")
      .select(
        "org_id, role, created_at, organizations(name, capabilities)",
      )
      // memberships_select_own_org's RLS policy scopes visibility to
      // "any row in an org I belong to" (correct for e.g. the Team
      // screen listing teammates), not "only my own row" -- without
      // this explicit filter, a user in an org with other members
      // would get teammates' rows mixed into what's supposed to be
      // strictly their own org/role list, potentially resolving the
      // wrong role for their own OrgContext.
      .eq(
        "user_id",
        user.id,
      )
      .order(
        "created_at",
        { ascending: true },
      );

  // 2026-09-07 (S5 review round 6, finding S5R6-A-1). This is the
  // single most load-bearing read in the whole application -- every
  // page.tsx under app/** and nearly every Server Action calls it, and
  // both app/(importer)/layout.tsx and app/(producer)/layout.tsx
  // redirect("/onboarding") on a null result, exactly as if the caller
  // had never joined an organization. A genuine Postgres/transport
  // error on this one query was previously indistinguishable from that
  // case (the destructure above never named `error`), so a transient
  // failure bounced every authenticated, actually-org-member user in
  // the entire product to onboarding, or silently denied whatever
  // action they were taking -- the same defect class round 5 already
  // fixed in three siblings (organization-profile.ts's
  // getOrganizationProfile, get-shipment-detail.ts,
  // get-declaration-detail.ts's fetchMemberShipments) but never applied
  // here, despite this function having by far the largest blast radius
  // of any of them.
  if (error) {
    throw new Error(
      `get-current-org-context: memberships fetch failed (${error.message}).`,
    );
  }

  if (!memberships || memberships.length === 0) {
    return null;
  }

  const summaries: OrgMembershipSummary[] =
    memberships
      .map(
        (membership) => {
          const organization =
            Array.isArray(membership.organizations)
              ? membership.organizations[0]
              : membership.organizations;

          if (!organization) {
            return null;
          }

          return {
            orgId: membership.org_id,
            organizationName: organization.name,
            role: membership.role,
            capabilities: organization.capabilities ?? [],
          } as OrgMembershipSummary;
        },
      )
      .filter(
        (summary): summary is OrgMembershipSummary =>
          summary !== null,
      );

  if (summaries.length === 0) {
    return null;
  }

  const active =
    summaries.find(
      (summary) => summary.orgId === preferredOrgId,
    ) ??
    summaries[0];

  return {
    context: {
      org_id: active.orgId,
      user_id: user.id,
      role: active.role,
      capabilities: active.capabilities,
    } as OrgContext,

    organizationName: active.organizationName,
    availableOrganizations: summaries,
  };
}

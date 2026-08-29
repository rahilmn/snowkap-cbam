"use server";

import { cookies } from "next/headers";

import { redirect } from "next/navigation";

import { ACTIVE_ORG_COOKIE } from "./org-switcher-constants";

/**
 * Sets the caller's active-org preference and lands them on the
 * dashboard, per §27 screen 4 ("instant switch, capability-aware
 * landing") -- the dashboard is where AppShell resolves the new
 * org's nav/capabilities fresh, rather than staying on whatever page
 * triggered the switch.
 *
 * No authorization check needed here: this cookie is only ever read
 * as a *preference* by getCurrentOrgSummary
 * (src/application/organizations/get-current-org-context.ts), which
 * falls back to the caller's oldest actual membership whenever the
 * preferred org doesn't match one of their real memberships (RLS-
 * verified there, not here) -- so a forged cookie value can only ever
 * select among orgs RLS already proves the caller belongs to.
 */
export async function switchOrganizationAction(
  formData: FormData,
): Promise<void> {
  const orgId =
    formData.get(
      "orgId",
    );

  if (typeof orgId !== "string" || orgId.length === 0) {
    return;
  }

  const cookieStore =
    await cookies();

  cookieStore.set(
    ACTIVE_ORG_COOKIE,
    orgId,
    {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      // 2026-08-29 (P11 finding #14): matches the same fix applied to
      // the three Supabase create*Client call sites -- this cookie
      // only carries an org preference (see this file's own header
      // comment on why no authorization check is needed here), but
      // there's no reason for it to be sent over plaintext http:// in
      // production either.
      secure: process.env.NODE_ENV === "production",
    },
  );

  redirect(
    "/",
  );
}

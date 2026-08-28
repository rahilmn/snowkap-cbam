import { cookies } from "next/headers";

import { ACTIVE_ORG_COOKIE } from "./org-switcher-constants";

/**
 * The caller's active-org preference, if any -- read by every Server
 * Component/Action that resolves org context
 * (getCurrentOrgSummary(supabase, preferredOrgId)) so a switch made
 * via the topbar's OrgSwitcher is honored consistently across the
 * app, not just on whichever page the switch happened to trigger a
 * redirect to.
 */
export async function getPreferredOrgId(): Promise<string | undefined> {
  const cookieStore =
    await cookies();

  return cookieStore.get(
    ACTIVE_ORG_COOKIE,
  )?.value;
}

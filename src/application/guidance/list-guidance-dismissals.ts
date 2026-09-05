import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  OrganizationId,
} from "../../domain/shared/ids";

/**
 * The caller's own dismissed guidance item ids for this org --
 * guidance_dismissals_select_own (20260905160000) already scopes rows
 * to `user_id = auth.uid()` server-side, so this never reads another
 * member's dismissals even though the query itself only filters by
 * org_id.
 *
 * Fails closed to an empty set on any read error, matching
 * getOrganizationSmeProfile's own "never as an error" posture
 * (organization-sme-profile.ts) -- a failed dismissal read should
 * degrade to "nothing is dismissed" (every item shows), not break the
 * guidance dashboard.
 */
export async function listGuidanceDismissals(
  supabase: SupabaseClient,
  orgId: OrganizationId,
): Promise<Set<string>> {
  const { data, error } =
    await supabase
      .from("guidance_dismissals")
      .select(
        "item_key",
      )
      .eq(
        "org_id",
        orgId,
      );

  if (error || !data) {
    return new Set();
  }

  return new Set(
    data.map(
      (row: { item_key: string }) => row.item_key,
    ),
  );
}

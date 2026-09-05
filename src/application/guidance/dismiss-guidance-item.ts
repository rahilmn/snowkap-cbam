import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  OrgContext,
} from "../organizations/org-context";

export type DismissGuidanceItemResult =
  | { status: "OK" }
  | { status: "PERSIST_FAILED" };

/**
 * Records a standing dismissal of one guidance item id
 * (guidance_dismissals_insert_own, 20260905160000). user_id is never
 * sent -- the table's own BEFORE INSERT trigger pins it from
 * auth.uid(), so the RLS WITH CHECK always sees the real caller
 * regardless of what this function does or doesn't send.
 *
 * Idempotent: re-dismissing an already-dismissed item hits
 * guidance_dismissals_unique_per_user_item (org_id, user_id, item_key)
 * and is treated as success, not an error -- the caller's intent
 * ("I don't want to see this") is already satisfied.
 */
export async function dismissGuidanceItem(
  supabase: SupabaseClient,
  context: OrgContext,
  itemKey: string,
): Promise<DismissGuidanceItemResult> {
  const { error } =
    await supabase
      .from("guidance_dismissals")
      .insert(
        {
          org_id: context.org_id,
          item_key: itemKey,
        },
      );

  if (error && error.code !== "23505") {
    return {
      status: "PERSIST_FAILED",
    };
  }

  return {
    status: "OK",
  };
}

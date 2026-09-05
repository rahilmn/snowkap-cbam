import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  OrgContext,
} from "../organizations/org-context";

import {
  deriveGuidanceItems,
  type GuidanceItemsResult,
} from "./derive-guidance-items";

export type GuidanceAttentionResult =
  GuidanceItemsResult;

/**
 * /attention's single entry point: the org's COMPLETE guidance set,
 * uncapped -- everything the dashboard's own compact tile
 * (deriveDashboardGuidance) may have left out of its 3-card cap,
 * reachable via the dashboard's REQUIRED overflow control
 * (components/guidance/guidance-work-queue.tsx links here as
 * /attention#required).
 *
 * 2026-09-05 (S2 remediation, B1, fresh Opus 5 review). Deliberately a
 * thin wrapper around the SAME deriveGuidanceItems the dashboard calls
 * -- "preserve deterministic guidance semantics" means /attention can
 * never show a different ranked answer than the dashboard's own tile
 * is capping, since there is only ever one derivation.
 */
export async function deriveAttentionGuidance(
  supabase: SupabaseClient,
  context: OrgContext,
): Promise<GuidanceAttentionResult> {
  return deriveGuidanceItems(
    supabase,
    context,
  );
}

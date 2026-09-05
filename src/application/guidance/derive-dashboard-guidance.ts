import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  OrgContext,
} from "../organizations/org-context";

import {
  deriveGuidanceItems,
} from "./derive-guidance-items";

import {
  capGuidanceItems,
  type GuidanceCapResult,
} from "../../domain/guidance/cap";

export type GuidanceDashboardResult =
  | { status: "OK"; cap: GuidanceCapResult }
  | { status: "UNAVAILABLE" };

/**
 * The dashboard work queue's single entry point: derive the org's
 * complete guidance set (deriveGuidanceItems) and cap it to the
 * compact dashboard tile (src/domain/guidance/cap.ts).
 *
 * 2026-09-05 (S2 remediation, B1 + B3, fresh Opus 5 review). Return
 * type changed from a bare GuidanceCapResult to a {status} union:
 * UNAVAILABLE is a genuine fetch failure (see deriveGuidanceItems),
 * distinguishable from OK-with-nothing-visible -- GuidanceWorkQueue
 * renders the two very differently, since the whole point of this
 * distinction is that a compliance work-queue must never show an
 * affirmative "nothing needs your attention" when it actually just
 * failed to find out.
 */
export async function deriveDashboardGuidance(
  supabase: SupabaseClient,
  context: OrgContext,
): Promise<GuidanceDashboardResult> {
  const items =
    await deriveGuidanceItems(
      supabase,
      context,
    );

  if (items.status === "UNAVAILABLE") {
    return {
      status: "UNAVAILABLE",
    };
  }

  return {
    status: "OK",
    cap:
      capGuidanceItems(
        items.items,
      ),
  };
}

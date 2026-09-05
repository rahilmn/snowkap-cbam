import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  Declaration,
} from "../../domain/declarations/types";

import type {
  OrganizationId,
} from "../../domain/shared/ids";

import {
  DECLARATION_COLUMNS,
  toDeclaration,
  type DeclarationRow,
} from "./declaration-mapper";

/**
 * Every declaration -- DRAFT, READY, FILED_RECORDED, VOID, original or
 * amendment -- ever created for this org, newest first. Unfiltered by
 * status deliberately: a VOID row and a superseded original are both
 * real facts about this org's declarations, not noise to hide,
 * matching listSharingGrantsIssued's own "no status filter, the screen
 * owns that" posture (manage-sharing-grants.ts).
 *
 * 2026-09-06 (S2 remediation, B3 follow-up, fresh Opus 5 adversarial
 * pre-verification). This function's one real caller is
 * deriveGuidanceItems, which centralizes "a genuine fetch failure must
 * be distinguishable from a real empty result" for the whole guidance
 * read path (derive-guidance-items.ts) -- but that guarantee is only
 * as good as every fetch it wraps. This USED to swallow a real query
 * error into `[]`, indistinguishable from "this org genuinely has no
 * declarations," which deriveGuidanceItems's own try/catch could never
 * see (nothing was thrown) -- silently forcing every I19 item's impact
 * to APPROVAL org-wide with no signal anything failed. Matches this
 * codebase's own "throw is for infrastructure failures" convention
 * (CLAUDE.md), same as listDraftShipmentsWithLines.
 */
export async function listDeclarations(
  supabase: SupabaseClient,
  orgId: OrganizationId,
): Promise<Declaration[]> {
  const { data, error } =
    await supabase
      .from("declarations")
      .select(
        DECLARATION_COLUMNS,
      )
      .eq("org_id", orgId)
      .order("created_at", { ascending: false });

  if (error) {
    throw new Error(
      `guidance: declarations fetch failed (${error.message}).`,
    );
  }

  return ((data ?? []) as DeclarationRow[]).map(
    toDeclaration,
  );
}

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
 * The declarations list screen (master plan §27 screen 22): every
 * declaration -- DRAFT, READY, FILED_RECORDED, VOID, original or
 * amendment -- ever created for this org, newest first. Unfiltered by
 * status deliberately: the screen itself is the place a caller sees the
 * full history (a VOID row and a superseded original are both real
 * facts about this org's declarations, not noise to hide), matching
 * listSharingGrantsIssued's own "no status filter, the screen owns
 * that" posture (manage-sharing-grants.ts).
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

  if (error || !data) {
    return [];
  }

  return (data as DeclarationRow[]).map(
    toDeclaration,
  );
}

import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  OrgContext,
} from "../organizations/org-context";

import {
  listDraftShipmentsWithLines,
} from "../shipments/list-draft-shipments-with-lines";

import {
  listDeclarations,
} from "../declarations/list-declarations";

import {
  listGuidanceDismissals,
} from "./list-guidance-dismissals";

import {
  deriveI19Items,
} from "../../domain/guidance/i19";

import {
  runGuidancePipeline,
} from "../../domain/guidance/pipeline";

import type {
  GuidanceCapResult,
} from "../../domain/guidance/cap";

/**
 * The dashboard work queue's single entry point: fetch real,
 * authoritative domain state (never audit events, never a persisted
 * "guidance state" -- there is none), derive every known rule's
 * candidate items, and run them through the shared pipeline.
 *
 * Rules are concatenated here as a flat list before the pipeline runs
 * -- adding the rest of v2.1.1's catalog (I2/I3/I5/I16/I17, ...) once
 * their exact definitions are available means adding another
 * deriveIxxItems(...) call to this array, not touching the pipeline or
 * anything upstream of it.
 */
export async function deriveDashboardGuidance(
  supabase: SupabaseClient,
  context: OrgContext,
): Promise<GuidanceCapResult> {
  const [draftShipments, declarations, dismissedItemIds] =
    await Promise.all(
      [
        listDraftShipmentsWithLines(
          supabase,
          context.org_id,
        ),
        listDeclarations(
          supabase,
          context.org_id,
        ),
        listGuidanceDismissals(
          supabase,
          context.org_id,
        ),
      ],
    );

  const candidateItems =
    [
      ...deriveI19Items(
        draftShipments,
        declarations,
      ),
    ];

  return runGuidancePipeline(
    candidateItems,
    dismissedItemIds,
  );
}

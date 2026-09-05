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
  GuidanceItem,
} from "../../domain/guidance/types";

export type GuidanceItemsResult =
  | { status: "OK"; items: GuidanceItem[] }
  | { status: "UNAVAILABLE" };

/**
 * The single shared entry point for "what does this org's guidance
 * look like right now": fetch real, authoritative domain state (never
 * audit events, never a persisted "guidance state" -- there is none),
 * derive every known rule's candidate items, and run them through the
 * shared pipeline (aggregate -> rank -> dedup -> dismiss). Returns the
 * COMPLETE resulting set -- uncapped.
 *
 * Both deriveDashboardGuidance (which additionally caps this for its
 * own compact tile, src/domain/guidance/cap.ts) and
 * deriveAttentionGuidance (which shows this same set in full, at
 * /attention) call this ONE function -- "preserve deterministic
 * guidance semantics" means the two views are always the same ranked
 * collection, never two independently-derived answers that could
 * disagree.
 *
 * Rules are concatenated here as a flat list before the pipeline runs
 * -- adding the rest of v2.1.1's catalog (I2/I3/I5/I16/I17, ...) once
 * their exact definitions are available means adding another
 * deriveIxxItems(...) call to this array, not touching the pipeline,
 * the cap, or either screen.
 *
 * 2026-09-05 (S2 remediation, B3, fresh Opus 5 review). A real
 * infrastructure failure while fetching domain state (e.g.
 * listDraftShipmentsWithLines throwing on a query error, matching this
 * codebase's own "throw is for infrastructure failures" convention --
 * CLAUDE.md) is caught HERE and turned into an explicit UNAVAILABLE
 * result, distinguishable from a genuine empty queue -- never allowed
 * to degrade into "nothing needs your attention," the exact false
 * reassurance a compliance work-queue must not produce.
 */
export async function deriveGuidanceItems(
  supabase: SupabaseClient,
  context: OrgContext,
): Promise<GuidanceItemsResult> {
  try {
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

    return {
      status: "OK",
      items:
        runGuidancePipeline(
          candidateItems,
          dismissedItemIds,
        ),
    };
  } catch {
    return {
      status: "UNAVAILABLE",
    };
  }
}

import type {
  GuidanceItem,
} from "./types";

export const DASHBOARD_GUIDANCE_CAP = 3;

export interface GuidanceCapResult {
  // Exactly the first DASHBOARD_GUIDANCE_CAP ranked items -- never
  // more, whatever their priority. The dashboard tile is a compact
  // preview, not the complete work queue; the complete ranked set
  // (including everything past the cap) is what /attention
  // (app/attention/page.tsx) shows.
  visible: GuidanceItem[];

  // How many items beyond `visible` exist at all (any priority). A
  // caller uses this to decide whether to render a generic "See all"
  // overflow control at all -- 0 means `visible` already contains
  // everything.
  hiddenCount: number;

  // Of `hiddenCount`, how many are REQUIRED. v2.1.1: required overflow
  // must be explicit and reachable, never a silently dropped item --
  // when this is > 0 a caller must render a REQUIRED-specific overflow
  // control (distinct from a generic "See all") linking to
  // /attention#required, since hidden REQUIRED work is the one case
  // that must never look like "nothing else to do here."
  requiredOverflowCount: number;
}

/**
 * Assumes `items` is already ranked (rank.ts) so REQUIRED items sort
 * before RECOMMENDED/OPTIONAL and, within a tier, in the intended
 * display order -- capGuidanceItems does not re-sort.
 *
 * 2026-09-05 (S2 remediation, B1, fresh Opus 5 review). This USED to
 * put every REQUIRED item into `visible` uncapped (reading v2.1.1's
 * "preserve REQUIRED visibility" as "never hide a REQUIRED item"),
 * while separately reporting requiredOverflowCount for the excess --
 * so with 5 REQUIRED items the dashboard rendered all 5 cards AND a
 * "(+2 more required)" label counting items already on screen. The cap
 * is now a real cap: `visible` is always at most
 * DASHBOARD_GUIDANCE_CAP items. "Preserve REQUIRED visibility" is
 * honoured instead by requiredOverflowCount making any hidden REQUIRED
 * work an explicit, reachable overflow control (never a silent drop)
 * and by the complete ranked set staying available, uncapped, via
 * /attention -- not by inflating the dashboard tile's own card count.
 *
 * "Do not create a 'prison' workflow where the user cannot continue
 * because optional work is incomplete" (v2.1.1): this function only
 * decides what's SHOWN on the compact dashboard tile; it has no
 * authorization or blocking semantics of its own.
 */
export function capGuidanceItems(
  items: GuidanceItem[],
): GuidanceCapResult {
  const visible =
    items.slice(
      0,
      DASHBOARD_GUIDANCE_CAP,
    );

  const hidden =
    items.slice(
      DASHBOARD_GUIDANCE_CAP,
    );

  return {
    visible,
    hiddenCount: hidden.length,
    requiredOverflowCount:
      hidden.filter(
        (item) => item.priority === "REQUIRED",
      ).length,
  };
}

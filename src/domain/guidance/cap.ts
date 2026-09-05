import type {
  GuidanceItem,
} from "./types";

export const DASHBOARD_GUIDANCE_CAP = 3;

export interface GuidanceCapResult {
  visible: GuidanceItem[];

  // How many REQUIRED items exceeded DASHBOARD_GUIDANCE_CAP -- 0 when
  // REQUIRED alone fits within the cap. Never means anything was
  // hidden: v2.1.1's own "preserve REQUIRED visibility / overflow
  // control" is read literally here -- ALL REQUIRED items are always
  // in `visible`, even past the cap. This count exists only so a
  // caller can render an "overflow" affordance (a badge, a "+N" style
  // indicator) when the required list grows past the nominal 3, not to
  // gate what's shown.
  requiredOverflowCount: number;
}

/**
 * Assumes `items` is already ranked (rank.ts) so REQUIRED items sort
 * before RECOMMENDED/OPTIONAL and, within a tier, in the intended
 * display order -- capGuidanceItems does not re-sort.
 *
 * "Do not create a 'prison' workflow where the user cannot continue
 * because optional work is incomplete" (v2.1.1): this function only
 * decides what's SHOWN on the compact dashboard tile; it has no
 * authorization or blocking semantics of its own.
 */
export function capGuidanceItems(
  items: GuidanceItem[],
): GuidanceCapResult {
  const required =
    items.filter(
      (item) => item.priority === "REQUIRED",
    );

  if (required.length >= DASHBOARD_GUIDANCE_CAP) {
    return {
      visible: required,
      requiredOverflowCount:
        Math.max(
          0,
          required.length - DASHBOARD_GUIDANCE_CAP,
        ),
    };
  }

  const nonRequired =
    items.filter(
      (item) => item.priority !== "REQUIRED",
    );

  const remainingSlots =
    DASHBOARD_GUIDANCE_CAP - required.length;

  return {
    visible: [
      ...required,
      ...nonRequired.slice(
        0,
        remainingSlots,
      ),
    ],
    requiredOverflowCount: 0,
  };
}

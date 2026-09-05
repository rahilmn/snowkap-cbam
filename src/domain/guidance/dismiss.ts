import type {
  GuidanceItem,
} from "./types";

/**
 * v2.1.1's dismissal semantics, exactly: "evaluated after ranking,
 * before cap. REQUIRED ignores dismissal. dismissal applies when item
 * becomes optional/recommended. No snooze." -- so a dismissal is a
 * standing preference keyed by item id, not a time-based mute: it has
 * NO effect on a REQUIRED item (regardless of whether that item was
 * dismissed while it had a lower priority), and it filters out a
 * non-REQUIRED item whose id matches a dismissal record. There is no
 * separate "reappearance" mechanism to implement -- an item simply
 * isn't filtered once its own freshly-derived priority is REQUIRED
 * again, which is what "no snooze, reappears on priority change"
 * reduces to given items are re-derived (never loaded from a stale
 * cache) on every call.
 *
 * Pure, non-mutating. `dismissedItemIds` is the caller's own set of
 * this user's dismissal fingerprints for this org (from
 * guidance_dismissals), not fetched here.
 */
export function applyGuidanceDismissals(
  items: GuidanceItem[],
  dismissedItemIds: ReadonlySet<string>,
): GuidanceItem[] {
  return items.filter(
    (item) =>
      item.priority === "REQUIRED" ||
      !dismissedItemIds.has(item.id),
  );
}

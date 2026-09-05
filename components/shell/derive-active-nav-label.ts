import type {
  NavItem,
} from "./sidebar";

/**
 * Which nav item's `label` the current pathname should highlight,
 * derived from the item's own `href` rather than a caller-supplied
 * literal string (SME Experience v2.1.1, S1 -- "derived navigation").
 * Pure and pathname-only, so it's trivially unit-testable and, more
 * importantly, correct-by-construction: a page can no longer highlight
 * the wrong item just because whoever wrote it typed the wrong label
 * or forgot to update it after a route moved.
 *
 * Matching rules, in order:
 * 1. `href === "/"` matches ONLY `pathname === "/"` exactly -- every
 *    other pathname also technically "starts with /", so a naive
 *    prefix check would make the Dashboard item match every route.
 * 2. Every other item matches on an exact pathname equality OR a
 *    `${href}/` prefix (a path-SEGMENT boundary, so `href: "/ship"`
 *    could never accidentally match `pathname: "/shipments"` -- not a
 *    real case in this nav today, but the boundary check costs
 *    nothing and rules the whole class out). This is what makes a
 *    detail route like `/shipments/[id]` or `/declarations/[id]`
 *    still highlight "Shipments"/"Declarations".
 * 3. When more than one non-root item's href matches (not a case that
 *    exists in the current nav, but a future one could nest routes),
 *    the LONGEST matching href wins, so a more specific item is never
 *    shadowed by a shorter, coarser one.
 *
 * Callers pass every NavItem the current experience could show
 * (IMPORTER_NAV or PRODUCER_NAV, concatenated with SETTINGS_NAV) --
 * this function doesn't know or care which set an item came from.
 *
 * A pathname that matches no item at all (e.g. /status,
 * /account/password, /design, /onboarding/setup) correctly returns
 * `undefined` -- no item highlighted, which is either the same as
 * today's behaviour (those pages already pass no matching label, or
 * one that doesn't correspond to a real nav item) or, for
 * /onboarding/setup specifically, a deliberate, small, documented
 * behaviour change from the one page that used to force "Dashboard"
 * for a route that isn't actually the dashboard (see that page's own
 * comment on why it still passes an explicit activeNavLabel).
 */
export function deriveActiveNavLabel(
  pathname: string,
  navItems: NavItem[],
): string | undefined {
  const rootItem =
    navItems.find(
      (item) => item.href === "/",
    );

  if (pathname === "/" && rootItem) {
    return rootItem.label;
  }

  let bestMatch: NavItem | undefined =
    undefined;

  let bestMatchLength =
    -1;

  for (
    const item of navItems
  ) {
    if (!item.href || item.href === "/") {
      continue;
    }

    const matches =
      pathname === item.href ||
      pathname.startsWith(`${item.href}/`);

    if (matches && item.href.length > bestMatchLength) {
      bestMatch =
        item;

      bestMatchLength =
        item.href.length;
    }
  }

  return bestMatch?.label;
}

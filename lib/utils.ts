import {
  clsx,
  type ClassValue,
} from "clsx";

import {
  twMerge,
} from "tailwind-merge";

/**
 * Merges conditional class names and resolves Tailwind class conflicts
 * (e.g. `cn("p-2", condition && "p-4")` keeps only `p-4`). The standard
 * shadcn/ui-style helper, kept here rather than pulled in as a
 * generated file so it follows this repo's own import conventions (see
 * docs/architecture/ARCHITECTURE.md -- relative imports with `.js`
 * extensions, no path aliases).
 */
export function cn(
  ...inputs: ClassValue[]
): string {
  return twMerge(
    clsx(
      inputs,
    ),
  );
}

/**
 * Date-only formatting (no time component) for read-only timestamps
 * shown across the app -- invitation expiry, membership deactivation
 * date, organization creation date. Locale is fixed (en-GB) rather than
 * left to the runtime default so server-rendered and client-hydrated
 * output can't disagree and trip a hydration mismatch -- the same
 * reasoning as the (time-inclusive) formatTimestamp helpers in
 * app/status/page.tsx and
 * app/(producer)/sharing/status/shared-data-status-list.tsx, which this
 * doesn't replace: both of those need a time component their callers
 * don't.
 */
export function formatDate(
  iso: string,
): string {
  return new Date(
    iso,
  ).toLocaleDateString(
    "en-GB",
    {
      dateStyle: "medium",
    },
  );
}

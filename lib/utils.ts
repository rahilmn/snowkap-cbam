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

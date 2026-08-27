"use client";

import {
  Search,
} from "lucide-react";

/**
 * Visual stub only for Phase 2 -- the actual ⌘K command palette
 * (search/navigation) is out of this phase's scope
 * (docs/plans/MASTER_PLAN.md P2 non-scope: "auth, product tables, data
 * screens, real org switcher"). This establishes the affordance's
 * position and appearance in the shell so later phases wire behavior
 * into an existing, already-reviewed slot rather than reflowing the
 * topbar layout.
 */
export function CommandPaletteTrigger() {
  return (
    <button
      type="button"
      disabled
      className="hidden h-9 w-64 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-sunken)] px-3 text-sm text-[var(--text-tertiary)] disabled:cursor-not-allowed sm:flex"
      aria-label="Search (coming soon)"
    >
      <Search
        className="size-4"
        aria-hidden="true"
      />

      <span className="flex-1 text-left">
        Search…
      </span>

      <kbd className="rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-raised)] px-1.5 py-0.5 font-mono text-[10px]">
        ⌘K
      </kbd>
    </button>
  );
}

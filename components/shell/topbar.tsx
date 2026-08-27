import {
  ChevronsUpDown,
} from "lucide-react";

import {
  Wordmark,
} from "./wordmark";

import {
  CommandPaletteTrigger,
} from "./command-palette-trigger";

import {
  ThemeToggle,
} from "./theme-toggle";

/**
 * The org switcher shown here is a static visual placeholder -- real
 * organization switching needs authentication and memberships, which
 * are Phase 3 scope. The topbar's layout (this component) is reviewed
 * now so Phase 3 wires live data into an existing slot.
 */
export function Topbar() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-[var(--border-default)] bg-[var(--surface-raised)] px-4">
      <div className="flex items-center gap-3">
        <Wordmark />

        <div className="hidden h-5 w-px bg-[var(--border-default)] sm:block" />

        <button
          type="button"
          disabled
          className="hidden items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1 text-sm text-[var(--text-secondary)] disabled:cursor-not-allowed sm:flex"
        >
          Acme Importers Ltd

          <ChevronsUpDown
            className="size-3.5 text-[var(--text-tertiary)]"
            aria-hidden="true"
          />
        </button>
      </div>

      <div className="flex items-center gap-3">
        <CommandPaletteTrigger />

        <ThemeToggle />

        <div
          className="flex size-8 items-center justify-center rounded-full bg-[var(--surface-sunken)] text-xs font-medium text-[var(--text-secondary)]"
          aria-hidden="true"
        >
          RN
        </div>
      </div>
    </header>
  );
}

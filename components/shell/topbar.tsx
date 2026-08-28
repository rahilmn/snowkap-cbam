import {
  ChevronsUpDown,
  LogOut,
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

import {
  signOutAction,
} from "../../app/(auth)/actions";

export interface TopbarProps {
  /**
   * null when signed out, or signed in without an org yet (onboarding
   * in progress) -- the org-switcher button hides itself rather than
   * showing a misleading placeholder in either case.
   */
  organizationName: string | null;
}

export function Topbar(
  {
    organizationName,
  }: TopbarProps,
) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-[var(--border-default)] bg-[var(--surface-raised)] px-4">
      <div className="flex items-center gap-3">
        <Wordmark />

        {organizationName ? (
          <>
            <div className="hidden h-5 w-px bg-[var(--border-default)] sm:block" />

            <button
              type="button"
              disabled
              className="hidden items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1 text-sm text-[var(--text-secondary)] disabled:cursor-not-allowed sm:flex"
            >
              {organizationName}

              <ChevronsUpDown
                className="size-3.5 text-[var(--text-tertiary)]"
                aria-hidden="true"
              />
            </button>
          </>
        ) : null}
      </div>

      <div className="flex items-center gap-3">
        <CommandPaletteTrigger />

        <ThemeToggle />

        {organizationName ? (
          <form action={signOutAction}>
            <button
              type="submit"
              aria-label="Sign out"
              title="Sign out"
              className="flex size-8 items-center justify-center rounded-full bg-[var(--surface-sunken)] text-[var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--color-danger-100)] hover:text-[var(--color-danger-700)] focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <LogOut
                className="size-4"
                aria-hidden="true"
              />
            </button>
          </form>
        ) : null}
      </div>
    </header>
  );
}

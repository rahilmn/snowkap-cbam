import {
  Info,
  LogOut,
} from "lucide-react";

import Link from "next/link";

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
  MobileNav,
} from "./mobile-nav";

import type {
  Experience,
} from "./sidebar";

import {
  OrgSwitcher,
  type OrgSwitcherOption,
} from "./org-switcher";

import {
  signOutAction,
} from "../../app/(auth)/actions";

export interface TopbarProps {
  /**
   * null when signed out, or signed in without an org yet (onboarding
   * in progress) -- the org-switcher hides itself rather than showing
   * a misleading placeholder in either case.
   */
  organizationName: string | null;

  currentOrgId?: string;
  organizations?: OrgSwitcherOption[];
  // Passed through to the mobile drawer so it renders the SAME nav set
  // the desktop sidebar would for this org's capabilities.
  experience?: Experience;
  activeNavLabel?: string;
}

export function Topbar(
  {
    organizationName,
    currentOrgId,
    organizations,
    experience,
    activeNavLabel,
  }: TopbarProps,
) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-[var(--border-default)] bg-[var(--surface-raised)] px-4">
      <div className="flex min-w-0 items-center gap-3">
        <MobileNav
          experience={experience}
          activeLabel={activeNavLabel}
          currentOrgId={currentOrgId}
          organizations={organizations}
        />

        <Wordmark />

        {organizationName && currentOrgId && organizations ? (
          <>
            <div className="hidden h-5 w-px shrink-0 bg-[var(--border-default)] sm:block" />

            <OrgSwitcher
              currentOrgId={currentOrgId}
              organizations={organizations}
            />
          </>
        ) : null}
      </div>

      <div className="flex items-center gap-3">
        <CommandPaletteTrigger />

        <ThemeToggle />

        {/*
          Master plan §27 screen 6 ("System/status") is filed under
          "Shared/auth", not either experience's own nav (IMPORTER_NAV/
          PRODUCER_NAV, sidebar.tsx) -- so it lives here, next to the
          other cross-experience/account-level controls (sign-out
          below), rather than forced into one experience's primary nav.
          Always visible (not gated on organizationName like sign-out
          is): unlike sign-out, this link is meaningful even for a
          signed-in user who hasn't finished onboarding into an org yet.
        */}
        <Link
          href="/status"
          aria-label="System status"
          title="System status"
          className="flex size-8 items-center justify-center rounded-full bg-[var(--surface-sunken)] text-[var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--color-brand-100)] hover:text-[var(--color-brand-800)] focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <Info
            className="size-4"
            aria-hidden="true"
          />
        </Link>

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

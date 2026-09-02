import {
  Info,
  Mail,
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

  /**
   * Whether there is a session at all. Distinct from organizationName
   * on purpose: an invited user who has not accepted yet is signed in
   * WITHOUT an organization, and gating account controls on the org name
   * left them with no way to sign out.
   */
  isSignedIn?: boolean;

  /** Invitations addressed to this user, awaiting their acceptance. */
  pendingInvitationCount?: number;

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
    isSignedIn = false,
    pendingInvitationCount = 0,
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

        {/*
          2026-09-03 (P14). /accept-invitation is reachable from no
          navigation anywhere in the product, so an invited user who
          landed on any other screen -- which is what happens when their
          email link is spent, or when they simply visit the site later
          -- had no route to the invitation waiting for them. This is
          that route. Shown only when there is actually something to
          look at, so it is never a permanently-lit signal that teaches
          people to ignore it.
        */}
        {isSignedIn && pendingInvitationCount > 0 ? (
          <Link
            href="/accept-invitation"
            aria-label={`Pending invitations (${pendingInvitationCount})`}
            title={`Pending invitations (${pendingInvitationCount})`}
            className="relative flex size-8 items-center justify-center rounded-full bg-[var(--surface-sunken)] text-[var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--color-brand-100)] hover:text-[var(--color-brand-800)] focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <Mail
              className="size-4"
              aria-hidden="true"
            />

            <span
              aria-hidden="true"
              className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-[var(--color-brand-600)] px-1 text-[10px] font-medium leading-4 text-white"
            >
              {pendingInvitationCount}
            </span>
          </Link>
        ) : null}

        {/*
          Gated on being SIGNED IN, not on having an organization. It was
          previously gated on organizationName, which left a signed-in
          user without a membership -- an invited user who has not
          accepted yet, or someone mid-onboarding -- with no way to sign
          out at all, including on a shared machine.
        */}
        {isSignedIn ? (
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

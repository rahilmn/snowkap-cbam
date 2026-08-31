"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import Link from "next/link";

import {
  Menu,
  X,
} from "lucide-react";

import {
  IMPORTER_NAV,
  PRODUCER_NAV,
  SETTINGS_NAV,
  type Experience,
  type NavItem,
} from "./sidebar";

import {
  OrgSwitcher,
  type OrgSwitcherOption,
} from "./org-switcher";

import {
  cn,
} from "../../lib/utils";

/**
 * Mobile navigation drawer, shown only below the `md` breakpoint where
 * Sidebar hides itself.
 *
 * Added 2026-08-31 after live verification of the production deployment
 * found the app was **not navigable on a phone at all**: `Sidebar` is
 * `hidden ... md:flex` and `OrgSwitcher` is `hidden ... sm:block`, so at
 * 375px a user had no way to move between screens or switch
 * organizations except by typing URLs. The layout itself was sound (no
 * horizontal overflow, tables scrolled inside their own containers) --
 * this was purely a missing navigation affordance, and `sidebar.tsx`'s
 * own comment had deferred it to "a later UI phase". This is that phase.
 *
 * Deliberately reuses IMPORTER_NAV / PRODUCER_NAV / SETTINGS_NAV from
 * sidebar.tsx rather than re-declaring them, so the two navigations can
 * never drift apart -- including the disabled-placeholder treatment,
 * which is mirrored here for the same reason it exists there (a control
 * that looks live but does nothing reads as a bug).
 *
 * Accessibility, which is most of the work in a drawer:
 * - the trigger carries `aria-expanded` / `aria-controls`
 * - the panel is `role="dialog"` + `aria-modal` + `aria-label`
 * - Escape closes it
 * - focus moves into the panel on open and returns to the trigger on
 *   close, so keyboard users are never dropped at the top of the document
 * - a Tab-cycle guard keeps focus inside the open panel
 * - background scroll is locked while it is open
 */
export function MobileNav(
  {
    experience = "importer",
    activeLabel,
    currentOrgId,
    organizations,
  }: {
    experience?: Experience;
    activeLabel?: string;
    currentOrgId?: string;
    organizations?: OrgSwitcherOption[];
  },
) {
  const [open, setOpen] =
    useState(false);

  const panelId =
    useId();

  const triggerRef =
    useRef<HTMLButtonElement>(null);

  const panelRef =
    useRef<HTMLDivElement>(null);

  const primaryNav =
    experience === "producer"
      ? PRODUCER_NAV
      : IMPORTER_NAV;

  // Escape to close, plus a focus trap for Tab/Shift+Tab. Both are
  // registered only while open so this costs nothing on desktop.
  useEffect(
    () => {
      if (!open) {
        return;
      }

      function onKeyDown(
        event: KeyboardEvent,
      ) {
        if (event.key === "Escape") {
          event.preventDefault();
          setOpen(false);
          return;
        }

        if (event.key !== "Tab") {
          return;
        }

        const panel =
          panelRef.current;

        if (!panel) {
          return;
        }

        const focusable =
          panel.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), select, input, [tabindex]:not([tabindex="-1"])',
          );

        if (focusable.length === 0) {
          return;
        }

        const first =
          focusable[0]!;

        const last =
          focusable[focusable.length - 1]!;

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }

      document.addEventListener(
        "keydown",
        onKeyDown,
      );

      const previousOverflow =
        document.body.style.overflow;

      document.body.style.overflow =
        "hidden";

      // Move focus into the panel so a keyboard user lands somewhere
      // meaningful rather than at the top of the document.
      panelRef.current
        ?.querySelector<HTMLElement>(
          'a[href], button:not([disabled])',
        )
        ?.focus();

      return () => {
        document.removeEventListener(
          "keydown",
          onKeyDown,
        );

        document.body.style.overflow =
          previousOverflow;
      };
    },
    [open],
  );

  function close() {
    setOpen(false);

    // Return focus to the trigger -- otherwise closing the drawer strands
    // keyboard focus on a now-removed element.
    triggerRef.current?.focus();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        // Only exists below `md`, exactly where Sidebar hides itself.
        className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)] md:hidden"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="Open navigation menu"
        onClick={() => setOpen(true)}
      >
        <Menu className="size-5" />
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Close navigation menu"
            className="absolute inset-0 bg-black/60"
            onClick={close}
          />

          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto border-r border-[var(--border-default)] bg-[var(--surface-raised)] p-3"
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
                Navigation
              </span>

              <button
                type="button"
                onClick={close}
                aria-label="Close navigation menu"
                className="flex size-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)]"
              >
                <X className="size-4" />
              </button>
            </div>

            {/*
              The org switcher is hidden below `sm` in the topbar, so a
              phone user could not switch organizations at all. Surfacing
              it here is the other half of the navigation fix.
            */}
            {currentOrgId && organizations && organizations.length > 0 ? (
              <div className="mb-3 border-b border-[var(--border-default)] pb-3">
                <OrgSwitcher
                  currentOrgId={currentOrgId}
                  organizations={organizations}
                  className="flex sm:flex"
                />
              </div>
            ) : null}

            <MobileNavSection
              items={primaryNav}
              activeLabel={activeLabel}
              onNavigate={close}
            />

            <div className="my-2 h-px bg-[var(--border-default)]" />

            <MobileNavSection
              items={SETTINGS_NAV}
              activeLabel={activeLabel}
              onNavigate={close}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

function MobileNavSection(
  {
    items,
    activeLabel,
    onNavigate,
  }: {
    items: NavItem[];
    activeLabel?: string;
    onNavigate: () => void;
  },
) {
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map(
        (item) => {
          const isActive =
            item.label === activeLabel;

          const Icon =
            item.icon;

          const itemClassName =
            cn(
              "flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-2 text-left text-sm",
              isActive
                ? "bg-[var(--surface-sunken)] font-medium text-[var(--text-primary)]"
                : "text-[var(--text-secondary)]",
              // Same visible-disabled treatment as the desktop sidebar --
              // see its own comment for why semantics alone is not enough.
              !item.href &&
                "cursor-default text-[var(--text-tertiary)] opacity-60",
            );

          const content =
            (
              <>
                <Icon className="size-4 shrink-0" />

                <span className="truncate">
                  {item.label}
                </span>
              </>
            );

          return (
            <li key={item.label}>
              {item.href ? (
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={
                    isActive
                      ? "page"
                      : undefined
                  }
                  className={cn(
                    itemClassName,
                    "hover:bg-[var(--surface-sunken)]",
                  )}
                >
                  {content}
                </Link>
              ) : (
                <button
                  type="button"
                  disabled
                  title={`${item.label} is not available yet`}
                  className={itemClassName}
                >
                  {content}

                  <span className="sr-only">
                    {" "}(not available yet)
                  </span>
                </button>
              )}
            </li>
          );
        },
      )}
    </ul>
  );
}

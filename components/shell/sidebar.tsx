import {
  Activity,
  BarChart3,
  Building2,
  Calculator,
  ClipboardCheck,
  FileCheck2,
  FileStack,
  Factory,
  LayoutDashboard,
  Package,
  ScrollText,
  Settings,
  Share2,
  Ship,
  Truck,
  Users,
} from "lucide-react";

import type {
  ComponentType,
} from "react";

import Link from "next/link";

import {
  cn,
} from "../../lib/utils";

export type Experience =
  | "importer"
  | "producer";

export interface NavItem {
  label: string;
  icon: ComponentType<{ className?: string }>;
  // Real screens are wired one at a time as they're built (§27's
  // screen inventory) -- items without an href stay inert placeholders
  // rather than 404ing.
  href?: string;

  /**
   * 2026-09-03 (P14, WP-E). Why this item does not go anywhere.
   *
   * Every placeholder said "{label} is not available yet", and for
   * three of them that was simply FALSE. Evidence and Verification are
   * both fully built -- they live inline on each dataset under Emission
   * data -- and telling a producer they are "not available yet" sends
   * someone looking for a feature they are already using, or worse,
   * suggests the product cannot do something it can.
   *
   * A placeholder now says where the thing actually is, or admits it
   * genuinely does not exist. Whether these items should be REMOVED
   * rather than corrected is an open owner decision; stating something
   * untrue is not, and did not need to wait for it.
   */
  unavailableReason?: string;
}

/**
 * Which nav items appear is capability-driven (an org may be an
 * importer, a producer, or both -- docs/architecture/DOMAIN_MODEL.md,
 * "Regulatory role model"). Real capability data comes from
 * authenticated OrgContext in Phase 3; this is a visual stub selecting
 * between the two navigation sets so the shell layout is reviewed for
 * both experiences now, per docs/plans/MASTER_PLAN.md §7/§8's screen
 * inventories. Routes are not yet wired (no product screens exist
 * until Phase 4+) -- items render as inert placeholders.
 */
export const IMPORTER_NAV: NavItem[] = [
  { label: "Dashboard", icon: LayoutDashboard, href: "/" },
  { label: "Shipments", icon: Ship, href: "/shipments" },
  { label: "Emissions", icon: BarChart3, href: "/emissions" },
  {
    label: "Calculations",
    icon: Calculator,
    // Not a missing feature. Every line is calculated in place on its
    // own shipment, and "Why this number?" carries the full trace.
    // There is no separate calculations screen to build.
    unavailableReason:
      "Calculations happen per line on each shipment -- open a shipment and use \"Why this number?\" for the full trace",
  },
  { label: "Suppliers", icon: Truck, href: "/suppliers" },
  // 2026-09-03 (owner decision D2). "Installations" was a disabled
  // placeholder with the tooltip "Installations is not available yet",
  // because an importer genuinely had nowhere to record the operators
  // and installations behind its imports. It does now, and the label
  // says what the screen actually is: these are EXTERNAL operators --
  // ones that do not use Snowkap -- not the importer's own.
  { label: "External operators", icon: Factory, href: "/external-operators" },
  { label: "External emissions", icon: ClipboardCheck, href: "/external-emissions" },
  { label: "Audit", icon: ScrollText, href: "/audit" },
  { label: "Reports", icon: FileStack, href: "/reports" },
  { label: "Declarations", icon: FileCheck2, href: "/declarations" },
];

export const PRODUCER_NAV: NavItem[] = [
  { label: "Dashboard", icon: LayoutDashboard, href: "/" },
  { label: "Installations", icon: Factory, href: "/installations" },
  {
    label: "Production data",
    icon: Package,
    // This one IS genuinely absent: no installation-level production
    // route or scope concept exists in the schema. Said plainly rather
    // than dressed up as "coming soon".
    unavailableReason:
      "Not built. Production scope is recorded per emission-data record, as its CN codes and period",
  },
  { label: "Emissions", icon: BarChart3, href: "/emission-data" },
  {
    label: "Evidence",
    icon: ClipboardCheck,
    // Built and in daily use. The old tooltip said otherwise.
    unavailableReason:
      "Evidence is attached per dataset -- open Emission data and use each record's Evidence section",
  },
  {
    label: "Verification",
    icon: FileCheck2,
    // Also built. Also previously described as unavailable.
    unavailableReason:
      "Verification is per dataset -- open Emission data and use each record's Verify or Reject action",
  },
  { label: "Sharing", icon: Share2, href: "/sharing" },
  { label: "Activity", icon: Activity, href: "/activity" },
];

export const SETTINGS_NAV: NavItem[] = [
  { label: "Team", icon: Users, href: "/team" },
  { label: "Organization", icon: Building2, href: "/organization" },
  {
    label: "Settings",
    icon: Settings,
    unavailableReason:
      "Not built. Organization details are under Organization, and people under Team",
  },
];

export function Sidebar(
  {
    experience = "importer",
    activeLabel,
    className,
  }: {
    experience?: Experience;
    activeLabel?: string;
    className?: string;
  },
) {
  const primaryNav =
    experience === "producer"
      ? PRODUCER_NAV
      : IMPORTER_NAV;

  return (
    <nav
      className={cn(
        // Hidden below `md`: a persistent 224px sidebar has no business
        // eating >55% of a 375px viewport. A proper mobile nav (drawer/
        // bottom-bar) belongs in a later UI phase once there are real
        // screens to navigate between; hiding it here keeps the Phase 2
        // walking skeleton honest at mobile widths rather than shipping
        // a squeezed, half-broken layout. See
        // docs/plans/MASTER_PLAN.md §26 responsive rules.
        "hidden w-56 shrink-0 flex-col gap-1 border-r border-[var(--border-default)] bg-[var(--surface-raised)] p-2 md:flex",
        className,
      )}
      aria-label="Primary"
    >
      <SidebarSection
        items={primaryNav}
        activeLabel={activeLabel}
      />

      <div className="my-2 h-px bg-[var(--border-default)]" />

      <SidebarSection
        items={SETTINGS_NAV}
        activeLabel={activeLabel}
      />
    </nav>
  );
}

function SidebarSection(
  {
    items,
    activeLabel,
  }: {
    items: NavItem[];
    activeLabel?: string;
  },
) {
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map(
        (item) => {
          const isActive =
            item.label ===
            activeLabel;

          const Icon =
            item.icon;

          const itemClassName =
            cn(
              "flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-1.5 text-left text-sm transition-colors duration-150",
              isActive
                ? "bg-[var(--surface-sunken)] font-medium text-[var(--text-primary)]"
                : "text-[var(--text-secondary)]",
              // 2026-08-31 (P13 live UI review): items with no href were
              // already correctly rendered as `<button disabled>` -- so
              // they were never truly "dead links", and assistive tech
              // announced them as disabled. But they were styled
              // identically to enabled items, so a sighted user had no
              // way to tell that (for example) "Verification" would not
              // respond to a click. Dimming them makes the disabled
              // state visible as well as semantic, which is what WCAG
              // 2.2's own "don't rely on semantics alone for state"
              // guidance is getting at. Found by driving the real
              // production deployment, not by reading this file.
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
                  aria-current={
                    isActive
                      ? "page"
                      : undefined
                  }
                  className={
                    cn(
                      itemClassName,
                      "hover:bg-[var(--surface-sunken)]",
                    )
                  }
                >
                  {content}
                </Link>
              ) : (
                <button
                  type="button"
                  disabled
                  aria-current={
                    isActive
                      ? "page"
                      : undefined
                  }
                  // Names the reason rather than leaving a silently
                  // inert control: a disabled button with no
                  // explanation reads as a bug to a user who cannot see
                  // why it won't respond.
                  title={
                    item.unavailableReason ??
                    `${item.label} is not available yet`
                  }
                  className={itemClassName}
                >
                  {content}

                  <span className="sr-only">
                    {" "}({item.unavailableReason ?? "not available yet"})
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

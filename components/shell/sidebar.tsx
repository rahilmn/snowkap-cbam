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

interface NavItem {
  label: string;
  icon: ComponentType<{ className?: string }>;
  // Real screens are wired one at a time as they're built (§27's
  // screen inventory) -- items without an href stay inert placeholders
  // rather than 404ing.
  href?: string;
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
const IMPORTER_NAV: NavItem[] = [
  { label: "Dashboard", icon: LayoutDashboard },
  { label: "Shipments", icon: Ship, href: "/shipments" },
  { label: "Emissions", icon: BarChart3, href: "/emissions" },
  { label: "Calculations", icon: Calculator },
  { label: "Suppliers", icon: Truck, href: "/suppliers" },
  { label: "Installations", icon: Factory },
  { label: "Audit", icon: ScrollText, href: "/audit" },
  { label: "Reports", icon: FileStack, href: "/reports" },
  { label: "Declarations", icon: FileCheck2, href: "/declarations" },
];

const PRODUCER_NAV: NavItem[] = [
  { label: "Dashboard", icon: LayoutDashboard },
  { label: "Installations", icon: Factory, href: "/installations" },
  { label: "Production data", icon: Package },
  { label: "Emissions", icon: BarChart3, href: "/emission-data" },
  { label: "Evidence", icon: ClipboardCheck },
  { label: "Verification", icon: FileCheck2 },
  { label: "Sharing", icon: Share2, href: "/sharing" },
  { label: "Activity", icon: Activity, href: "/activity" },
];

const SETTINGS_NAV: NavItem[] = [
  { label: "Team", icon: Users, href: "/team" },
  { label: "Organization", icon: Building2, href: "/organization" },
  { label: "Settings", icon: Settings },
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
              !item.href &&
                "disabled:cursor-default",
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
                  className={itemClassName}
                >
                  {content}
                </button>
              )}
            </li>
          );
        },
      )}
    </ul>
  );
}

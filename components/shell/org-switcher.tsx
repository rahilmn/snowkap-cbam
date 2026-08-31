"use client";

import {
  ChevronsUpDown,
} from "lucide-react";

import {
  cn,
} from "../../lib/utils";

import {
  switchOrganizationAction,
} from "./switch-org-action";

export interface OrgSwitcherOption {
  orgId: string;
  organizationName: string;
}

/**
 * A native <select> rather than a popover/menu component -- there is
 * no dropdown/menu primitive in components/ui yet (design-system
 * component work per docs/plans/MASTER_PLAN.md §26 is not this
 * phase's scope), and a <select> is honest, keyboard-navigable, and
 * correct today. Visual polish can replace the control without
 * touching switchOrganizationAction.
 *
 * A single-org user gets the plain (non-interactive) label the
 * Topbar rendered before this existed -- there is nothing to switch
 * to yet.
 */
export function OrgSwitcher(
  {
    currentOrgId,
    organizations,
    // 2026-08-31: this control is `hidden ... sm:block` in the topbar,
    // which meant a phone user could not switch organizations at all.
    // MobileNav renders it inside the drawer and passes a className that
    // re-enables it there; the topbar's own responsive behaviour is
    // unchanged.
    className,
  }: {
    currentOrgId: string;
    organizations: OrgSwitcherOption[];
    className?: string;
  },
) {
  if (organizations.length <= 1) {
    return (
      <button
        type="button"
        disabled
        // 2026-08-29 (P13 audit finding, reproduced live at 768px):
        // with no width cap or truncation, a moderately long org name
        // wrapped to multiple lines inside the fixed h-14 header and
        // spilled into the breadcrumb row underneath. min-w-0 lets
        // this flex child shrink below its content's natural width
        // (required for truncate to do anything in a flex row);
        // max-w-[10rem]/[14rem] cap it before wrap ever triggers.
        className={cn("hidden min-w-0 items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1 text-sm text-[var(--text-secondary)] disabled:cursor-not-allowed sm:flex", className)}
      >
        <span
          className="max-w-[10rem] truncate md:max-w-[14rem]"
          title={organizations[0]?.organizationName ?? ""}
        >
          {organizations[0]?.organizationName ?? ""}
        </span>

        <ChevronsUpDown
          className="size-3.5 shrink-0 text-[var(--text-tertiary)]"
          aria-hidden="true"
        />
      </button>
    );
  }

  return (
    <form action={switchOrganizationAction}>
      <select
        name="orgId"
        defaultValue={currentOrgId}
        onChange={
          (event) =>
            event.target.form?.requestSubmit()
        }
        aria-label="Switch organization"
        // Same 2026-08-29 finding as the single-org button above --
        // the select itself gets the same width cap so a long option
        // label can't force the control (and the row around it) wider
        // than the header has room for.
        className={cn("hidden h-7 max-w-[10rem] rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-transparent px-2 text-sm text-[var(--text-secondary)] sm:block md:max-w-[14rem]", className)}
      >
        {organizations.map(
          (org) => (
            <option
              key={org.orgId}
              value={org.orgId}
            >
              {org.organizationName}
            </option>
          ),
        )}
      </select>
    </form>
  );
}

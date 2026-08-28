"use client";

import {
  ChevronsUpDown,
} from "lucide-react";

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
  }: {
    currentOrgId: string;
    organizations: OrgSwitcherOption[];
  },
) {
  if (organizations.length <= 1) {
    return (
      <button
        type="button"
        disabled
        className="hidden items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1 text-sm text-[var(--text-secondary)] disabled:cursor-not-allowed sm:flex"
      >
        {organizations[0]?.organizationName ?? ""}

        <ChevronsUpDown
          className="size-3.5 text-[var(--text-tertiary)]"
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
        className="hidden h-7 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-transparent px-2 text-sm text-[var(--text-secondary)] sm:block"
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

"use client";

import {
  ArrowLeftRight,
} from "lucide-react";

import {
  cn,
} from "../../lib/utils";

import {
  switchExperienceAction,
} from "./switch-experience-action";

import type {
  Experience,
} from "./sidebar";

/**
 * Only ever rendered for a dual-capability org (the call site decides
 * that, same as OrgSwitcher deciding whether to render a real <select>
 * or a disabled single-org label) -- a single-capability org has
 * nothing to switch to. A native <select> for the same reason
 * OrgSwitcher's own doc comment gives: no dropdown/menu primitive
 * exists yet, and a <select> is honest and keyboard-navigable today.
 */
export function ExperienceSwitcher(
  {
    current,
    className,
  }: {
    current: Experience;
    className?: string;
  },
) {
  return (
    <form
      action={switchExperienceAction}
      className={cn(
        "hidden items-center gap-1 sm:flex",
        className,
      )}
    >
      <ArrowLeftRight
        className="size-3.5 shrink-0 text-[var(--text-tertiary)]"
        aria-hidden="true"
      />

      <select
        name="experience"
        defaultValue={current}
        onChange={
          (event) =>
            event.target.form?.requestSubmit()
        }
        aria-label="Switch experience"
        className="h-7 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-transparent px-2 text-sm text-[var(--text-secondary)]"
      >
        <option value="importer">
          Importer
        </option>

        <option value="producer">
          Producer
        </option>
      </select>
    </form>
  );
}

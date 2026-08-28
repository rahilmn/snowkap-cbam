import type {
  ReactNode,
} from "react";

import {
  Topbar,
} from "./topbar";

import {
  Sidebar,
  type Experience,
} from "./sidebar";

import {
  Breadcrumbs,
  type Breadcrumb,
} from "./breadcrumbs";

import {
  getServerSupabaseClient,
} from "../../src/infrastructure/supabase/server-client";

import {
  getCurrentOrgSummary,
} from "../../src/application/organizations/get-current-org-context";

export interface AppShellProps {
  experience?: Experience;
  activeNavLabel?: string;
  breadcrumbs?: Breadcrumb[];
  inspector?: ReactNode;
  children: ReactNode;
}

/**
 * The application shell every screen (both experiences) renders
 * inside, per docs/plans/MASTER_PLAN.md §26 ("shell = topbar + sidebar
 * + breadcrumbs + optional inspector"). `inspector` is the slot the
 * Resolution Trace inspector (§25's signature element) will occupy
 * from Phase 5 onward -- present as a layout slot now so its
 * introduction later doesn't reflow every screen built against this
 * shell in the meantime.
 *
 * Async: resolves the current org summary once per render so Topbar
 * shows the real signed-in user's organization, not the Phase 2 static
 * placeholder -- every existing call site keeps working unchanged.
 */
export async function AppShell(
  {
    experience,
    activeNavLabel,
    breadcrumbs,
    inspector,
    children,
  }: AppShellProps,
) {
  const supabase =
    await getServerSupabaseClient();

  const orgSummary =
    await getCurrentOrgSummary(
      supabase,
    );

  return (
    <div className="flex h-dvh flex-col bg-[var(--surface-page)]">
      <Topbar
        organizationName={orgSummary?.organizationName ?? null}
      />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          experience={experience}
          activeLabel={activeNavLabel}
        />

        <div className="flex flex-1 flex-col overflow-hidden">
          {breadcrumbs ? (
            <div className="border-b border-[var(--border-default)] px-6 py-3">
              <Breadcrumbs items={breadcrumbs} />
            </div>
          ) : null}

          <main className="flex-1 overflow-auto p-6">
            {children}
          </main>
        </div>

        {inspector ? (
          <aside
            className="w-96 shrink-0 overflow-auto border-l border-[var(--border-default)] bg-[var(--surface-raised)]"
            aria-label="Inspector"
          >
            {inspector}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

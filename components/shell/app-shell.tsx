import type {
  ReactNode,
} from "react";

import {
  Topbar,
} from "./topbar";

import {
  getPreferredOrgId,
} from "./get-preferred-org-id";

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
 * Derives which primary nav set to show from the org's actual
 * capabilities when a screen hasn't explicitly forced one. A
 * producer-only org gets the producer nav; everyone else (importer-
 * only, both capabilities, or no org yet) gets the importer nav --
 * matching the master plan's own release order (§37: "Importer MVP
 * first... Producer MVP is the V1 centerpiece"). A real experience
 * switcher for dual-capability orgs is not yet built; this is a
 * reasonable default until it is, not the final word on that case.
 */
export function deriveExperience(
  capabilities: string[] | undefined,
): Experience {
  const hasProducer =
    capabilities?.includes(
      "PRODUCER_OPERATOR",
    ) ??
    false;

  const hasImporter =
    capabilities?.includes(
      "IMPORTER_DECLARANT",
    ) ??
    false;

  return hasProducer && !hasImporter
    ? "producer"
    : "importer";
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
 * shows the real signed-in user's organization (not the Phase 2 static
 * placeholder) and Sidebar shows the nav for what the org can actually
 * do, not always the importer set -- every existing call site keeps
 * working unchanged. `experience` stays an explicit override: a screen
 * that's inherently one experience or the other can still force it.
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
      await getPreferredOrgId(),
    );

  // Resolved once and shared by Topbar (mobile drawer) and Sidebar
  // (desktop) so the two navigations can never disagree about which
  // experience this org is in.
  const resolvedExperience =
    experience ??
    deriveExperience(
      orgSummary?.context.capabilities,
    );

  return (
    <div className="flex h-dvh flex-col bg-[var(--surface-page)]">
      <Topbar
        experience={resolvedExperience}
        activeNavLabel={activeNavLabel}
        organizationName={orgSummary?.organizationName ?? null}
        currentOrgId={orgSummary?.context.org_id}
        organizations={orgSummary?.availableOrganizations.map(
          (org) => (
            {
              orgId: org.orgId,
              organizationName: org.organizationName,
            }
          ),
        )}
      />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          experience={resolvedExperience}
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

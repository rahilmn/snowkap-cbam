import type {
  ReactNode,
} from "react";

import {
  headers,
} from "next/headers";

import {
  Topbar,
} from "./topbar";

import {
  deriveActiveNavLabel,
} from "./derive-active-nav-label";

import {
  getPreferredOrgId,
} from "./get-preferred-org-id";

import {
  getPreferredExperience,
} from "./get-preferred-experience";

import {
  Sidebar,
  IMPORTER_NAV,
  PRODUCER_NAV,
  SETTINGS_NAV,
  type Experience,
} from "./sidebar";

import {
  SkipLink,
} from "../ui/skip-link";

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

import {
  countMyPendingInvitations,
} from "../../src/application/organizations/invitations";

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
 * SME Experience v2.1.1, S1: the experience switcher for dual-
 * capability orgs `deriveExperience`'s own doc comment named as not
 * yet built. Presentation only -- the cookie can only ever choose
 * between the two layouts a dual-capability org's real capabilities
 * already authorize (see get-preferred-experience.ts's own doc
 * comment); a single-capability org's preference is never consulted,
 * so `deriveExperience`'s existing default still governs it exactly
 * as before.
 */
export function resolveExperience(
  capabilities: string[] | undefined,
  cookiePreference: Experience | undefined,
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

  if (hasProducer && hasImporter && cookiePreference) {
    return cookiePreference;
  }

  return deriveExperience(
    capabilities,
  );
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

  // 2026-09-03 (P14). getCurrentOrgSummary returns null for a signed-OUT
  // visitor and for a signed-in one with no membership, which the shell
  // then rendered identically -- so an invited user who landed anywhere
  // other than /accept-invitation was shown a "Sign in" affordance while
  // already signed in, and had no sign-out control either, because that
  // was gated on having an organization.
  //
  // One getUser() call separates the two states and lets the shell carry
  // a route to the invitation, which otherwise appears in no navigation
  // anywhere in the product.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pendingInvitationCount =
    user
      ? await countMyPendingInvitations(
          supabase,
          user.email ?? "",
        )
      : 0;

  // Resolved once and shared by Topbar (mobile drawer) and Sidebar
  // (desktop) so the two navigations can never disagree about which
  // experience this org is in. An explicit `experience` prop from the
  // call site still wins outright (resolveExperience is never
  // consulted then) -- unchanged from before this cookie existed.
  const resolvedExperience =
    experience ??
    resolveExperience(
      orgSummary?.context.capabilities,
      await getPreferredExperience(),
    );

  const hasDualCapability =
    (orgSummary?.context.capabilities.includes("PRODUCER_OPERATOR") ?? false) &&
    (orgSummary?.context.capabilities.includes("IMPORTER_DECLARANT") ?? false);

  // SME Experience v2.1.1, S1: derived navigation. An explicit
  // `activeNavLabel` prop still wins outright -- as of this comment,
  // kept at exactly one call site whose route doesn't map cleanly onto
  // a nav item (app/onboarding/setup/page.tsx; see that page's own
  // comment on why) -- this only fills in when a screen passes none,
  // using the pathname proxy.ts forwards on every request.
  const resolvedActiveNavLabel =
    activeNavLabel ??
    deriveActiveNavLabel(
      (await headers()).get("x-pathname") ?? "",
      [
        ...(resolvedExperience === "producer" ? PRODUCER_NAV : IMPORTER_NAV),
        ...SETTINGS_NAV,
      ],
    );

  return (
    <div className="flex h-dvh flex-col bg-[var(--surface-page)]">
      <SkipLink />

      <Topbar
        experience={resolvedExperience}
        activeNavLabel={resolvedActiveNavLabel}
        organizationName={orgSummary?.organizationName ?? null}
        isSignedIn={user !== null}
        pendingInvitationCount={pendingInvitationCount}
        currentOrgId={orgSummary?.context.org_id}
        hasDualCapability={hasDualCapability}
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
          activeLabel={resolvedActiveNavLabel}
        />

        <div className="flex flex-1 flex-col overflow-hidden">
          {breadcrumbs ? (
            <div className="border-b border-[var(--border-default)] px-6 py-3">
              <Breadcrumbs items={breadcrumbs} />
            </div>
          ) : null}

          <main
            id="main"
            className="flex-1 overflow-auto p-6"
          >
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

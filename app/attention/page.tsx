import { redirect } from "next/navigation";

import {
  AppShell,
} from "../../components/shell/app-shell";

import {
  GuidanceItemList,
} from "../../components/guidance/guidance-item-list";

import {
  getServerSupabaseClient,
} from "../../src/infrastructure/supabase/server-client";

import {
  getCurrentOrgSummary,
} from "../../src/application/organizations/get-current-org-context";

import {
  getPreferredOrgId,
} from "../../components/shell/get-preferred-org-id";

import {
  deriveAttentionGuidance,
} from "../../src/application/guidance/derive-attention-guidance";

/**
 * SME Experience v2.1.1, S2 remediation (B1, fresh Opus 5 review). The
 * dashboard's own tile (components/guidance/guidance-work-queue.tsx)
 * shows at most DASHBOARD_GUIDANCE_CAP (3) cards -- this is the
 * complete ranked set behind it, uncapped, so a REQUIRED item pushed
 * past that cap is never a silent dead end. The dashboard's own
 * REQUIRED overflow control links here at #required.
 *
 * Calls deriveAttentionGuidance, NOT deriveDashboardGuidance -- the
 * same underlying deriveGuidanceItems both call, so this page and the
 * dashboard tile can never disagree about what's actually true right
 * now ("preserve deterministic guidance semantics").
 */
export default async function AttentionPage() {
  const supabase =
    await getServerSupabaseClient();

  const orgSummary =
    await getCurrentOrgSummary(
      supabase,
      await getPreferredOrgId(),
    );

  if (!orgSummary) {
    redirect(
      "/onboarding",
    );
  }

  const result =
    await deriveAttentionGuidance(
      supabase,
      orgSummary.context,
    );

  return (
    <AppShell
      breadcrumbs={[
        { label: "Needs your attention" },
      ]}
    >
      <h1 className="mb-1 text-2xl font-semibold text-[var(--text-primary)]">
        Needs your attention
      </h1>

      <p className="mb-6 max-w-xl text-sm text-[var(--text-secondary)]">
        The complete list, ranked -- the dashboard shows a compact
        preview of this same list.
      </p>

      {result.status === "UNAVAILABLE" ? (
        <p
          role="alert"
          className="max-w-xl text-sm text-[var(--color-danger-700)]"
        >
          Couldn&apos;t load your guidance right now. Try refreshing the
          page.
        </p>
      ) : result.items.length === 0 ? (
        <p className="text-sm text-[var(--text-tertiary)]">
          Nothing needs your attention right now.
        </p>
      ) : (
        (() => {
          const required =
            result.items.filter(
              (item) => item.priority === "REQUIRED",
            );

          const recommended =
            result.items.filter(
              (item) => item.priority === "RECOMMENDED",
            );

          const optional =
            result.items.filter(
              (item) => item.priority === "OPTIONAL",
            );

          return (
            <div className="flex max-w-2xl flex-col gap-6">
              <section
                id="required"
                aria-label="Required"
              >
                <h2 className="mb-2 text-sm font-medium text-[var(--text-primary)]">
                  Required
                </h2>

                {required.length === 0 ? (
                  <p className="text-sm text-[var(--text-tertiary)]">
                    Nothing required right now.
                  </p>
                ) : (
                  <GuidanceItemList
                    items={required}
                  />
                )}
              </section>

              {recommended.length > 0 ? (
                <section aria-label="Recommended">
                  <h2 className="mb-2 text-sm font-medium text-[var(--text-primary)]">
                    Recommended
                  </h2>

                  <GuidanceItemList
                    items={recommended}
                  />
                </section>
              ) : null}

              {optional.length > 0 ? (
                <section aria-label="Optional">
                  <h2 className="mb-2 text-sm font-medium text-[var(--text-primary)]">
                    Optional
                  </h2>

                  <GuidanceItemList
                    items={optional}
                  />
                </section>
              ) : null}
            </div>
          );
        })()
      )}
    </AppShell>
  );
}

import Link from "next/link";

import { redirect } from "next/navigation";

import {
  AppShell,
  resolveExperience,
} from "../components/shell/app-shell";

import {
  getPreferredExperience,
} from "../components/shell/get-preferred-experience";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";

import {
  getServerSupabaseClient,
} from "../src/infrastructure/supabase/server-client";

import {
  getCurrentOrgSummary,
} from "../src/application/organizations/get-current-org-context";

import {
  listMyPendingInvitations,
} from "../src/application/organizations/invitations";

import {
  getPreferredOrgId,
} from "../components/shell/get-preferred-org-id";

import {
  deriveDashboardGuidance,
} from "../src/application/guidance/derive-dashboard-guidance";

import {
  GuidanceWorkQueue,
} from "../components/guidance/guidance-work-queue";

interface StartingPoint {
  href: string;
  title: string;
  description: string;
  // 2026-09-05 (SME plan v2.1.1, S1). Carries forward a fact that used
  // to live on a disabled sidebar placeholder before the placeholder
  // itself was removed (components/shell/sidebar.tsx no longer lists
  // it): not every plausible-sounding screen exists, and the honest
  // answer for where the thing actually happens belongs somewhere a
  // user can find it, not nowhere.
  note?: string;
}

const IMPORTER_STARTING_POINTS: StartingPoint[] =
  [
    {
      href: "/shipments",
      title: "Shipments",
      description:
        "Record imported goods, classify their CN codes, and resolve embedded emissions for each line.",
      note:
        "There is no separate calculations screen -- every line is calculated in place on its own shipment; open one and use \"Why this number?\" for the full trace.",
    },
    {
      href: "/emissions",
      title: "Emissions",
      description:
        "Review how each line's figure was determined, including actual data shared by producers.",
    },
    {
      href: "/reports",
      title: "Reports",
      description:
        "Summarise a reporting period by CN code, country, route and determination method, and export it.",
    },
    {
      href: "/declarations",
      title: "Declarations",
      description:
        "Aggregate a period into a declaration, check completeness, and record it as filed.",
    },
  ];

const PRODUCER_STARTING_POINTS: StartingPoint[] =
  [
    {
      href: "/installations",
      title: "Installations",
      description:
        "Register the operators and production sites whose emissions you report.",
    },
    {
      href: "/emission-data",
      title: "Emission data",
      description:
        "Record actual emissions per installation and period, attach evidence, and move them through internal review.",
      note:
        "There is no separate production-data screen -- production scope is recorded per emission-data record, as its CN codes and period.",
    },
    {
      href: "/sharing",
      title: "Sharing",
      description:
        "Grant importers read-only access to published, internally reviewed data, and revoke it when the relationship ends.",
    },
  ];

/**
 * The signed-in landing page.
 *
 * 2026-08-31: this was still the literal Phase-2 walking-skeleton
 * placeholder. It showed every real user the text "Application shell
 * walking skeleton (Phase 2). Product screens begin at Phase 4." and
 * offered exactly one action -- a link to the internal /design gallery
 * -- which is how the owner came to be looking at that gallery on the
 * production deployment and ask why it was there.
 *
 * Replaced with capability-aware starting points into the screens that
 * actually exist. Deliberately NOT the dashboard MASTER_PLAN.md §27.8
 * specifies (KPI row, period completeness, emissions by sector/country,
 * action queue, recent activity): that needs real aggregate queries,
 * and inventing plausible-looking numbers on a compliance tool's front
 * page would be far worse than an honest index. The real dashboard
 * remains unbuilt and is recorded as such in the release report.
 */
export default async function HomePage() {
  const supabase =
    await getServerSupabaseClient();

  const orgSummary =
    await getCurrentOrgSummary(
      supabase,
      await getPreferredOrgId(),
    );

  if (!orgSummary) {
    // 2026-09-03 (P14). getCurrentOrgSummary returns null for BOTH a
    // signed-out visitor and a signed-in user with no membership, and
    // this screen used to render the same thing for each -- so an
    // invited user who had already signed in was shown "Sign in ->",
    // with no mention of the invitation waiting for them and no way to
    // reach it. That is the dead end a real invitee fell into on
    // 2026-09-02.
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const pendingInvitations =
        await listMyPendingInvitations(
          supabase,
          user.email ?? "",
        );

      return (
        <AppShell
          breadcrumbs={[
            { label: "Dashboard" },
          ]}
        >
          <h1 className="mb-1 text-2xl font-semibold text-[var(--text-primary)]">
            Snowkap CBAM
          </h1>

          <p className="mb-6 max-w-xl text-sm text-[var(--text-secondary)]">
            You are signed in as {user.email}, but you do not belong to an
            organization yet.
          </p>

          <div className="grid max-w-3xl gap-3 sm:grid-cols-2">
            {pendingInvitations.length > 0 ? (
              <Link
                href="/accept-invitation"
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-raised)] p-4 transition-colors duration-150 hover:border-[var(--border-strong)]"
              >
                <span className="block text-sm font-medium text-[var(--text-primary)]">
                  {pendingInvitations.length === 1
                    ? "You have 1 pending invitation"
                    : `You have ${pendingInvitations.length} pending invitations`}
                </span>

                <span className="mt-1 block text-sm text-[var(--text-secondary)]">
                  Join{" "}
                  {pendingInvitations
                    .map((item) => item.organizationName)
                    .join(", ")}
                  .
                </span>

                <span className="mt-2 block text-sm font-medium text-[var(--accent-interactive)]">
                  Review invitations →
                </span>
              </Link>
            ) : null}

            <Link
              href="/onboarding"
              className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-raised)] p-4 transition-colors duration-150 hover:border-[var(--border-strong)]"
            >
              <span className="block text-sm font-medium text-[var(--text-primary)]">
                Set up a new organization
              </span>

              <span className="mt-1 block text-sm text-[var(--text-secondary)]">
                Create the organization you will import or produce under.
              </span>

              <span className="mt-2 block text-sm font-medium text-[var(--accent-interactive)]">
                Start onboarding →
              </span>
            </Link>
          </div>
        </AppShell>
      );
    }

    // 2026-09-05 (SME plan v2.1.1, S1). Closes the gap the removed
    // comment above this branch used to name: `/` no longer renders
    // the shell to a genuinely signed-out visitor (getCurrentOrgSummary
    // returned null AND there is no session at all) -- it redirects to
    // /sign-in instead, same as every other authenticated screen's own
    // guard (e.g. app/(producer)/emission-data/page.tsx's
    // `if (!orgSummary) redirect("/onboarding")`, and this route's own
    // Server Actions already redirect("/sign-in") when signed out).
    // The signed-in-without-an-org branch above is unchanged -- an
    // invited user is still shown their invitation, never bounced to
    // sign-in.
    redirect(
      "/sign-in",
    );
  }

  // Same resolution AppShell/Topbar/Sidebar use (including the
  // experience-switcher cookie for a dual-capability org), so the
  // starting points below can never disagree with the navigation
  // beside them.
  const experience =
    resolveExperience(
      orgSummary.context.capabilities,
      await getPreferredExperience(),
    );

  const startingPoints =
    experience === "producer"
      ? PRODUCER_STARTING_POINTS
      : IMPORTER_STARTING_POINTS;

  // SME Experience v2.1.1, S2. Not experience-gated: guidance is
  // derived from whatever real state the org actually has (currently
  // only I19, shipment-based -- an importer concept), so a
  // producer-only org simply gets an empty result today, the same
  // GuidanceWorkQueue empty state as any org genuinely caught up.
  const guidance =
    await deriveDashboardGuidance(
      supabase,
      orgSummary.context,
    );

  return (
    <AppShell
      breadcrumbs={[
        { label: "Dashboard" },
      ]}
    >
      <h1 className="mb-1 text-2xl font-semibold text-[var(--text-primary)]">
        {orgSummary.organizationName}
      </h1>

      <p className="mb-6 text-sm text-[var(--text-secondary)]">
        {experience === "producer"
          ? "Record installation emissions, reviewed internally, and share them with the importers who declare your goods."
          : "Classify imported goods, determine their embedded emissions, and prepare CBAM declarations."}
      </p>

      <GuidanceWorkQueue
        result={guidance}
      />

      <div className="grid max-w-4xl gap-4 sm:grid-cols-2">
        {startingPoints.map(
          (point) => (
            <Card
              key={point.href}
            >
              <CardHeader>
                <CardTitle>
                  <Link
                    href={point.href}
                    className="text-[var(--text-primary)] hover:text-[var(--accent-interactive)]"
                  >
                    {point.title}
                  </Link>
                </CardTitle>

                <CardDescription>
                  {point.description}
                </CardDescription>
              </CardHeader>

              <CardContent>
                <Link
                  href={point.href}
                  className="text-sm font-medium text-[var(--accent-interactive)] hover:text-[var(--accent-interactive-hover)]"
                >
                  Open {point.title.toLowerCase()} →
                </Link>

                {point.note ? (
                  <p className="mt-2 text-xs text-[var(--text-tertiary)]">
                    {point.note}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ),
        )}
      </div>

      <p className="mt-6 max-w-4xl text-xs text-[var(--text-tertiary)]">
        There is no separate settings screen -- organization details are
        under Organization, and people are under Team (both reachable
        from the top bar).
      </p>
    </AppShell>
  );
}

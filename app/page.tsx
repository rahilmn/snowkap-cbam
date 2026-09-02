import Link from "next/link";

import {
  AppShell,
  deriveExperience,
} from "../components/shell/app-shell";

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

interface StartingPoint {
  href: string;
  title: string;
  description: string;
}

const IMPORTER_STARTING_POINTS: StartingPoint[] =
  [
    {
      href: "/shipments",
      title: "Shipments",
      description:
        "Record imported goods, classify their CN codes, and resolve embedded emissions for each line.",
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
        "Record actual emissions per installation and period, attach evidence, and move them through verification.",
    },
    {
      href: "/sharing",
      title: "Sharing",
      description:
        "Grant importers read-only access to verified data, and revoke it when the relationship ends.",
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

  // Deliberately does NOT redirect when there is no session.
  //
  // `/` currently renders the application shell to signed-out visitors,
  // because proxy.ts only refreshes the session and never redirects.
  // That is a real, PRE-EXISTING issue -- tests/e2e/shell.spec.ts has
  // seven signed-out cases that navigate here, and
  // importer-auth-smoke.spec.ts's own header comment already tracks it
  // as follow-up ("not merely that the shell renders while signed out").
  //
  // Closing it means requiring auth on this route and re-basing all
  // seven of those specs onto the authenticated fixture, each of which
  // performs a real sign-up. That is its own change with its own risk,
  // and bundling it into a fix for the placeholder content would be a
  // silent scope expansion. It is recorded as an open finding instead of
  // being either half-done or quietly left unmentioned.
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
          activeNavLabel="Dashboard"
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

    return (
      <AppShell
        breadcrumbs={[
          { label: "Dashboard" },
        ]}
        activeNavLabel="Dashboard"
      >
        <h1 className="mb-1 text-2xl font-semibold text-[var(--text-primary)]">
          Snowkap CBAM
        </h1>

        <p className="mb-6 max-w-xl text-sm text-[var(--text-secondary)]">
          Sign in to classify imported goods, determine their embedded
          emissions, and prepare CBAM declarations.
        </p>

        <Link
          href="/sign-in"
          className="text-sm font-medium text-[var(--accent-interactive)] hover:text-[var(--accent-interactive-hover)]"
        >
          Sign in →
        </Link>
      </AppShell>
    );
  }

  // Same derivation the sidebar uses, so the starting points below can
  // never disagree with the navigation beside them.
  const experience =
    deriveExperience(
      orgSummary.context.capabilities,
    );

  const startingPoints =
    experience === "producer"
      ? PRODUCER_STARTING_POINTS
      : IMPORTER_STARTING_POINTS;

  return (
    <AppShell
      breadcrumbs={[
        { label: "Dashboard" },
      ]}
      activeNavLabel="Dashboard"
    >
      <h1 className="mb-1 text-2xl font-semibold text-[var(--text-primary)]">
        {orgSummary.organizationName}
      </h1>

      <p className="mb-6 text-sm text-[var(--text-secondary)]">
        {experience === "producer"
          ? "Record verified installation emissions and share them with the importers who declare your goods."
          : "Classify imported goods, determine their embedded emissions, and prepare CBAM declarations."}
      </p>

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
              </CardContent>
            </Card>
          ),
        )}
      </div>
    </AppShell>
  );
}

import { redirect } from "next/navigation";

import {
  Wordmark,
} from "../../components/shell/wordmark";

import {
  getServerSupabaseClient,
} from "../../src/infrastructure/supabase/server-client";

import {
  listMyPendingInvitations,
} from "../../src/application/organizations/invitations";

import {
  Card,
} from "../../components/ui/card";

import Link from "next/link";

import {
  OnboardingForm,
} from "./onboarding-form";

export default async function OnboardingPage() {
  const supabase =
    await getServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  // Master plan §27 screen 2: onboarding is for "first user; authed
  // w/o org" -- a user who already belongs to an organization has
  // nothing to do here.
  const { data: existingMemberships } =
    await supabase
      .from("memberships")
      .select("org_id")
      .limit(1);

  if (existingMemberships && existingMemberships.length > 0) {
    redirect("/");
  }

  // 2026-09-03 (P14). This screen is where a signed-in user without an
  // organization is sent, which is exactly the state an invited user is
  // in before they accept -- and it said nothing at all about the
  // invitation waiting for them, so the only visible way forward was to
  // create a SECOND organization alongside the one that had invited
  // them.
  const pendingInvitations =
    await listMyPendingInvitations(
      supabase,
      user.email ?? "",
    );

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-[var(--surface-page)] p-6">
      <Wordmark className="text-lg" />

      <div className="flex w-full max-w-md flex-col gap-2 text-center">
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">
          Set up your organization
        </h1>

        <p className="text-sm text-[var(--text-secondary)]">
          You&apos;ll be its first owner.
        </p>
      </div>

      {pendingInvitations.length > 0 ? (
        <Card className="w-full max-w-md p-4">
          <p className="text-sm text-[var(--text-primary)]">
            {pendingInvitations.length === 1
              ? "You have 1 pending invitation to join an existing organization."
              : `You have ${pendingInvitations.length} pending invitations to join existing organizations.`}
          </p>

          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            You do not need to create a new organization to accept one.
          </p>

          <Link
            href="/accept-invitation"
            className="mt-2 inline-block text-sm font-medium text-[var(--accent-interactive)] hover:text-[var(--accent-interactive-hover)]"
          >
            Review invitations →
          </Link>
        </Card>
      ) : null}

      <OnboardingForm />
    </div>
  );
}

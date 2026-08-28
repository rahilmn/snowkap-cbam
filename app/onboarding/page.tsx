import { redirect } from "next/navigation";

import {
  Wordmark,
} from "../../components/shell/wordmark";

import {
  getServerSupabaseClient,
} from "../../src/infrastructure/supabase/server-client";

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

      <OnboardingForm />
    </div>
  );
}

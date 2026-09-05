import { redirect } from "next/navigation";

import {
  AppShell,
} from "../../components/shell/app-shell";

import {
  Card,
} from "../../components/ui/card";

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
  FeedbackForm,
} from "./feedback-form";

/**
 * SME Experience v2.1.1, S2. `from` carries the page the feedback
 * trigger was clicked on (components/shell/feedback-trigger.tsx
 * captures its own current pathname at click time) -- product_feedback
 * itself only ever records what this route actually received, never
 * guesses.
 */
export default async function FeedbackPage(
  {
    searchParams,
  }: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const params =
    await searchParams;

  const fromParam =
    params.from;

  const page =
    typeof fromParam === "string" && fromParam.length > 0
      ? fromParam
      : "/feedback";

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

  return (
    <AppShell
      breadcrumbs={[
        { label: "Feedback" },
      ]}
    >
      <h1 className="mb-1 text-2xl font-semibold text-[var(--text-primary)]">
        Send feedback
      </h1>

      <p className="mb-6 max-w-md text-sm text-[var(--text-secondary)]">
        Tell us what's working and what isn't. This goes straight to the
        team building Snowkap CBAM.
      </p>

      <Card className="max-w-md p-4">
        <FeedbackForm
          page={page}
        />
      </Card>
    </AppShell>
  );
}

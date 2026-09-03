import { redirect } from "next/navigation";

import {
  AppShell,
} from "../../../components/shell/app-shell";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";

import {
  getServerSupabaseClient,
} from "../../../src/infrastructure/supabase/server-client";

import {
  ChangePasswordForm,
} from "./change-password-form";

export const metadata = {
  title: "Change password",
};

/**
 * 2026-09-04 (P14, AUTH-1). The authenticated change-password screen.
 *
 * Gated on being SIGNED IN, not on having an organization -- an invited
 * user who has not accepted yet is exactly the person most likely to
 * want to set a password they chose, and /status's redirect-to-
 * onboarding shape would lock them out of it.
 *
 * Distinct from /reset-password on purpose. That screen is credential
 * RECOVERY, reachable only through an emailed link, for someone who
 * cannot supply a current password. This one is a privileged action by
 * someone who can, and it makes them.
 */
export default async function ChangePasswordPage(
  {
    searchParams,
  }: {
    searchParams: Promise<{
      changed?: string | string[];
      others?: string | string[];
    }>;
  },
) {
  const supabase =
    await getServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      "/sign-in",
    );
  }

  const params =
    await searchParams;

  const first =
    (value: string | string[] | undefined) =>
      Array.isArray(value)
        ? value[0]
        : value;

  const changed =
    first(params.changed) === "1";

  const othersFailed =
    first(params.others) === "failed";

  return (
    <AppShell
      breadcrumbs={[
        { label: "Change password" },
      ]}
    >
      <div className="mb-4 flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
          Change password
        </h1>

        <p className="max-w-2xl text-sm text-[var(--text-secondary)]">
          Signed in as {user.email}. Changing a password requires the
          current one, every time -- a signed-in browser is not by itself
          proof that it is you.
        </p>
      </div>

      {changed ? (
        <div
          role="status"
          className="mb-4 max-w-sm rounded-md border border-[var(--color-success-300)] bg-[var(--color-success-100)] px-3 py-2 text-sm text-[var(--color-success-700)]"
        >
          <p className="font-medium">
            Your password has been changed.
          </p>

          {othersFailed ? (
            <p className="mt-1">
              Other signed-in sessions could not be signed out
              automatically. Your new password is in effect; if you are
              concerned about another device, sign in there and sign out
              again.
            </p>
          ) : (
            <p className="mt-1">
              Every other signed-in session has been signed out. This one
              is still active.
            </p>
          )}
        </div>
      ) : null}

      <Card className="max-w-sm">
        <CardHeader>
          <CardTitle className="text-base">
            Set a new password
          </CardTitle>

          <CardDescription>
            Enter your current password, then choose a new one.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </AppShell>
  );
}

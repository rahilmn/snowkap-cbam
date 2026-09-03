import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";

import Link from "next/link";

import {
  isSafeRedirectPath,
} from "../../auth/callback/is-safe-redirect-path";

import {
  sessionWasEstablishedByEmailLink,
} from "../../auth/session-assurance";

import {
  getServerSupabaseClient,
} from "../../../src/infrastructure/supabase/server-client";

import {
  ResetPasswordForm,
} from "./reset-password-form";

/**
 * Also the "choose your first password" screen for an invited user.
 * /auth/confirm routes an `invite` link here with
 * ?next=/accept-invitation, because GoTrue's invite verification confirms
 * the account without the invitee ever choosing a password -- so an
 * invitee who went straight to accepting would hold a working session now
 * and have no way back in later. One real invited user is in exactly that
 * state today.
 */
export default async function ResetPasswordPage(
  {
    searchParams,
  }: {
    searchParams: Promise<{ next?: string | string[] }>;
  },
) {
  const params =
    await searchParams;

  const requestedNext =
    Array.isArray(params.next)
      ? params.next[0]
      : params.next;

  const next =
    requestedNext && isSafeRedirectPath(requestedNext)
      ? requestedNext
      : null;

  const isFirstPassword =
    next === "/accept-invitation";

  // 2026-09-04 (P14, AUTH-1). The action is the boundary -- see
  // actions.ts -- but a screen that offers a password form to someone
  // it is going to refuse is its own small defect: it invites the
  // legitimate user to type a new password twice and then tells them
  // no. Ask the same question here and say so up front instead.
  const supabase =
    await getServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const {
    data: claimsData,
  } = await supabase.auth.getClaims();

  const establishedByEmailLink =
    sessionWasEstablishedByEmailLink(
      claimsData?.claims,
    );

  if (user && !establishedByEmailLink) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-base">
            This screen needs an emailed link
          </CardTitle>

          <CardDescription>
            You are already signed in, and setting a password here is
            only for people who cannot supply their current one --
            password recovery, or accepting an invitation.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-3 text-sm text-[var(--text-secondary)]">
          <p>
            To change a password you already know, use{" "}
            <Link
              href="/account/password"
              className="font-medium text-[var(--color-brand-700)] underline underline-offset-2"
            >
              Change password
            </Link>
            , which asks for your current password first.
          </p>

          <p>
            If you have forgotten it, request a{" "}
            <Link
              href="/forgot-password"
              className="font-medium text-[var(--color-brand-700)] underline underline-offset-2"
            >
              password-reset email
            </Link>{" "}
            and follow the link in it.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-base">
          {isFirstPassword
            ? "Set a password for your new account"
            : "Set a new password"}
        </CardTitle>

        <CardDescription>
          {isFirstPassword
            ? "You will use this to sign in from now on. Once it is set we will take you to your invitation."
            : "Choose a new password for your account."}
        </CardDescription>
      </CardHeader>

      <CardContent>
        <ResetPasswordForm next={next} />
      </CardContent>
    </Card>
  );
}

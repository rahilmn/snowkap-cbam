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
  SignInForm,
} from "./sign-in-form";

/**
 * 2026-09-03 (P14, F1). Tells the user when a sign-out could not be
 * confirmed with the authentication service.
 *
 * signOutAction clears this browser's session cookies directly when
 * signOut() fails, so the user IS signed out here -- but the
 * server-side refresh token may not have been revoked, which matters on
 * a shared machine.
 *
 * The notice is gated on there genuinely being no session, not on the
 * query parameter alone. Anyone can type `?signed_out=unconfirmed`, and
 * a security warning that renders on demand, on the real origin, above
 * a password field, is a ready-made phishing line. Checking the actual
 * state means the message can only appear when it is true.
 */
export default async function SignInPage(
  {
    searchParams,
  }: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const params =
    await searchParams;

  const claimsUnconfirmedSignOut =
    params.signed_out === "unconfirmed";

  let showUnconfirmedSignOut =
    false;

  if (claimsUnconfirmedSignOut) {
    const supabase =
      await getServerSupabaseClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    showUnconfirmedSignOut =
      user === null;
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-base">
          Sign in
        </CardTitle>

        <CardDescription>
          Sign in to your Snowkap CBAM account.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {showUnconfirmedSignOut ? (
          <div
            role="alert"
            className="rounded-[var(--radius-sm)] bg-[var(--color-warning-100)] px-3 py-2 text-xs text-[var(--color-warning-700)]"
          >
            You were signed out of this browser, but the sign-out could
            not be confirmed with the authentication service. If this is
            a shared device, sign in and sign out again.
          </div>
        ) : null}

        <SignInForm />
      </CardContent>
    </Card>
  );
}

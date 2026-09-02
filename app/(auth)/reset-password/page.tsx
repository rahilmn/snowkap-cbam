import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";

import {
  isSafeRedirectPath,
} from "../../auth/callback/is-safe-redirect-path";

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

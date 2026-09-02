import type {
  Metadata,
} from "next";

import {
  Wordmark,
} from "../../../components/shell/wordmark";

import {
  Card,
} from "../../../components/ui/card";

import {
  getServerSupabaseClient,
} from "../../../src/infrastructure/supabase/server-client";

import {
  AuthLinkErrorPanel,
} from "../auth-link-error-panel";

import {
  describeAuthLinkError,
} from "../auth-link-errors";

import {
  ConfirmLinkForm,
} from "./confirm-link-form";

import {
  parseConfirmLink,
  type ConfirmableType,
} from "./parse-confirm-link";

/**
 * The landing page for every transactional auth email this product
 * sends, replacing the old shape where the emailed link pointed straight
 * at GoTrue's /auth/v1/verify endpoint.
 *
 * THE PROBLEM IT SOLVES. GoTrue's verify endpoint consumes the
 * single-use token on GET. Anything that opens the link -- a corporate
 * mail-security scanner, a link preview, a prefetch -- therefore burns it
 * before the recipient ever clicks. That is not hypothetical: on
 * 2026-09-02 a real invitee's token was consumed 76 seconds after
 * delivery by a Chromium client from a Microsoft Azure address, and the
 * human's own click landed on "This link is invalid or has expired." with
 * no way forward. Their organization invitation was valid the whole time.
 *
 * So the emailed link now points here and carries a token_hash, this page
 * renders inert on GET, and the token is exchanged only by the Server
 * Action behind an explicit Continue press. Prefetching this page
 * accomplishes nothing.
 *
 * `noindex` because the URL carries a single-use credential; the global
 * Referrer-Policy (next.config.ts) already prevents it leaking
 * cross-origin in a Referer header.
 */
export const metadata: Metadata =
  {
    title: "Continue",
    robots: {
      index: false,
      follow: false,
    },
  };

const INTRO_BY_TYPE: Record<ConfirmableType, string> =
  {
    invite:
      "You have been invited to join an organization on Snowkap CBAM. " +
      "Select Continue to accept the invitation and choose a password.",

    signup:
      "Select Continue to confirm your email address and finish creating " +
      "your account.",

    recovery:
      "Select Continue to open the password reset form.",

    magiclink:
      "Select Continue to sign in.",

    email:
      "Select Continue to sign in.",

    email_change:
      "Select Continue to confirm your new email address.",
  };

export default async function AuthConfirmPage(
  {
    searchParams,
  }: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const params =
    await searchParams;

  const parsed =
    parseConfirmLink(
      params,
    );

  // Read-only. Establishes whether this browser already holds a session,
  // so the page can warn before an identity switch rather than after it.
  const supabase =
    await getServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-[var(--surface-page)] p-6">
      <Wordmark className="text-lg" />

      <Card className="w-full max-w-md p-6">
        {parsed.status === "INVALID" ? (
          <AuthLinkErrorPanel
            copy={
              {
                title: "This link is incomplete",
                body:
                  "It looks like part of the address was cut off, which " +
                  "some email clients do to long links. Open the link " +
                  "again from the original message, or use one of the " +
                  "options below.",
                ctas: [
                  { label: "Sign in", href: "/sign-in" },
                  { label: "Set a password", href: "/forgot-password" },
                ],
              }
            }
          />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <h1 className="text-lg font-semibold text-[var(--text-primary)]">
                Continue to Snowkap CBAM
              </h1>

              <p className="text-sm text-[var(--text-secondary)]">
                {INTRO_BY_TYPE[parsed.type]}
              </p>

              {user ? (
                // Never a silent identity switch. A link for a different
                // account, opened in a browser that is already signed in,
                // is otherwise indistinguishable to the user until their
                // data lands in the wrong organization.
                <p className="rounded-[var(--radius-sm)] bg-[var(--surface-sunken)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                  You are currently signed in as{" "}
                  <span className="font-medium text-[var(--text-primary)]">
                    {user.email}
                  </span>
                  . Continuing will sign you out of this browser and sign
                  you in as the account this link was sent to.
                </p>
              ) : null}
            </div>

            <ConfirmLinkForm
              tokenHash={parsed.tokenHash}
              type={parsed.type}
              next={parsed.next}
            />

            <p className="text-xs text-[var(--text-tertiary)]">
              This link can only be used once. Nothing happens until you
              select Continue.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}

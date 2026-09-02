"use client";

import {
  Suspense,
  useEffect,
  useState,
} from "react";

import {
  useRouter,
  useSearchParams,
} from "next/navigation";

import {
  establishSessionAction,
  exchangeCodeForSessionAction,
} from "./actions";

import {
  isSafeRedirectPath,
} from "./is-safe-redirect-path";

import {
  parseAuthLinkError,
} from "./parse-auth-link-error";

import {
  describeAuthLinkError,
  toAuthLinkKind,
  type AuthLinkErrorCopy,
} from "../auth-link-errors";

import {
  AuthLinkErrorPanel,
} from "../auth-link-error-panel";

import {
  Wordmark,
} from "../../../components/shell/wordmark";

import {
  Card,
} from "../../../components/ui/card";

/**
 * Landing target for Supabase Auth email links (invite, magic link,
 * password reset). Two distinct delivery shapes reach here, confirmed
 * by inspecting real emails captured by local Mailpit:
 *
 *   1. An implicit-flow HASH FRAGMENT
 *      (#access_token=...&refresh_token=...&type=...) --
 *      admin.inviteUserByEmail()'s own links (Team screen invites):
 *      the token is generated entirely server-side, with no browser-
 *      originated PKCE code_verifier to exchange, so GoTrue's
 *      /auth/v1/verify redirects here with the session already in the
 *      fragment. Hash fragments are never sent to the server, so
 *      reading them requires this to be a client component.
 *
 *   2. A PKCE QUERY PARAM (?code=...) -- resetPasswordForEmail()'s own
 *      links (app/(auth)/forgot-password/actions.ts), which
 *      @supabase/ssr uses PKCE flow for by default. Unlike a hash
 *      fragment, a query param IS sent to the server, but it still
 *      needs exchanging for a session via exchangeCodeForSessionAction
 *      (P13 release-blocker remediation, finding S4, live-confirmed:
 *      the original implementation only handled shape 1 and rejected
 *      every real password-reset link as "invalid or expired").
 *
 * Either way, the session itself is established by a Server Action on
 * the SERVER client, never a client-side setSession()/
 * exchangeCodeForSession() call -- see establishSessionAction's own
 * doc comment for why (P13 adversarial audit: a client-side
 * setSession() silently fails to update an existing httpOnly session
 * cookie).
 */
export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={null}
    >
      <AuthCallback />
    </Suspense>
  );
}

function AuthCallback() {
  const router =
    useRouter();

  const searchParams =
    useSearchParams();

  const [
    errorCopy,
    setErrorCopy,
  ] =
    useState<AuthLinkErrorCopy | null>(
      null,
    );

  useEffect(
    () => {
      // 2026-09-03 (P14). GoTrue reports a failed verification by
      // redirecting BACK here with the failure in the URL -- in the hash
      // fragment always, and additionally in the query string for a
      // PKCE-flow token. Nothing here read those parameters until now,
      // so a spent invitation link, a rate limit and a PKCE mismatch all
      // rendered the same sentence with no next step.
      //
      // Checked FIRST: when GoTrue has told us why it failed, there is
      // no session material in the URL to try, and attempting one would
      // only replace a precise explanation with a generic one.
      const linkError =
        parseAuthLinkError(
          window.location.hash,
          window.location.search,
        );

      if (linkError) {
        setErrorCopy(
          describeAuthLinkError(
            {
              code: linkError.code,
              kind: toAuthLinkKind(
                linkError.type ??
                  new URLSearchParams(
                    window.location.hash.replace(/^#/, ""),
                  ).get("type"),
              ),
              pkceCodeShape:
                Boolean(
                  searchParams.get("code"),
                ),
            },
          ),
        );

        return;
      }

      const requestedNext =
        searchParams.get(
          "next",
        );

      // 2026-08-29 (P13 audit finding): never trust `next` past a
      // same-origin-path check -- see is-safe-redirect-path.ts's own
      // doc comment for the open-redirect + session-fixation chain
      // this closes. An unsafe value falls back to the same default an
      // absent one already did, rather than being rejected as an error
      // -- the caller gets signed in either way, just not sent
      // somewhere attacker-controlled.
      const next =
        requestedNext && isSafeRedirectPath(requestedNext)
          ? requestedNext
          : "/accept-invitation";

      // Shape 2 (PKCE `?code=`, see this file's own header comment) --
      // checked first since it is a query param, cheaper and more
      // direct to read than parsing the hash fragment, and the two
      // shapes are mutually exclusive in practice (GoTrue never
      // produces both for the same link).
      const code =
        searchParams.get(
          "code",
        );

      const sessionPromise =
        code
          ? exchangeCodeForSessionAction(
              code,
            )
          : (() => {
              const hashParams =
                new URLSearchParams(
                  window.location.hash.replace(
                    /^#/,
                    "",
                  ),
                );

              const accessToken =
                hashParams.get(
                  "access_token",
                );

              const refreshToken =
                hashParams.get(
                  "refresh_token",
                );

              if (!accessToken || !refreshToken) {
                return null;
              }

              return establishSessionAction(
                accessToken,
                refreshToken,
              );
            })();

      const kind =
        toAuthLinkKind(
          searchParams.get("type") ??
            new URLSearchParams(
              window.location.hash.replace(/^#/, ""),
            ).get("type"),
        );

      const pkceCodeShape =
        Boolean(code);

      if (!sessionPromise) {
        setErrorCopy(
          describeAuthLinkError(
            { code: null, kind, pkceCodeShape },
          ),
        );

        return;
      }

      sessionPromise
        .then(
          (result) => {
            if (result.status === "error") {
              setErrorCopy(
                describeAuthLinkError(
                  { code: result.code, kind, pkceCodeShape },
                ),
              );

              return;
            }

            router.replace(
              next,
            );
          },
        )
        .catch(
          () => {
            setErrorCopy(
              describeAuthLinkError(
                { code: null, kind, pkceCodeShape },
              ),
            );
          },
        );
    },
    [router, searchParams],
  );

  if (errorCopy) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-[var(--surface-page)] p-6">
        <Wordmark className="text-lg" />

        <Card className="w-full max-w-md p-6">
          <AuthLinkErrorPanel copy={errorCopy} />
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[var(--surface-page)] p-6">
      <p className="text-sm text-[var(--text-secondary)]">
        Signing you in…
      </p>
    </div>
  );
}

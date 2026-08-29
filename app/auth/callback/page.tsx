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
  getBrowserSupabaseClient,
} from "../../../src/infrastructure/supabase/browser-client";

import {
  isSafeRedirectPath,
} from "./is-safe-redirect-path";

/**
 * Landing target for Supabase Auth email links (invite, magic link,
 * password reset) that deliver a session via an implicit-flow hash
 * fragment (#access_token=...&refresh_token=...&type=...) rather than
 * a server-verifiable ?token_hash= query param.
 *
 * This is the ONLY shape that actually applies to the Team screen's
 * invite flow: admin.inviteUserByEmail() generates the token entirely
 * server-side (there is no browser-originated PKCE code_verifier to
 * exchange), so GoTrue's own /auth/v1/verify redirects here with the
 * session in the URL fragment -- confirmed by inspecting the real
 * email captured by local Mailpit. Hash fragments are never sent to
 * the server, so this must be a client component: a Server Component
 * at this URL would never see the tokens at all.
 *
 * setSession() writes the session into cookies via the browser
 * client's @supabase/ssr cookie adapter, so the subsequent navigation
 * to `next` is a normal authenticated server-rendered request.
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
    error,
    setError,
  ] =
    useState<string | null>(
      null,
    );

  useEffect(
    () => {
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

      if (!accessToken || !refreshToken) {
        setError(
          "This link is invalid or has expired.",
        );

        return;
      }

      getBrowserSupabaseClient()
        .auth.setSession(
          {
            access_token: accessToken,
            refresh_token: refreshToken,
          },
        )
        .then(
          ({ error: setSessionError }) => {
            if (setSessionError) {
              setError(
                "This link is invalid or has expired.",
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
            setError(
              "This link is invalid or has expired.",
            );
          },
        );
    },
    [router, searchParams],
  );

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[var(--surface-page)] p-6">
      <p className="text-sm text-[var(--text-secondary)]">
        {error ?? "Signing you in…"}
      </p>
    </div>
  );
}

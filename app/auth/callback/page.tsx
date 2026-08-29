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
} from "./actions";

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
 * The tokens are read here (client-side, since only the browser can
 * see the hash fragment) but the session itself is established by
 * establishSessionAction on the SERVER client, not a client-side
 * setSession() call -- see that action's own doc comment for why
 * (P13 adversarial audit: a client-side setSession() silently fails to
 * update an existing httpOnly session cookie).
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

      establishSessionAction(
        accessToken,
        refreshToken,
      )
        .then(
          (result) => {
            if (result.status === "error") {
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

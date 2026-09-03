"use client";

import {
  Suspense,
  useCallback,
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

import {
  Button,
} from "../../../components/ui/button";

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
/**
 * 2026-09-04 (P14 owner decision 4). What the URL offered, held in
 * memory after being taken out of the URL. Deliberately not rendered:
 * the confirmation screen says what kind of link this is and what
 * continuing does, and never shows the credential itself.
 */
type PendingAdoption =
  | {
      shape: "code";
      code: string;
      kind: ReturnType<typeof toAuthLinkKind>;
      next: string;
    }
  | {
      shape: "tokens";
      accessToken: string;
      refreshToken: string;
      kind: ReturnType<typeof toAuthLinkKind>;
      next: string;
    };

function headingFor(
  kind: ReturnType<typeof toAuthLinkKind>,
): string {
  switch (kind) {
    case "invite":
      return "Accept your invitation";

    case "recovery":
      return "Reset your password";

    case "signup":
      return "Confirm your email address";

    default:
      return "Sign in to Snowkap CBAM";
  }
}

function descriptionFor(
  kind: ReturnType<typeof toAuthLinkKind>,
): string {
  const common =
    "Selecting Continue will sign you in on this browser. If you are " +
    "already signed in as someone else, you will be signed out of that " +
    "account here.";

  switch (kind) {
    case "invite":
      return "You have been invited to an organization on Snowkap CBAM. " + common;

    case "recovery":
      return "You asked to reset your password. " + common +
        " You will then be able to set a new one.";

    case "signup":
      return "This link confirms the email address you signed up with. " + common;

    default:
      return common;
  }
}

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

  /**
   * What the URL offered, once it has been read and taken OUT of the
   * URL. Never rendered, never logged, never put in a query string.
   */
  const [
    pending,
    setPending,
  ] =
    useState<PendingAdoption | null>(
      null,
    );

  const [
    adopting,
    setAdopting,
  ] =
    useState(false);

  /**
   * 2026-09-04 (P14 owner decision 4). This effect used to ADOPT the
   * session: it read access_token/refresh_token out of
   * window.location.hash on page load and called setSession(), with no
   * click and no identity shown. Anyone who could get a victim to open
   * a link signed that victim into the ATTACKER'S account, and the
   * victim then entered shipments, emission data and evidence into the
   * attacker's organisation.
   *
   * It now only READS. Nothing is established until the person says so,
   * which is what makes a GET, a prefetch, a link scanner or a browser
   * preload harmless here -- none of them can click.
   *
   * The material is lifted out of the URL as it is captured: the hash is
   * stripped from the address bar immediately, so the credential does
   * not sit in browser history, in the address bar, or in anything a
   * later navigation might carry.
   */
  useEffect(
    () => {
      const hash =
        window.location.hash;

      const search =
        window.location.search;

      // 2026-09-03 (P14). GoTrue reports a failed verification by
      // redirecting BACK here with the failure in the URL -- in the hash
      // fragment always, and additionally in the query string for a
      // PKCE-flow token. Checked FIRST: when GoTrue has told us why it
      // failed there is no session material to offer, and trying one
      // would replace a precise explanation with a generic one.
      const linkError =
        parseAuthLinkError(
          hash,
          search,
        );

      const hashParams =
        new URLSearchParams(
          hash.replace(/^#/, ""),
        );

      const kind =
        toAuthLinkKind(
          searchParams.get("type") ??
            hashParams.get("type"),
        );

      if (linkError) {
        setErrorCopy(
          describeAuthLinkError(
            {
              code: linkError.code,
              kind: toAuthLinkKind(
                linkError.type ?? hashParams.get("type"),
              ),
              pkceCodeShape:
                Boolean(searchParams.get("code")),
            },
          ),
        );

        return;
      }

      // 2026-08-29 (P13 audit finding): never trust `next` past a
      // same-origin-path check -- see is-safe-redirect-path.ts's own
      // doc comment for the open-redirect + session-fixation chain this
      // closes.
      const requestedNext =
        searchParams.get("next");

      const next =
        requestedNext && isSafeRedirectPath(requestedNext)
          ? requestedNext
          : "/accept-invitation";

      const code =
        searchParams.get("code");

      const accessToken =
        hashParams.get("access_token");

      const refreshToken =
        hashParams.get("refresh_token");

      if (!code && (!accessToken || !refreshToken)) {
        setErrorCopy(
          describeAuthLinkError(
            { code: null, kind, pkceCodeShape: false },
          ),
        );

        return;
      }

      setPending(
        code
          ? { shape: "code", code, kind, next }
          : {
              shape: "tokens",
              accessToken: accessToken as string,
              refreshToken: refreshToken as string,
              kind,
              next,
            },
      );

      // Out of the URL. The tokens live in component state for exactly
      // as long as this page is open, and nowhere a later request, a
      // shared screenshot or a browser history entry can pick them up.
      if (hash) {
        window.history.replaceState(
          null,
          "",
          window.location.pathname + search,
        );
      }
    },
    [searchParams],
  );

  const adopt =
    useCallback(
      async () => {
        if (!pending || adopting) {
          return;
        }

        setAdopting(true);

        const pkceCodeShape =
          pending.shape === "code";

        try {
          const result =
            pending.shape === "code"
              ? await exchangeCodeForSessionAction(pending.code)
              : await establishSessionAction(
                  pending.accessToken,
                  pending.refreshToken,
                );

          if (result.status === "error") {
            setErrorCopy(
              describeAuthLinkError(
                {
                  code: result.code,
                  kind: pending.kind,
                  pkceCodeShape,
                },
              ),
            );

            setPending(null);

            return;
          }

          router.replace(pending.next);
        } catch {
          setErrorCopy(
            describeAuthLinkError(
              { code: null, kind: pending.kind, pkceCodeShape },
            ),
          );

          setPending(null);
        } finally {
          setAdopting(false);
        }
      },
      [adopting, pending, router],
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

  if (!pending) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[var(--surface-page)] p-6">
        <p className="text-sm text-[var(--text-secondary)]">
          Checking your link…
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-[var(--surface-page)] p-6">
      <Wordmark className="text-lg" />

      <Card className="w-full max-w-md p-6">
        <div className="flex flex-col gap-4">
          <h1 className="text-base font-semibold text-[var(--text-primary)]">
            {headingFor(pending.kind)}
          </h1>

          <p className="text-sm text-[var(--text-secondary)]">
            {descriptionFor(pending.kind)}
          </p>

          <p className="text-sm text-[var(--text-secondary)]">
            If you did not request this, close this page. Nothing has
            happened yet, and nothing will until you select Continue.
          </p>

          <Button
            type="button"
            onClick={adopt}
            loading={adopting}
          >
            Continue
          </Button>
        </div>
      </Card>
    </div>
  );
}

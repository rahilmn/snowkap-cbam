import "server-only";

import {
  loadAppSession,
  persistAppSession,
  revokeAppSession,
  type ProviderCookie,
} from "./app-session-store";

/**
 * The seam (P14, AUTH-1).
 *
 * `createServerClient` reaches the browser through one narrow
 * interface -- `{ getAll, setAll }` -- and nothing in @supabase/ssr
 * requires those to be actual cookies. This implements that interface
 * against the server-side session store instead, so the library goes on
 * working exactly as before while the bytes it thinks it is putting in
 * a cookie never leave the server.
 *
 * What the browser holds afterwards:
 *
 *   sb_app_session   an opaque 32-byte random identifier
 *
 * What it no longer holds:
 *
 *   sb-<ref>-auth-token   the provider session, i.e. the access and
 *                         refresh tokens Supabase Auth accepts
 *
 * Deliberately routed: ONLY the auth-token family. @supabase/ssr also
 * writes a PKCE `...-auth-token-code-verifier` cookie during password
 * recovery, and that one stays in the browser. It is not a bearer
 * credential -- it is useless without the one-time `code` that arrives
 * in the user's own email -- and moving it would mean minting a session
 * row for visitors who are not signed in. Keeping the change to the
 * credential that was actually exploitable keeps the blast radius
 * small.
 */

export const APP_SESSION_COOKIE = "sb_app_session";

/**
 * The storage key @supabase/ssr derives from the project URL, which is
 * the cookie family this adapter intercepts. Derived rather than
 * hardcoded so it cannot drift from the project the deployment points
 * at -- same derivation app/(auth)/actions.ts already uses.
 */
export function providerStorageKey(): string {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

  const projectRef =
    /^https?:\/\/([^./:]+)/.exec(url)?.[1] ?? "";

  return `sb-${projectRef}-auth-token`;
}

/**
 * The auth-token cookie and its chunks (`<key>`, `<key>.0`, ...), but
 * NOT `<key>-code-verifier`, which is a different cookie with a
 * different lifetime and is left in the browser.
 */
export function isProviderSessionCookie(
  name: string,
  storageKey: string,
): boolean {
  return (
    name === storageKey ||
    new RegExp(`^${storageKey}\\.\\d+$`).test(name)
  );
}

export interface CookieOptionsLike {
  [key: string]: unknown;
}

/**
 * The two things this adapter needs from whichever Next.js surface it
 * is running on -- a Server Action's cookie store, or middleware's
 * request/response pair.
 */
export interface BrowserCookieBridge {
  getAll(): { name: string; value: string }[];
  set(
    name: string,
    value: string,
    options: CookieOptionsLike,
  ): void;
}

export function appSessionCookieOptions(): CookieOptionsLike {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 30 * 24 * 60 * 60,
  };
}

export function readAppSessionToken(
  bridge: BrowserCookieBridge,
): string | null {
  const found =
    bridge.getAll().find(
      (cookie) => cookie.name === APP_SESSION_COOKIE,
    );

  return found && found.value.length > 0
    ? found.value
    : null;
}

/**
 * Builds the `{ getAll, setAll }` pair for createServerClient.
 *
 * One adapter instance corresponds to one Supabase client, which
 * corresponds to one request, so the load is memoized for that scope:
 * @supabase/ssr calls getAll several times per client and each call
 * would otherwise be its own round trip. The memo is dropped on any
 * write, so a refresh within the same request is never read back stale.
 */
export function createOpaqueSessionCookieAdapter(
  bridge: BrowserCookieBridge,
) {
  const storageKey =
    providerStorageKey();

  let loaded: ProviderCookie[] | null | undefined;

  return {
    async getAll() {
      const browserCookies =
        bridge.getAll().filter(
          (cookie) =>
            !isProviderSessionCookie(cookie.name, storageKey),
        );

      const token =
        readAppSessionToken(bridge);

      if (!token) {
        return browserCookies;
      }

      if (loaded === undefined) {
        loaded =
          await loadAppSession(token);
      }

      return loaded
        ? [...browserCookies, ...loaded]
        : browserCookies;
    },

    async setAll(
      cookiesToSet: {
        name: string;
        value: string;
        options: CookieOptionsLike;
      }[],
    ) {
      const providerCookies =
        cookiesToSet.filter(
          (cookie) =>
            isProviderSessionCookie(cookie.name, storageKey),
        );

      // Anything that is not the provider session -- the PKCE verifier,
      // and any future cookie the library adds -- goes to the browser
      // untouched.
      for (
        const { name, value, options } of cookiesToSet
      ) {
        if (!isProviderSessionCookie(name, storageKey)) {
          bridge.set(name, value, options);
        }
      }

      if (providerCookies.length === 0) {
        return;
      }

      loaded = undefined;

      const token =
        readAppSessionToken(bridge);

      const meaningful =
        providerCookies.filter(
          (cookie) => cookie.value.length > 0,
        );

      // Every value blank is how @supabase/ssr expresses a deletion --
      // sign-out, or a refresh that failed irrecoverably. End the
      // application session too, rather than leaving a live row whose
      // browser has been told to forget it.
      if (meaningful.length === 0) {
        if (token) {
          await revokeAppSession(token);
        }

        bridge.set(
          APP_SESSION_COOKIE,
          "",
          {
            ...appSessionCookieOptions(),
            maxAge: 0,
          },
        );

        return;
      }

      const nextToken =
        await persistAppSession(
          {
            token,
            cookies:
              meaningful.map(
                ({ name, value }) => ({ name, value }),
              ),
          },
        );

      if (nextToken !== token) {
        bridge.set(
          APP_SESSION_COOKIE,
          nextToken,
          appSessionCookieOptions(),
        );
      }
    },
  };
}

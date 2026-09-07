import "server-only";

import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

import {
  loadSupabaseEnv,
} from "../config/env";

import {
  openProviderSession,
  sealProviderSession,
} from "./app-session-seal";

/**
 * The server side of the session boundary (P14, AUTH-1).
 *
 * The browser holds an opaque identifier and nothing else. Everything
 * Supabase would accept as a credential lives here, sealed, behind the
 * service role. See supabase/migrations/20260905090000 for the finding
 * this exists to close.
 *
 * Deliberately its own service-role client rather than
 * src/infrastructure/supabase/client.ts, which CLAUDE.md confines to
 * system jobs and the regulatory adapter, and rather than admin-client,
 * which is scoped by convention to the Auth admin API. Same narrow
 * shape as both: one concern, one table.
 */

export interface ProviderCookie {
  name: string;
  value: string;
}

/**
 * How long a browser session may live before it must be established
 * again. Slides on use: a session in daily use stays alive, one
 * abandoned for a month does not.
 */
const SESSION_TTL_DAYS = 30;

const OPAQUE_TOKEN_BYTES = 32;

let cachedClient: SupabaseClient | undefined;

let cachedEnvKey: string | undefined;

function sessionStoreClient(): SupabaseClient {
  const env =
    loadSupabaseEnv();

  const envKey =
    `${env.SUPABASE_URL} ${env.SUPABASE_SERVICE_ROLE_KEY}`;

  if (!cachedClient || cachedEnvKey !== envKey) {
    cachedClient =
      createClient(
        env.SUPABASE_URL,
        env.SUPABASE_SERVICE_ROLE_KEY,
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
          },
        },
      );

    cachedEnvKey =
      envKey;
  }

  return cachedClient;
}

/**
 * The cookie value. 32 bytes from the platform CSPRNG, base64url --
 * unguessable, and carrying no structure an attacker could reason
 * about. Never a database id: an identifier that appears in a URL, a
 * log, or an error page must not be the thing that authenticates.
 */
export function createOpaqueSessionToken(): string {
  const bytes =
    crypto.getRandomValues(
      new Uint8Array(OPAQUE_TOKEN_BYTES),
    );

  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * The cookie itself is never stored -- only this. A read of the table,
 * by any route, yields nothing replayable.
 */
async function hashToken(
  token: string,
): Promise<string> {
  const digest =
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(token),
    );

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The provider session's owner, needed so that "sign out my other
 * sessions" can actually find them.
 *
 * Two independent strategies because one format changing must not
 * silently produce an unrevocable session: the session JSON's own
 * `user.id`, and failing that the `sub` claim of the access token it
 * carries. If neither yields a uuid the caller refuses to persist --
 * see persistAppSession.
 */
export function extractUserId(
  cookies: ProviderCookie[],
): string | null {
  const combined =
    cookies
      .slice()
      .sort(
        (a, b) =>
          a.name.localeCompare(
            b.name,
            undefined,
            { numeric: true },
          ),
      )
      .map((cookie) => cookie.value)
      .join("");

  if (!combined) {
    return null;
  }

  let raw = combined;

  if (raw.startsWith("base64-")) {
    try {
      raw = atob(
        raw.slice("base64-".length),
      );
    } catch {
      return null;
    }
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const user =
    (parsed as { user?: { id?: unknown } }).user;

  if (user && typeof user.id === "string" && user.id.length > 0) {
    return user.id;
  }

  const accessToken =
    (parsed as { access_token?: unknown }).access_token;

  if (typeof accessToken === "string") {
    const [, payload] = accessToken.split(".");

    if (payload) {
      try {
        const claims =
          JSON.parse(
            atob(
              payload.replace(/-/g, "+").replace(/_/g, "/"),
            ),
          );

        if (typeof claims?.sub === "string" && claims.sub.length > 0) {
          return claims.sub;
        }
      } catch {
        return null;
      }
    }
  }

  return null;
}

/**
 * Returns the provider cookies for a live session, or null for one that
 * does not exist, has expired, has been revoked, or cannot be opened
 * under the current secret. Every one of those is "not signed in" as
 * far as the caller is concerned.
 */
export async function loadAppSession(
  token: string,
): Promise<ProviderCookie[] | null> {
  const tokenHash =
    await hashToken(token);

  const { data, error } =
    await sessionStoreClient()
      .from("app_sessions")
      .select("id, sealed_provider_session")
      .eq("token_hash", tokenHash)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

  if (error || !data) {
    return null;
  }

  const plaintext =
    await openProviderSession(
      data.sealed_provider_session as string,
    );

  if (!plaintext) {
    return null;
  }

  try {
    const cookies =
      JSON.parse(plaintext);

    return Array.isArray(cookies) ? cookies : null;
  } catch {
    return null;
  }
}

/**
 * Writes the provider session for `token`, or mints a new session when
 * there is no live row to write to. Returns the token the caller must
 * put in the browser -- the same one when the session already existed,
 * a fresh one when it did not.
 */
export async function persistAppSession(
  {
    token,
    cookies,
  }: {
    token: string | null;
    cookies: ProviderCookie[];
  },
): Promise<string> {
  const userId =
    extractUserId(cookies);

  if (!userId) {
    // Fail closed. A session whose owner cannot be determined could
    // never be revoked by "sign out everywhere", and an unrevocable
    // credential is worse than a failed sign-in.
    throw new Error(
      "app session: could not determine the owner of the provider session; refusing to store a session that could not be revoked.",
    );
  }

  const sealed =
    await sealProviderSession(
      JSON.stringify(cookies),
    );

  const now =
    new Date();

  const expiresAt =
    new Date(
      now.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

  const client =
    sessionStoreClient();

  if (token) {
    const tokenHash =
      await hashToken(token);

    // 2026-09-04 (P14, session fixation). Ownership is read BEFORE
    // anything is written, and is never written again after the insert.
    //
    // This used to be a single UPDATE that set user_id alongside the
    // sealed session, keyed only on the token being live. That made a
    // caller-supplied identifier adoptable: an attacker planted their
    // own identifier in a signed-out victim's browser, the victim
    // signed in, this UPDATE rebound the row to the victim, the
    // identifier was returned unchanged so no new cookie was set, and
    // the attacker's copy of it was now the victim's session.
    //
    // The distinction the code has to make, and now makes explicitly:
    //
    //   same identity  -> an ordinary REFRESH of a session that is
    //                     already authenticated. Keep the identifier;
    //                     rotating here would end a live session every
    //                     time a token refreshed.
    //
    //   any other case -> an AUTHENTICATION BOUNDARY. Retire whatever
    //                     was supplied and mint a fresh identifier. It
    //                     covers the fixation attempt above and the
    //                     legitimate identity switch (an invitation or
    //                     recovery link opened in a browser already
    //                     signed in as someone else) with the same
    //                     rule, because from here they are the same
    //                     event.
    const { data: existing } =
      await client
        .from("app_sessions")
        .select("id, user_id")
        .eq("token_hash", tokenHash)
        .is("revoked_at", null)
        .gt("expires_at", now.toISOString())
        .maybeSingle();

    if (existing && existing.user_id === userId) {
      const { data: refreshed } =
        await client
          .from("app_sessions")
          .update(
            {
              sealed_provider_session: sealed,
              last_seen_at: now.toISOString(),
              expires_at: expiresAt,
            },
          )
          .eq("id", existing.id)
          .is("revoked_at", null)
          .select("id")
          .maybeSingle();

      if (refreshed) {
        return token;
      }
    }

    if (existing) {
      // Retired, not reused. A copy of this identifier taken a moment
      // ago must not survive the authentication that replaced it.
      await client
        .from("app_sessions")
        .update(
          { revoked_at: now.toISOString() },
        )
        .eq("id", existing.id)
        .is("revoked_at", null);
    }
  }

  const freshToken =
    createOpaqueSessionToken();

  const { error } =
    await client
      .from("app_sessions")
      .insert(
        {
          token_hash: await hashToken(freshToken),
          user_id: userId,
          sealed_provider_session: sealed,
          expires_at: expiresAt,
        },
      );

  if (error) {
    throw new Error(
      `app session: could not store the session (${error.code ?? "unknown"}).`,
    );
  }

  return freshToken;
}

// 2026-09-07 (S5 review round 10, finding S10-A-2, live-reproduced).
// USED TO discard the update's `{data, error}` result entirely -- no
// destructure, no check, no throw. This is the PRIMARY sign-out path
// (called from opaque-session-cookies.ts's `setAll`, invoked on every
// ordinary sign-out) and the error-recovery fallback in
// app/(auth)/actions.ts's signOutAction. Both proceed to clear the
// browser's opaque session cookie unconditionally right afterward,
// regardless of whether this write actually happened -- on a genuine
// transient failure, the browser was told "signed out" while the
// app_sessions row backing that opaque token stayed live (revoked_at
// still null) for up to the full 30-day TTL, reopening the exact
// hazard the P14 AUTH-1 server-side session store (this file) was
// purpose-built to close. Now throws, matching this file's own
// persistAppSession (its insert-error path already throws, uncaught by
// any caller) and this codebase's established "throw is for
// infrastructure failures" convention (CLAUDE.md).
export async function revokeAppSession(
  token: string,
): Promise<void> {
  const tokenHash =
    await hashToken(token);

  const { error } =
    await sessionStoreClient()
      .from("app_sessions")
      .update(
        { revoked_at: new Date().toISOString() },
      )
      .eq("token_hash", tokenHash)
      .is("revoked_at", null);

  if (error) {
    throw new Error(
      `app session: could not revoke the session (${error.code ?? "unknown"}).`,
    );
  }
}

/**
 * Ends every OTHER browser session this user holds.
 *
 * Supabase's own `signOut({ scope: "others" })` revokes the provider's
 * refresh tokens, which eventually strands those sessions -- but only
 * once their access tokens expire, up to an hour later. After a
 * password change that hour is exactly the window that matters, so the
 * application ends its own sessions immediately rather than waiting for
 * the provider's to lapse.
 */
export async function revokeOtherAppSessions(
  {
    userId,
    keepToken,
  }: {
    userId: string;
    keepToken: string | null;
  },
): Promise<number> {
  const client =
    sessionStoreClient();

  let query =
    client
      .from("app_sessions")
      .update(
        { revoked_at: new Date().toISOString() },
      )
      .eq("user_id", userId)
      .is("revoked_at", null);

  if (keepToken) {
    query =
      query.neq(
        "token_hash",
        await hashToken(keepToken),
      );
  }

  // 2026-09-07 (S5 review round 10, finding S10-A-1, live-reproduced).
  // USED TO discard `error` entirely -- `data` comes back null on a
  // genuine query failure, the exact same shape "no other live
  // sessions exist" produces, so a real DB error silently reported 0
  // (indistinguishable from success). This function's own sole caller
  // (changePasswordForSession, app/account/password/change-password.ts)
  // already wraps this call in a try/catch that correctly carries a
  // thrown failure as `appSessionsRevoked: false` -- that caller's own
  // doc comment ("Failure is carried, never raised") already assumed
  // this function throws on failure; it never did. Now throws,
  // matching this file's own persistAppSession/revokeAppSession.
  const { data, error } =
    await query.select("id");

  if (error) {
    throw new Error(
      `app session: could not revoke other sessions (${error.code ?? "unknown"}).`,
    );
  }

  return data?.length ?? 0;
}

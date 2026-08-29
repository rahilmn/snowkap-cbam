import {
  createBrowserClient,
} from "@supabase/ssr";

import type {
  SupabaseClient,
} from "@supabase/supabase-js";

let cachedClient:
  SupabaseClient | undefined;

/**
 * The browser-side, session-scoped Supabase client -- for "use client"
 * components only. Uses the anon/publishable key (NEXT_PUBLIC_-
 * prefixed, inlined into the client bundle by Next.js at build time,
 * safe for browser exposure by design) rather than the service-role
 * key (src/infrastructure/supabase/client.ts), which must never reach
 * the browser. Every read/write this client performs is still subject
 * to Postgres RLS -- it has no elevated privilege of its own.
 *
 * Memoized like the service-role client, for the same reason: reading
 * env vars (even NEXT_PUBLIC_ ones) at module load time would break
 * any test that imports this module before they're configured.
 */
export function getBrowserSupabaseClient(): SupabaseClient {
  if (!cachedClient) {
    const url =
      process.env.NEXT_PUBLIC_SUPABASE_URL;

    const anonKey =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !anonKey) {
      throw new Error(
        "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be configured.",
      );
    }

    cachedClient =
      createBrowserClient(
        url,
        anonKey,
        {
          // 2026-08-29 (P11 finding #14) -- see server-client.ts's
          // matching comment for the full reasoning; same fix, same
          // NODE_ENV condition, mirrored here for the browser client.
          //
          // 2026-08-29 (P13 adversarial security audit, finding #2):
          // deliberately NOT adding `httpOnly: true` here, unlike the
          // two server-side call sites (server-client.ts, proxy.ts),
          // which now both set it. This is a known, considered
          // residual gap, not an oversight:
          //
          // 1. It would be a no-op at best -- `document.cookie` (what
          //    this client actually uses to read/write cookies) cannot
          //    read OR set an httpOnly cookie in the first place, so
          //    the flag has no effect on cookies this client writes.
          // 2. The real fix is architectural, not a flag: this app's
          //    ONE real (non-test) caller of getBrowserSupabaseClient()
          //    is app/auth/callback/page.tsx, which handles the
          //    invite/magic-link/password-reset implicit flow by
          //    reading access_token/refresh_token out of a URL *hash
          //    fragment* (see that file's own doc comment) and calling
          //    `.auth.setSession()` client-side -- hash fragments are
          //    never sent to the server, so only client-side code can
          //    ever see those tokens, which means this specific flow
          //    fundamentally needs a client that can write non-httpOnly
          //    cookies. Moving that establishment server-side (e.g. a
          //    route handler that reads the fragment via a redirect
          //    trick, or switching to a server-verifiable ?token_hash=
          //    flow) is a real behavior change to that flow and
          //    deserves its own isolated review -- deliberately out of
          //    scope for this pass. Until that refactor happens, the
          //    session cookies this specific flow establishes remain
          //    readable via `document.cookie`, same as before.
          cookieOptions: {
            secure: process.env.NODE_ENV === "production",
          },
        },
      );
  }

  return cachedClient;
}

import "server-only";

import {
  createServerClient,
} from "@supabase/ssr";

import {
  cookies,
} from "next/headers";

/**
 * The server-side, session-scoped Supabase client -- for Server
 * Components, Server Actions, and Route Handlers. Uses the anon/
 * publishable key plus the caller's own session cookies, so every
 * read/write it performs runs as that specific authenticated user
 * (or anon, if signed out) and is subject to Postgres RLS -- this is
 * NOT the service-role client (src/infrastructure/supabase/client.ts),
 * which bypasses RLS and must stay confined to system jobs and the
 * regulatory adapter.
 *
 * Deliberately not memoized (unlike the browser/service-role clients):
 * this reads the current request's cookies via next/headers, which are
 * only valid for the request currently being handled -- caching an
 * instance across requests would leak one user's session into
 * another's.
 *
 * A Server Component can read cookies but not set them (Next.js
 * throws if you try); the try/catch below absorbs that specific case,
 * matching Supabase's own documented pattern -- middleware
 * (proxy.ts) is what actually refreshes the session cookie on
 * every request, so a Server Component's inability to set cookies
 * doesn't break the session.
 */
export async function getServerSupabaseClient() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL;

  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be configured.",
    );
  }

  const cookieStore =
    await cookies();

  return createServerClient(
    url,
    anonKey,
    {
      // 2026-08-29 (P11 mandatory security review, finding #14,
      // SHOULD-FIX, confirmed live): all three create*Client call
      // sites (this one, browser-client.ts, proxy.ts) previously
      // omitted cookieOptions entirely, so @supabase/ssr's own
      // defaults applied -- {path:"/", sameSite:"lax", httpOnly:false},
      // NO `secure`. That leaves the access + refresh tokens eligible
      // to be sent on a plaintext http:// request (e.g. a user typing
      // the bare host before any edge redirect to https runs).
      // `secure: true` in production closes that; conditioned on
      // NODE_ENV so local dev (plain http://localhost, no TLS) keeps
      // working exactly as before -- an unconditional `secure: true`
      // would silently break every cookie-dependent flow in `pnpm dev`.
      cookieOptions: {
        secure: process.env.NODE_ENV === "production",
      },

      cookies: {
        getAll() {
          return cookieStore.getAll();
        },

        setAll(
          cookiesToSet,
        ) {
          try {
            for (
              const {
                name,
                value,
                options,
              } of cookiesToSet
            ) {
              cookieStore.set(
                name,
                value,
                options,
              );
            }
          } catch {
            // Called from a Server Component, where cookies cannot be
            // set -- safe to ignore because proxy.ts refreshes
            // the session on every request regardless.
          }
        },
      },
    },
  );
}

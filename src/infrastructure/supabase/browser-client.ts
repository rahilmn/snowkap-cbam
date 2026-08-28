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
      );
  }

  return cachedClient;
}

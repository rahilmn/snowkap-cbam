import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

import {
  loadSupabaseEnv,
} from "../config/env";

let cachedClient:
  SupabaseClient | undefined;

/**
 * Returns a memoized Supabase client, constructed on first use.
 *
 * Deliberately lazy: environment validation must not happen at module
 * import time, or every static importer of this module (and anything
 * that transitively imports it) fails to load in an environment without
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY configured — including test
 * files that intend to skip themselves gracefully when those variables
 * are absent. This function is the only export; there must be no other
 * top-level side effects in this module.
 */
export function getSupabaseClient(): SupabaseClient {
  if (!cachedClient) {
    const env =
      loadSupabaseEnv();

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
  }

  return cachedClient;
}

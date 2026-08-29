import "server-only";

import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

import {
  loadSupabaseEnv,
} from "../config/env";

let cachedClient:
  SupabaseClient | undefined;

let cachedEnvKey:
  string | undefined;

/**
 * A service-role Supabase client, memoized, for the Auth admin API
 * (`client.auth.admin.*`) -- currently just `inviteUserByEmail`.
 *
 * Deliberately separate from src/infrastructure/supabase/client.ts,
 * the regulatory adapter's general-purpose service-role client: that
 * one has unrestricted table access (bypasses RLS on every table) and
 * must never be reachable from UI code. This client exists so that
 * Server Actions can reach the one Auth-admin operation product code
 * legitimately needs (sending an invitation email) without opening a
 * general RLS-bypass escape hatch to the rest of the schema -- see
 * the UI_ALLOWED_INFRASTRUCTURE_IMPORTS exception in
 * tests/architecture/layering-rules.ts for the layering rule this
 * narrowness is load-bearing for.
 *
 * 2026-08-30: rebuilt if env resolves differently on a later call
 * rather than cached unconditionally forever -- same live-reproduced
 * defect and identical fix as
 * src/infrastructure/supabase/client.ts's getSupabaseClient(); see
 * that function's own doc comment for the full account.
 */
export function getSupabaseAdminClient(): SupabaseClient {
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

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";

import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

// Verifies 20260828100000_authenticated_read_regulatory_data.sql:
// any authenticated user (regardless of organization -- regulatory
// data isn't tenant-scoped) can read the regulatory reference tables,
// while a fully anonymous request (no session at all) still cannot.
// Runs against a LOCAL, disposable Supabase instance loaded with the
// real regulatory dataset (see this migration's own commit message for
// how) -- never the protected regulatory project, consistent with
// tests/integration/organizations-isolation.test.ts.

const LOCAL_API_URL =
  process.env.SUPABASE_LOCAL_URL ??
  "http://127.0.0.1:54321";

const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

async function isLocalSupabaseReachable(): Promise<boolean> {
  try {
    const response =
      await fetch(
        `${LOCAL_API_URL}/auth/v1/health`,
        {
          signal:
            AbortSignal.timeout(
              1500,
            ),
        },
      );

    return response.ok;
  } catch {
    return false;
  }
}

/**
 * 2026-08-29 (P11 mandatory security review, finding #11 CI change --
 * discovered while wiring `supabase start` into CI for the cross-org
 * isolation suites, .github/workflows/ci.yml): reachability alone is
 * NOT sufficient for THIS file, unlike every isolation suite --
 * `supabase start`/`supabase db reset` applies migrations only,
 * leaving countries/cbam_goods/default_emission_values/
 * regulatory_datasets/production_routes genuinely empty until the
 * Python pipeline (scripts/regulatory/, `pnpm regulatory:verify`'s own
 * prerequisite) has separately loaded the real dataset -- this file's
 * own header comment already says as much ("loaded with the real
 * dataset ... see this migration's own commit message for how").
 * Wiring that full offline Python pipeline into a public, no-secrets
 * CI job is a materially larger change than this review's own scope
 * (it needs its own investigation: ordered script sequence, a local
 * DB connection string distinct from the hosted project's
 * SUPABASE_DB_PASSWORD, `pip install -r requirements.txt`) --
 * deliberately NOT attempted here. Without this extra check, enabling
 * Supabase in CI for the isolation suites would make THIS file start
 * running too (same reachability gate) and fail on every
 * `length > 0` assertion below, for a reason that has nothing to do
 * with what this file actually tests. Checking for at least one
 * `countries` row (service-role, bypasses RLS) is a cheap, honest way
 * to keep this suite skipping-not-failing in exactly that situation,
 * on any local Supabase instance -- CI's or a developer's own -- that
 * hasn't run the regulatory pipeline, while still running for real
 * wherever it has (unchanged from before this comment).
 */
async function isLocalRegulatoryDataSeeded(): Promise<boolean> {
  try {
    const probeClient =
      createClient(
        LOCAL_API_URL,
        LOCAL_SERVICE_ROLE_KEY,
        {
          auth: { persistSession: false },
        },
      );

    const { data, error } =
      await probeClient
        .from("countries")
        .select("id")
        .limit(1);

    return !error && !!data && data.length > 0;
  } catch {
    return false;
  }
}

const localSupabaseReachable =
  await isLocalSupabaseReachable();

const localRegulatoryDataSeeded =
  localSupabaseReachable &&
  (await isLocalRegulatoryDataSeeded());

describe.skipIf(!localRegulatoryDataSeeded)(
  "regulatory tables -- authenticated read access (local Supabase only)",
  () => {
    const runId =
      crypto.randomUUID().slice(
        0,
        8,
      );

    const serviceClient: SupabaseClient =
      createClient(
        LOCAL_API_URL,
        LOCAL_SERVICE_ROLE_KEY,
        {
          auth: { persistSession: false },
        },
      );

    const anonClient: SupabaseClient =
      createClient(
        LOCAL_API_URL,
        LOCAL_ANON_KEY,
        {
          auth: { persistSession: false },
        },
      );

    let userId: string;
    let authenticatedClient: SupabaseClient;

    beforeAll(async () => {
      const password =
        `regulatory-read-test-${runId}!`;

      const { data: user, error: userError } =
        await serviceClient.auth.admin.createUser(
          {
            email: `regulatory-read-${runId}@example.com`,
            password,
            email_confirm: true,
          },
        );

      if (userError || !user.user) {
        throw new Error(
          `Failed to create test user: ${userError?.message}`,
        );
      }

      userId =
        user.user.id;

      authenticatedClient =
        createClient(
          LOCAL_API_URL,
          LOCAL_ANON_KEY,
          {
            auth: { persistSession: false },
          },
        );

      const { error: signInError } =
        await authenticatedClient.auth.signInWithPassword(
          {
            email: `regulatory-read-${runId}@example.com`,
            password,
          },
        );

      if (signInError) {
        throw new Error(
          `Failed to sign in test user: ${signInError.message}`,
        );
      }
    });

    afterAll(async () => {
      await serviceClient.auth.admin.deleteUser(
        userId,
      );
    });

    it(
      "an authenticated user can read countries",
      async () => {
        const { data, error } =
          await authenticatedClient
            .from("countries")
            .select("id, name")
            .limit(1);

        expect(error).toBeNull();
        expect(data?.length).toBeGreaterThan(0);
      },
    );

    it(
      "an authenticated user can read cbam_goods",
      async () => {
        const { data, error } =
          await authenticatedClient
            .from("cbam_goods")
            .select("id, trade_code")
            .limit(1);

        expect(error).toBeNull();
        expect(data?.length).toBeGreaterThan(0);
      },
    );

    it(
      "an authenticated user can read the ACTIVE default_emission_values dataset",
      async () => {
        const { data, error } =
          await authenticatedClient
            .from("default_emission_values")
            .select("id")
            .limit(1);

        expect(error).toBeNull();
        expect(data?.length).toBeGreaterThan(0);
      },
    );

    it(
      "an authenticated user can read regulatory_datasets and production_routes",
      async () => {
        const { data: datasets, error: datasetsError } =
          await authenticatedClient
            .from("regulatory_datasets")
            .select("id")
            .limit(1);

        expect(datasetsError).toBeNull();
        expect(datasets?.length).toBeGreaterThan(0);

        const { data: routes, error: routesError } =
          await authenticatedClient
            .from("production_routes")
            .select("id")
            .limit(1);

        expect(routesError).toBeNull();
        expect(routes?.length).toBeGreaterThan(0);
      },
    );

    it(
      "a fully anonymous (no session) request still cannot read regulatory data",
      async () => {
        // anonClient has the anon API key but never signed in -- no
        // authenticated role, so this must still be denied. Confirms
        // the policy is scoped to `authenticated`, not accidentally
        // public to anyone with the anon key.
        const { data, error } =
          await anonClient
            .from("countries")
            .select("id")
            .limit(1);

        expect(error).toBeNull();
        expect(data).toHaveLength(0);
      },
    );
  },
);

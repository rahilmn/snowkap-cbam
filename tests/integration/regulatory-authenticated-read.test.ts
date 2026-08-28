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

const localSupabaseReachable =
  await isLocalSupabaseReachable();

describe.skipIf(!localSupabaseReachable)(
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

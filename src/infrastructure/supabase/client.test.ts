import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// 2026-08-30 (P13 final non-blocked-work audit -- live-reproduced while
// diagnosing a real, deterministic E2E failure): this file's memoized
// `cachedClient` was built from whatever SUPABASE_URL/
// SUPABASE_SERVICE_ROLE_KEY loadSupabaseEnv() returned on the FIRST
// call within a process's lifetime, then reused forever regardless of
// whether those env vars later resolved differently. Live-reproduced
// against this exact codebase's own dev setup: this machine's `.env`
// documents the hosted regulatory Supabase project (for
// scripts/regulatory/*.py and pnpm regulatory:verify) while `.env.local`
// correctly overrides SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY to the
// local instance for `pnpm dev`/`pnpm test:e2e` -- under Next.js 16's
// standalone production server (`node .next/standalone/server.js`,
// exactly what `playwright.config.ts`'s webServer runs), the very
// first call to this module's getSupabaseClient() within a given
// server process sometimes resolved process.env.SUPABASE_URL to the
// `.env` value (the remote hosted project) before Next's own
// `.env.local` precedence had fully applied -- and because the client
// was cached unconditionally, every later regulatory-repository call
// in that same process's lifetime silently queried the wrong Supabase
// project's data instead. Confirmed via a live diagnostic instrumented
// directly against local Postgres: a rejected shipment-line
// determination write during
// tests/e2e/importer-journey.spec.ts (part of a full-suite run) traced
// to `app.emission_determination_matches_regulatory_record`'s dataset-
// activity check failing on a `dataset_id` that matched byte-for-byte
// the REMOTE hosted project's own ACTIVE `regulatory_datasets` row
// (queried directly via scripts/regulatory's own pooler-url mechanism
// to confirm) -- not any row in the local database, which has a
// completely different id for the same dataset version.
//
// This module previously had zero test coverage. Mocks
// @supabase/supabase-js's createClient (not real network I/O) and
// stubs env directly, matching this codebase's other infrastructure
// test files.

const createClientMock =
  vi.fn(
    (url: string, key: string, _options?: unknown) => (
      { __url: url, __key: key }
    ),
  );

vi.mock(
  "@supabase/supabase-js",
  () => (
    {
      createClient: (...args: [string, string, unknown]) => createClientMock(...args),
    }
  ),
);

const { getSupabaseClient } =
  await import(
    "./client"
  );

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe(
  "getSupabaseClient",
  () => {
    it(
      "reuses the cached client across calls when the environment has not changed (memoization preserved for the common case)",
      () => {
        vi.stubEnv(
          "SUPABASE_URL",
          "https://local-project.example.co",
        );

        vi.stubEnv(
          "SUPABASE_SERVICE_ROLE_KEY",
          "local-service-role-key",
        );

        const first =
          getSupabaseClient();

        const second =
          getSupabaseClient();

        expect(second).toBe(
          first,
        );

        expect(createClientMock).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "reconstructs the client when SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY resolve differently on a later call, rather than serving a stale cached client pointed at the wrong project forever (P13 live-reproduced regression)",
      () => {
        vi.stubEnv(
          "SUPABASE_URL",
          "https://wrong-remote-project.example.co",
        );

        vi.stubEnv(
          "SUPABASE_SERVICE_ROLE_KEY",
          "wrong-remote-service-role-key",
        );

        const wrongClient =
          getSupabaseClient();

        expect(createClientMock).toHaveBeenLastCalledWith(
          "https://wrong-remote-project.example.co",
          "wrong-remote-service-role-key",
          expect.anything(),
        );

        // Simulates the exact live-reproduced scenario: env resolves
        // to the correct project on a later call within the same
        // process.
        vi.stubEnv(
          "SUPABASE_URL",
          "https://correct-local-project.example.co",
        );

        vi.stubEnv(
          "SUPABASE_SERVICE_ROLE_KEY",
          "correct-local-service-role-key",
        );

        const correctedClient =
          getSupabaseClient();

        expect(createClientMock).toHaveBeenLastCalledWith(
          "https://correct-local-project.example.co",
          "correct-local-service-role-key",
          expect.anything(),
        );

        expect(correctedClient).not.toBe(
          wrongClient,
        );

        expect(createClientMock).toHaveBeenCalledTimes(
          2,
        );
      },
    );

    it(
      "passes persistSession:false and autoRefreshToken:false, matching the service-role/no-browser-session contract",
      () => {
        vi.stubEnv(
          "SUPABASE_URL",
          "https://local-project.example.co",
        );

        vi.stubEnv(
          "SUPABASE_SERVICE_ROLE_KEY",
          "local-service-role-key",
        );

        getSupabaseClient();

        expect(createClientMock).toHaveBeenLastCalledWith(
          "https://local-project.example.co",
          "local-service-role-key",
          {
            auth: {
              persistSession: false,
              autoRefreshToken: false,
            },
          },
        );
      },
    );
  },
);

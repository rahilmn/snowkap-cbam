import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Regression test for a fresh-clone / no-credentials environment: importing
// the regulatory infrastructure modules must never throw, even when
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are unset. The Supabase client
// must be constructed lazily (on first use), not at module load time —
// otherwise every consumer's static imports fail before any test can
// decide to skip itself. See src/infrastructure/supabase/client.ts.

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe(
  "supabase client module load safety",
  () => {
    it(
      "loading src/infrastructure/supabase/client.js does not throw when env is unset",
      async () => {
        vi.stubEnv(
          "SUPABASE_URL",
          "",
        );

        vi.stubEnv(
          "SUPABASE_SERVICE_ROLE_KEY",
          "",
        );

        vi.resetModules();

        await expect(
          import("../../src/infrastructure/supabase/client.js"),
        ).resolves.toBeDefined();
      },
    );

    it(
      "loading the regulatory repository adapter does not throw when env is unset",
      async () => {
        vi.stubEnv(
          "SUPABASE_URL",
          "",
        );

        vi.stubEnv(
          "SUPABASE_SERVICE_ROLE_KEY",
          "",
        );

        vi.resetModules();

        await expect(
          import(
            "../../src/infrastructure/regulatory/supabase-regulatory-repository.js"
          ),
        ).resolves.toBeDefined();
      },
    );

    it(
      "constructing the client without env throws a clear, listed-vars error",
      async () => {
        vi.stubEnv(
          "SUPABASE_URL",
          "",
        );

        vi.stubEnv(
          "SUPABASE_SERVICE_ROLE_KEY",
          "",
        );

        vi.resetModules();

        const {
          getSupabaseClient,
        } = await import(
          "../../src/infrastructure/supabase/client.js"
        );

        expect(
          () => getSupabaseClient(),
        ).toThrow(
          /SUPABASE_URL/,
        );
      },
    );
  },
);

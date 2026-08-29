import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// 2026-08-30: same live-reproduced caching defect and fix as
// src/infrastructure/supabase/client.test.ts -- see that file's own
// header comment for the full account. This file previously had zero
// test coverage.

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

const { getSupabaseAdminClient } =
  await import(
    "./admin-client"
  );

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe(
  "getSupabaseAdminClient",
  () => {
    it(
      "reuses the cached client across calls when the environment has not changed",
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
          getSupabaseAdminClient();

        const second =
          getSupabaseAdminClient();

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
          getSupabaseAdminClient();

        vi.stubEnv(
          "SUPABASE_URL",
          "https://correct-local-project.example.co",
        );

        vi.stubEnv(
          "SUPABASE_SERVICE_ROLE_KEY",
          "correct-local-service-role-key",
        );

        const correctedClient =
          getSupabaseAdminClient();

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
  },
);

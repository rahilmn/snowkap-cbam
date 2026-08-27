import {
  describe,
  expect,
  it,
} from "vitest";

import {
  loadSupabaseEnv,
} from "./env";

describe(
  "loadSupabaseEnv",
  () => {
    it(
      "returns the configured values when both variables are present",
      () => {
        const env =
          loadSupabaseEnv(
            {
              SUPABASE_URL:
                "https://example.supabase.co",

              SUPABASE_SERVICE_ROLE_KEY:
                "service-role-key",
            },
          );

        expect(
          env,
        ).toEqual(
          {
            SUPABASE_URL:
              "https://example.supabase.co",

            SUPABASE_SERVICE_ROLE_KEY:
              "service-role-key",
          },
        );
      },
    );

    it(
      "throws mentioning SUPABASE_URL when it is missing",
      () => {
        expect(
          () =>
            loadSupabaseEnv(
              {
                SUPABASE_SERVICE_ROLE_KEY:
                  "service-role-key",
              },
            ),
        ).toThrow(
          /SUPABASE_URL/,
        );
      },
    );

    it(
      "throws mentioning SUPABASE_SERVICE_ROLE_KEY when it is missing",
      () => {
        expect(
          () =>
            loadSupabaseEnv(
              {
                SUPABASE_URL:
                  "https://example.supabase.co",
              },
            ),
        ).toThrow(
          /SUPABASE_SERVICE_ROLE_KEY/,
        );
      },
    );

    it(
      "lists both missing variables when neither is present",
      () => {
        expect(
          () =>
            loadSupabaseEnv(
              {},
            ),
        ).toThrow(
          /SUPABASE_URL.*SUPABASE_SERVICE_ROLE_KEY/s,
        );
      },
    );

    it(
      "throws when SUPABASE_URL is an empty string",
      () => {
        expect(
          () =>
            loadSupabaseEnv(
              {
                SUPABASE_URL:
                  "",

                SUPABASE_SERVICE_ROLE_KEY:
                  "service-role-key",
              },
            ),
        ).toThrow(
          /SUPABASE_URL/,
        );
      },
    );
  },
);

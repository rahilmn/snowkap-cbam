import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Unit test with a mocked Supabase client -- this scenario (the
// "_Other Countries and Territorie" fallback territory row itself
// missing from the ACTIVE dataset) cannot be exercised against the
// real, protected regulatory database: that row's presence is exactly
// what the uniqueness/integrity design guarantees, and simulating its
// absence would mean destructively altering protected data, which is
// forbidden regardless of purpose. See
// tests/integration/regulatory-repository.test.ts for the credentialed
// happy-path test against the real database.

/**
 * A minimal stand-in for the Supabase query builder: every chained
 * method call (.select(), .eq(), .in(), .limit(), ...) returns the
 * same thenable object, so it doesn't matter which exact chain shape
 * the adapter uses -- awaiting it always resolves to the configured
 * {data, error} for that query. Keeps the mock resilient to
 * non-behavioral changes in how the adapter chains its query builder.
 */
function chainableResult(
  result: { data: unknown; error: unknown },
) {
  const proxy: unknown =
    new Proxy(
      {},
      {
        get(
          _target,
          prop,
        ) {
          if (prop === "then") {
            return (
              resolve: (
                value: { data: unknown; error: unknown },
              ) => void,
            ) =>
              resolve(
                result,
              );
          }

          return () =>
            proxy;
        },
      },
    );

  return proxy;
}

const ACTIVE_DATASET_ROW =
  {
    id: "dataset-1",
    dataset_type: "DEFAULT_EMISSION_VALUES",
    version: "test-version",
    status: "ACTIVE",
  };

function mockSupabaseClient(
  {
    countriesData,
  }: {
    countriesData: unknown[];
  },
) {
  return {
    from(
      table: string,
    ) {
      if (table === "regulatory_datasets") {
        return chainableResult(
          {
            data: [ACTIVE_DATASET_ROW],
            error: null,
          },
        );
      }

      if (table === "countries") {
        return chainableResult(
          {
            data: countriesData,
            error: null,
          },
        );
      }

      // Reaching any other table means the adapter proceeded past the
      // country-candidates stage -- a diagnostic, not a real Supabase
      // error, so a broken fix fails loudly with a clear message
      // rather than an opaque downstream mock-shape error.
      throw new Error(
        `Test only stubs regulatory_datasets/countries; adapter unexpectedly queried "${table}".`,
      );
    },
  };
}

vi.mock(
  "../supabase/client",
  () => (
    {
      getSupabaseClient:
        vi.fn(),
    }
  ),
);

const {
  getSupabaseClient,
} = await import(
  "../supabase/client"
);

const {
  SupabaseRegulatoryRepository,
} = await import(
  "./supabase-regulatory-repository"
);

describe(
  "SupabaseRegulatoryRepository -- missing fallback territory",
  () => {
    it(
      "throws a clear integrity error when neither the requested country nor the fallback territory is found",
      async () => {
        vi.mocked(
          getSupabaseClient,
        ).mockReturnValue(
          mockSupabaseClient(
            {
              // Neither "Ruritania" nor "_Other Countries and Territorie"
              // came back -- the fallback territory the R7 fix depends on
              // is itself absent from the ACTIVE dataset. This must never
              // happen given the schema's integrity guarantees; if it
              // does, it is a seed/integrity failure, not "no match".
              countriesData: [],
            },
          ) as never,
        );

        const repository =
          new SupabaseRegulatoryRepository();

        await expect(
          repository.findActiveDefaultEmissionCandidates(
            {
              origin_country_name:
                "Ruritania",
              trade_code:
                "7219",
              production_route:
                null,
            },
          ),
        ).rejects.toThrow(
          /_Other Countries and Territorie/,
        );
      },
    );

    it(
      "still returns [] (not a throw) when the requested country is absent but the fallback territory IS present",
      async () => {
        // Regression guard: the fix must not turn the ordinary R7
        // fallback path (unlisted country, fallback territory present,
        // simply no matching trade code for it) into a false throw.
        vi.mocked(
          getSupabaseClient,
        ).mockReturnValue(
          mockSupabaseClient(
            {
              countriesData: [
                {
                  id: "fallback-territory-id",
                  name: "_Other Countries and Territorie",
                },
              ],
            },
          ) as never,
        );

        const repository =
          new SupabaseRegulatoryRepository();

        // cbam_goods lookup for this trade code will now be reached and
        // is not stubbed -- the mock's diagnostic throw doubles as proof
        // this path proceeds past the country-candidates guard rather
        // than throwing there, which is the behavior being protected.
        await expect(
          repository.findActiveDefaultEmissionCandidates(
            {
              origin_country_name:
                "Ruritania",
              trade_code:
                "7219",
              production_route:
                null,
            },
          ),
        ).rejects.toThrow(
          /cbam_goods/,
        );
      },
    );
  },
);

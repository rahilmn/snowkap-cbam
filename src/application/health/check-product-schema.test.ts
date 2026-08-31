import {
  describe,
  expect,
  it,
} from "vitest";

import {
  PRODUCT_SCHEMA_PROBE_TABLES,
  checkProductSchema,
} from "./check-product-schema";

// 2026-08-30: written RED-first, before check-product-schema.ts existed.
//
// Motivated by a real production incident (P13_RELEASE_READINESS_REPORT.md
// §16.11/§32): the Railway deployment reported `/api/health` ->
// {"status":"ok"} against a Supabase project that had FOUR of 57
// migrations applied and ZERO product tables. The health route only
// checked database reachability and the ACTIVE-dataset invariant -- both
// satisfied by the regulatory foundation alone -- so a completely unusable
// application read as fully healthy. This check closes that specific gap.

type QueryResult = {
  error: { code?: string; message?: string } | null;
};

/**
 * Minimal supabase-js stand-in: records which tables were probed and
 * returns a per-table canned result. Mirrors the real call shape
 * (.from(table).select("id").limit(1)) exactly.
 */
function mockSupabase(
  resultsByTable: Record<string, QueryResult>,
  probed: string[] = [],
) {
  return {
    probed,

    client: {
      from: (
        table: string,
      ) => {
        probed.push(
          table,
        );

        return {
          select: () => ({
            limit: () =>
              Promise.resolve(
                resultsByTable[table] ??
                  { error: null },
              ),
          }),
        };
      },
    } as never,
  };
}

describe(
  "checkProductSchema",
  () => {
    it(
      "reports ok when every probed product table exists",
      async () => {
        const { client } =
          mockSupabase(
            {},
          );

        const result =
          await checkProductSchema(
            client,
          );

        expect(
          result.status,
        ).toBe("ok");

        expect(
          result.missing_tables,
        ).toEqual([]);
      },
    );

    it(
      "probes a table from each major subsystem, not just one",
      async () => {
        // The incident this check exists for would have been caught by
        // probing any single product table -- but a partially-applied
        // migration run is exactly as plausible as a fully-absent one,
        // so tenancy, importer and producer surfaces are each probed.
        expect(
          PRODUCT_SCHEMA_PROBE_TABLES,
        ).toContain("organizations");

        expect(
          PRODUCT_SCHEMA_PROBE_TABLES,
        ).toContain("shipments");

        expect(
          PRODUCT_SCHEMA_PROBE_TABLES,
        ).toContain("emission_data");
      },
    );

    it(
      "reports missing, naming the table, when a relation does not exist (Postgres 42P01)",
      async () => {
        const { client } =
          mockSupabase(
            {
              shipments: {
                error: {
                  code: "42P01",
                  message: 'relation "public.shipments" does not exist',
                },
              },
            },
          );

        const result =
          await checkProductSchema(
            client,
          );

        expect(
          result.status,
        ).toBe("missing");

        expect(
          result.missing_tables,
        ).toEqual(["shipments"]);
      },
    );

    it(
      "reports missing for PostgREST's own schema-cache code (PGRST205)",
      async () => {
        const { client } =
          mockSupabase(
            {
              emission_data: {
                error: {
                  code: "PGRST205",
                  message: "Could not find the table 'public.emission_data'",
                },
              },
            },
          );

        const result =
          await checkProductSchema(
            client,
          );

        expect(
          result.status,
        ).toBe("missing");

        expect(
          result.missing_tables,
        ).toEqual(["emission_data"]);
      },
    );

    it(
      "reports every missing table, not just the first one",
      async () => {
        // The real incident had ALL product tables absent -- reporting
        // only the first would understate the problem to whoever is
        // reading the health response during an outage.
        const { client } =
          mockSupabase(
            {
              organizations: { error: { code: "42P01" } },
              shipments: { error: { code: "42P01" } },
              emission_data: { error: { code: "42P01" } },
            },
          );

        const result =
          await checkProductSchema(
            client,
          );

        expect(
          result.status,
        ).toBe("missing");

        expect(
          result.missing_tables.sort(),
        ).toEqual(
          ["emission_data", "organizations", "shipments"],
        );
      },
    );

    it(
      "reports error (not missing) for a non-schema failure such as a connection drop",
      async () => {
        // A network/permission failure must never be reported as
        // "schema missing" -- that would send an operator hunting a
        // migration problem that doesn't exist.
        const { client } =
          mockSupabase(
            {
              organizations: {
                error: {
                  code: "08006",
                  message: "connection failure",
                },
              },
            },
          );

        const result =
          await checkProductSchema(
            client,
          );

        expect(
          result.status,
        ).toBe("error");
      },
    );

    it(
      "treats a thrown query as error rather than letting it escape",
      async () => {
        const client =
          {
            from: () => ({
              select: () => ({
                limit: () =>
                  Promise.reject(
                    new Error("boom"),
                  ),
              }),
            }),
          } as never;

        const result =
          await checkProductSchema(
            client,
          );

        expect(
          result.status,
        ).toBe("error");
      },
    );

    it(
      "issues exactly one lightweight query per probed table",
      async () => {
        // Health checks run on every Railway probe -- this must stay
        // cheap. One bounded query per table, no counts, no scans.
        const probed: string[] = [];

        const { client } =
          mockSupabase(
            {},
            probed,
          );

        await checkProductSchema(
          client,
        );

        expect(
          probed.length,
        ).toBe(
          PRODUCT_SCHEMA_PROBE_TABLES.length,
        );
      },
    );
  },
);

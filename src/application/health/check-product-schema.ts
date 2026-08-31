import type {
  SupabaseClient,
} from "@supabase/supabase-js";

export type ProductSchemaStatus =
  | "ok"
  | "missing"
  | "error";

export interface ProductSchemaCheck {
  status: ProductSchemaStatus;
  missing_tables: string[];
}

/**
 * One representative table per major product subsystem: tenancy
 * (`organizations`), the importer surface (`shipments`), and the producer
 * surface (`emission_data`).
 *
 * Deliberately NOT the full table list. A health check runs on every
 * platform probe, so it stays cheap and bounded; and the failure mode this
 * guards against -- a database that never received the product migrations
 * -- is not subtle. Three probes across three independently-added
 * migration groups is enough to catch both "no product schema at all" and
 * the more plausible "migrations applied only part-way through the
 * sequence", without turning liveness into a schema audit.
 */
export const PRODUCT_SCHEMA_PROBE_TABLES =
  [
    "organizations",
    "shipments",
    "emission_data",
  ] as const;

/**
 * Postgres `undefined_table`, and PostgREST's own schema-cache miss.
 * Either means "this relation is not there", as distinct from a
 * connection/permission failure, which must NOT be reported as a missing
 * schema (see this module's own test).
 */
const MISSING_RELATION_CODES =
  new Set(
    [
      "42P01",
      "PGRST205",
    ],
  );

/**
 * Verifies the minimum product schema the running application depends on.
 *
 * Exists because of a real production incident
 * (docs/plans/P13_RELEASE_READINESS_REPORT.md §16.11/§32): the deployed app
 * reported `/api/health` -> `{"status":"ok"}` while pointed at a Supabase
 * project with FOUR of 57 migrations applied and ZERO product tables. The
 * health route checked only database reachability and the ACTIVE-dataset
 * invariant -- both satisfied by the regulatory foundation alone -- so a
 * completely unusable application read as fully healthy, and the gap was
 * only found by a human driving the UI.
 *
 * This is a READINESS signal, not a liveness one: a process can be alive
 * and correctly serving its own error pages while being unable to do
 * anything useful. See app/api/live/route.ts for the liveness counterpart
 * and docs/architecture/ENVIRONMENT.md's health-check section for how the
 * two are meant to be used.
 *
 * Cost: one bounded, index-free `select id ... limit 1` per probe table
 * (three total). No counts, no scans, no joins.
 */
export async function checkProductSchema(
  supabase: SupabaseClient,
): Promise<ProductSchemaCheck> {
  const missing: string[] =
    [];

  let sawNonSchemaError =
    false;

  for (const table of PRODUCT_SCHEMA_PROBE_TABLES) {
    try {
      const { error } =
        await supabase
          .from(
            table,
          )
          .select(
            "id",
          )
          .limit(
            1,
          );

      if (!error) {
        continue;
      }

      if (
        error.code &&
        MISSING_RELATION_CODES.has(
          error.code,
        )
      ) {
        missing.push(
          table,
        );

        continue;
      }

      sawNonSchemaError =
        true;
    } catch {
      // A rejected query (connection dropped, client misconfigured) is an
      // infrastructure failure, never evidence about the schema.
      sawNonSchemaError =
        true;
    }
  }

  if (missing.length > 0) {
    return {
      status: "missing",
      missing_tables: missing,
    };
  }

  if (sawNonSchemaError) {
    return {
      status: "error",
      missing_tables: [],
    };
  }

  return {
    status: "ok",
    missing_tables: [],
  };
}

import type {
  SupabaseClient,
} from "@supabase/supabase-js";

export type ActiveDefaultEmissionValuesDatasetStatus =
  | "ok"
  | "missing"
  | "duplicate"
  | "error";

export interface ActiveDefaultEmissionValuesDatasetCheck {
  status: ActiveDefaultEmissionValuesDatasetStatus;
  dataset_ids: string[];
}

/**
 * The one regulatory invariant a broken deploy could silently violate:
 * exactly one ACTIVE DEFAULT_EMISSION_VALUES dataset. Factored out of
 * app/api/health/route.ts (which originated this exact query) so
 * app/status/page.tsx's trust surface (master plan §27 screen 6) can
 * report the same invariant a human is looking at, rather than
 * re-deriving it -- two independently-written copies of "what counts as
 * healthy here" is exactly the kind of drift that would let the two
 * surfaces quietly disagree. Status vocabulary ("ok"/"missing"/
 * "duplicate"/"error") is unchanged from the health route's pre-existing
 * HealthCheckResult shape on purpose, so that route's own
 * route.test.ts keeps asserting on values this function still produces
 * byte-for-byte -- this is a pure extraction, not a behavior change.
 *
 * Deliberately does NOT catch a thrown/rejected query (network
 * unreachable, client construction failure upstream) -- that rejection
 * propagates to the caller so each call site's own try/catch stays the
 * single place that decides how to log and degrade, matching
 * app/api/health/route.ts's existing structure exactly.
 */
export async function checkActiveDefaultEmissionValuesDataset(
  supabase: SupabaseClient,
): Promise<ActiveDefaultEmissionValuesDatasetCheck> {
  const { data, error } =
    await supabase
      .from(
        "regulatory_datasets",
      )
      .select(
        "id",
      )
      .eq(
        "dataset_type",
        "DEFAULT_EMISSION_VALUES",
      )
      .eq(
        "status",
        "ACTIVE",
      )
      .limit(
        2,
      );

  if (error) {
    return {
      status: "error",
      dataset_ids: [],
    };
  }

  const rows =
    (data ?? []) as { id: string }[];

  if (rows.length === 0) {
    return {
      status: "missing",
      dataset_ids: [],
    };
  }

  if (rows.length > 1) {
    return {
      status: "duplicate",
      dataset_ids: rows.map((row) => row.id),
    };
  }

  return {
    status: "ok",
    dataset_ids: rows.map((row) => row.id),
  };
}

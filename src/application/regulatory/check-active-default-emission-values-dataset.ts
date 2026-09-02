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

  /**
   * 2026-09-03 (P14, WP-K). WHICH dataset is active, and how many value
   * rows it holds -- reported, never asserted.
   *
   * The status above only ever proved that EXACTLY ONE active dataset
   * row exists. It never looked at which one, or whether it had any
   * values in it at all. So a deploy pointing at an empty or
   * half-loaded dataset reported "ok", and the only way to notice was
   * to run the regulatory verifier by hand.
   *
   * Deliberately not turned into a pass/fail condition here: the
   * application pins no regulatory version, and inventing one in a
   * health check would be a regulatory decision made in the wrong
   * place. The smoke script compares these against values the operator
   * passes in, which keeps the expectation where the operator can see
   * and change it.
   *
   * Null when the status is anything other than "ok" -- there is no
   * single dataset to describe.
   */
  dataset_version: string | null;
  active_row_count: number | null;
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
        "id, version",
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
      dataset_version: null,
      active_row_count: null,
    };
  }

  const rows =
    (data ?? []) as { id: string; version: string }[];

  if (rows.length === 0) {
    return {
      status: "missing",
      dataset_ids: [],
      dataset_version: null,
      active_row_count: null,
    };
  }

  if (rows.length > 1) {
    return {
      status: "duplicate",
      dataset_ids: rows.map((row) => row.id),
      dataset_version: null,
      active_row_count: null,
    };
  }

  const active =
    rows[0]!;

  // Counted with head+count so no value rows cross the wire. A failure
  // here degrades the REPORTED figure to null and never the status:
  // "how many rows does the active dataset hold" is information for an
  // operator, not an availability condition, and a health endpoint that
  // went unhealthy because a count query timed out would be worse than
  // one that says it does not know.
  const { count, error: countError } =
    await supabase
      .from(
        "default_emission_values",
      )
      .select(
        "id",
        { count: "exact", head: true },
      )
      .eq(
        "dataset_id",
        active.id,
      );

  return {
    status: "ok",
    dataset_ids: [active.id],
    dataset_version: active.version,
    active_row_count: countError ? null : count ?? null,
  };
}

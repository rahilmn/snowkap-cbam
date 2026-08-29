import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  IsoDate,
  IsoTimestamp,
} from "../../domain/shared/reporting-period";

const ACTIVE_DATASET_COLUMNS =
  "id, dataset_type, version, status, effective_from, effective_to, source_file_name, source_checksum, imported_at, created_at";

interface ActiveDatasetRow {
  id: string;
  dataset_type: string;
  version: string;
  status: string;
  effective_from: string;
  effective_to: string | null;
  source_file_name: string | null;
  source_checksum: string | null;
  imported_at: string | null;
  created_at: string;
}

/**
 * A read model of one regulatory_datasets row, for the System/status
 * screen's provenance table (master plan §27 screen 6). Deliberately
 * exposes only what that table actually has as of
 * 20260826133116_create_regulatory_foundation.sql -- there is no
 * `verified_at` column, so this never invents one; `imported_at` (when
 * the pipeline loaded the rows) and `created_at` (when this dataset
 * row itself was inserted) are the real provenance timestamps
 * available, and the status page shows exactly those, not a
 * fabricated "verified" concept.
 */
export interface ActiveRegulatoryDataset {
  id: string;
  dataset_type: string;
  version: string;
  status: string;
  effective_from: IsoDate;
  effective_to: IsoDate | null;
  source_file_name: string | null;
  source_checksum: string | null;
  imported_at: IsoTimestamp | null;
  created_at: IsoTimestamp;
}

function toActiveRegulatoryDataset(
  row: ActiveDatasetRow,
): ActiveRegulatoryDataset {
  return {
    id: row.id,
    dataset_type: row.dataset_type,
    version: row.version,
    status: row.status,
    effective_from: row.effective_from as IsoDate,
    effective_to: row.effective_to as IsoDate | null,
    source_file_name: row.source_file_name,
    source_checksum: row.source_checksum,
    imported_at: row.imported_at as IsoTimestamp | null,
    created_at: row.created_at as IsoTimestamp,
  };
}

export type ListActiveRegulatoryDatasetsResult =
  | { status: "ok"; datasets: ActiveRegulatoryDataset[] }
  | { status: "error" };

/**
 * Every ACTIVE regulatory_datasets row, across all seven dataset_type
 * values (CBAM_GOODS, DEFAULT_EMISSION_VALUES, CBAM_BENCHMARKS,
 * CBAM_FACTORS, CSCF, CERTIFICATE_PRICES, COUNTRIES, EXEMPTIONS) --
 * not just DEFAULT_EMISSION_VALUES, which is all app/api/health/route.ts
 * checks. This is the trust surface (master plan §27 screen 6): every
 * regulatory fact this app currently relies on is versioned through a
 * `regulatory_datasets` row (CLAUDE.md's "facts-as-datasets" rule), so
 * the honest status view is "every dataset currently live", not one
 * type. Ordered by dataset_type for a stable, scannable table -- there
 * is no meaningful recency ordering across unrelated dataset types.
 *
 * Regulatory tables carry an authenticated-read RLS policy (see
 * regulatory_datasets_select_authenticated,
 * 20260828100000_authenticated_read_regulatory_data.sql), so this takes
 * the ordinary session-scoped client -- same as every other read on
 * this screen -- never the service-role client app/api/health/route.ts
 * uses (that one runs outside any user session, before Railway's
 * healthcheck has a cookie to scope to).
 *
 * Returns a discriminated {status} result rather than failing closed to
 * `[]` on error, unlike this codebase's other list-services
 * (listAuditEvents, listSharedDataStatus) -- deliberately, because for
 * every *other* list screen "query failed" and "genuinely nothing to
 * show" collapse safely into the same empty-state UI, but this is the
 * one screen whose entire purpose is reporting whether the regulatory
 * foundation is trustworthy. Silently rendering "0 active datasets" for
 * a transient fetch failure would be a false, alarming trust-surface
 * signal (indistinguishable from the real missing-dataset outage
 * app/api/health/route.ts's own `active_regulatory_dataset: "missing"`
 * exists to catch) -- so the caller gets to tell the two apart and
 * render "unable to load dataset status" instead of a fabricated "all
 * clear".
 */
export async function listActiveRegulatoryDatasets(
  supabase: SupabaseClient,
): Promise<ListActiveRegulatoryDatasetsResult> {
  const { data, error } =
    await supabase
      .from("regulatory_datasets")
      .select(
        ACTIVE_DATASET_COLUMNS,
      )
      .eq(
        "status",
        "ACTIVE",
      )
      .order(
        "dataset_type",
        { ascending: true },
      );

  if (error || !data) {
    return {
      status: "error",
    };
  }

  return {
    status: "ok",
    datasets:
      (data as ActiveDatasetRow[]).map(
        toActiveRegulatoryDataset,
      ),
  };
}

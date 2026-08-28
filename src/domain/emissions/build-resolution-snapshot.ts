import type {
  DefaultValueResolutionResult,
} from "../regulatory/types";

import type {
  IsoTimestamp,
} from "../shared/reporting-period";

import type {
  CountryMappingOutcome,
  RegulatoryResolutionSnapshot,
} from "./types";

/**
 * Freezes a resolver result into a self-sufficient snapshot -- or
 * returns null when there is nothing to freeze. `result.status ===
 * "RESOLVED"` is the resolver's own guarantee that `result.record` is
 * non-null and its total_emissions carries a usable AVAILABLE value
 * (see resolveDefaultValue's isUsableTotalValue gate); every other
 * status (REFERENCE_REQUIRED, UNAVAILABLE, NOT_APPLICABLE, AMBIGUOUS,
 * NO_MATCH) means no record was selected, so the caller has a trace
 * and a reason to show but nothing to persist onto the line -- a
 * shipment line's emission_determination stays null until a real
 * resolution succeeds, never a synthetic "unresolved" variant (see
 * EmissionDetermination's two-member union in ./types.ts).
 */
export function buildResolutionSnapshot(
  result: DefaultValueResolutionResult,
  countryMapping: CountryMappingOutcome,
  resolvedAt: IsoTimestamp,
): RegulatoryResolutionSnapshot | null {
  if (result.status !== "RESOLVED" || !result.record) {
    return null;
  }

  const { record } = result;

  return {
    dataset_id: record.dataset_id,
    dataset_version: record.dataset_version,
    resolved_at: resolvedAt,
    reason: result.reason,

    country_mapping: countryMapping,

    record_identity: {
      source_sheet: record.source_sheet,
      source_row: record.source_row,
      source_trade_code: record.source_trade_code,
      origin_country_name: record.origin_country_name,
      source_production_route_code: record.source_production_route_code,
    },

    values: {
      direct: record.direct_emissions,
      indirect: record.indirect_emissions,
      total: record.total_emissions,
    },

    emission_unit: record.emission_unit,
    trace: result.trace,
  };
}

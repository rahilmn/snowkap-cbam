import type {
  CbamGoodSummary,
  DefaultValueResolutionInput,
  ProductionRouteSummary,
  RegulatoryRecord,
} from "../../domain/regulatory/types";

import type {
  CountryMappingOutcome,
} from "../../domain/emissions/types";

export interface RegulatoryRepository {
  findActiveDefaultEmissionCandidates(
    input: DefaultValueResolutionInput,
  ): Promise<RegulatoryRecord[]>;

  /**
   * TRADE_GOOD-level cbam_goods rows, effective as of `asOfDate` (a
   * shipment's own release_date, never "today" -- a line entered now
   * may declare a past release date), whose trade_code exactly equals
   * `tradeCode`. An array, not a single value or null: cbam_goods has
   * no DB-level uniqueness constraint on trade_code, so the caller
   * (the pure classifyGood domain function) decides what 0 / 1 / 2+
   * matches means, rather than this adapter guessing. For P4
   * shipment-line classification (§20).
   */
  findCbamGoodsByCode(
    tradeCode: string,
    asOfDate: string,
  ): Promise<CbamGoodSummary[]>;

  /**
   * TRADE_GOOD-level cbam_goods rows whose trade_code starts with
   * `prefix` -- for the classification combobox's "nearest match"
   * assistance (§20: "UNSUPPORTED_CODE ... with nearest-match
   * assistance, never auto-substitution").
   */
  searchCbamGoodsByPrefix(
    prefix: string,
    limit?: number,
  ): Promise<CbamGoodSummary[]>;

  /**
   * Active production routes, optionally narrowed to one sector -- for
   * the shipment line editor's route picker (§20).
   */
  findProductionRoutes(
    sector?: string,
  ): Promise<ProductionRouteSummary[]>;
}

/**
 * A separate, narrower port (docs/plans/MASTER_PLAN.md §10/§15) from
 * RegulatoryRepository above -- translating a product-side ISO
 * 3166-1 alpha-2 origin_country into the regulatory dataset's own
 * country name is a distinct concern from fetching resolution
 * candidates, even though the current adapter (P5) implements both by
 * querying the same `countries` table. Kept in this file rather than
 * a new one so it shares the existing grandfathered
 * application-layer import exception (see
 * tests/architecture/layering-rules.ts,
 * APPLICATION_GRANDFATHERED_INFRASTRUCTURE_IMPORT) without widening
 * that allowlist.
 */
export interface RegulatoryCountryMapper {
  /**
   * `isoCode` is a product-side CountryCode (src/domain/shared/country.ts)
   * -- always the 2-letter, uppercase, format-validated ISO code, never
   * a display name. Returns UNLISTED (never throws, never guesses) when
   * the code has no row in `countries` at all -- expected and common
   * for EU member states, since CBAM's default-value dataset only
   * publishes country-specific values for non-EU trading partners.
   */
  mapCountry(
    isoCode: string,
  ): Promise<CountryMappingOutcome>;
}
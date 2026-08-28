import type {
  CbamGoodSummary,
  DefaultValueResolutionInput,
  ProductionRouteSummary,
  RegulatoryRecord,
} from "../../domain/regulatory/types";

export interface RegulatoryRepository {
  findActiveDefaultEmissionCandidates(
    input: DefaultValueResolutionInput,
  ): Promise<RegulatoryRecord[]>;

  /**
   * Every cbam_goods row (any record_level) whose trade_code exactly
   * equals `tradeCode` -- an array, not a single value or null,
   * because cbam_goods has no DB-level uniqueness constraint on
   * trade_code, so the caller (the pure classifyGood domain function)
   * decides what 0 / 1 / 2+ matches means, rather than this adapter
   * guessing. For P4 shipment-line classification (§20).
   */
  findCbamGoodsByCode(
    tradeCode: string,
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
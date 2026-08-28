import type {
  CbamGoodSummary,
} from "../regulatory/types";

import type {
  CnCodeLevel,
} from "./types";

export type CnCodeFormatResult =
  | { status: "OK"; level: CnCodeLevel }
  | { status: "INVALID_FORMAT" };

const CN8_PATTERN =
  /^\d{8}$/;

const TARIC10_PATTERN =
  /^\d{10}$/;

/**
 * Format-only validation (§20): does the declared string look like an
 * 8-digit CN code or a 10-digit TARIC code. Existence against the
 * regulatory cbam_goods table is a separate, later check
 * (classifyGood below) -- this function never touches the database.
 */
export function validateCnCodeFormat(
  raw: string,
): CnCodeFormatResult {
  if (CN8_PATTERN.test(raw)) {
    return {
      status: "OK",
      level: "CN8",
    };
  }

  if (TARIC10_PATTERN.test(raw)) {
    return {
      status: "OK",
      level: "TARIC10",
    };
  }

  return {
    status: "INVALID_FORMAT",
  };
}

export type ClassifyGoodResult =
  | { status: "VALID"; good: CbamGoodSummary }
  | { status: "UNSUPPORTED_CODE" }
  | { status: "AMBIGUOUS"; candidates: CbamGoodSummary[] };

/**
 * Decides VALID / UNSUPPORTED_CODE / AMBIGUOUS from the candidates the
 * regulatory adapter's findCbamGoodsByCode already fetched for one
 * exact, already-format-valid trade code (§20) -- this function never
 * queries anything itself, matching the existing regulatory
 * resolver's own "adapter fetches, domain decides" split (§15).
 *
 * No record_level filtering here: cbam_goods_trade_code_format_ck
 * ties trade_code_type (and therefore record_level) to the code's
 * digit length (HS_HEADING=4, HS_SUBHEADING=6, CN=8, TARIC=10), so an
 * already-format-valid 8- or 10-digit input can only ever match rows
 * at the level implied by its own length -- there is no length at
 * which a single input string could match candidates at two different
 * specificities.
 *
 * AMBIGUOUS (more than one candidate) is schema-permitted (cbam_goods
 * has no DB-level uniqueness constraint on trade_code) but not
 * currently reachable against the loaded dataset -- handled
 * defensively rather than assumed impossible.
 */
export function classifyGood(
  candidates: CbamGoodSummary[],
): ClassifyGoodResult {
  if (candidates.length === 0) {
    return {
      status: "UNSUPPORTED_CODE",
    };
  }

  if (candidates.length === 1) {
    return {
      status: "VALID",
      good: candidates[0] as CbamGoodSummary,
    };
  }

  return {
    status: "AMBIGUOUS",
    candidates,
  };
}

export type QuantityKind =
  | "MASS"
  | "ENERGY";

/**
 * Which of ShipmentLine's net_mass_tonnes/quantity_mwh a good
 * requires, from its cbam_goods functional_unit
 * (cbam_goods_functional_unit_check: "TONNES" | "MWH" today). The
 * currently-loaded dataset has no MWH/ELECTRICITY goods, but the
 * schema supports them, so this is not dead code -- see
 * src/infrastructure/regulatory/supabase-regulatory-repository.ts's
 * CbamGoodSummary doc comment.
 */
export function requiredQuantityKind(
  good: CbamGoodSummary,
): QuantityKind {
  return good.functional_unit === "MWH"
    ? "ENERGY"
    : "MASS";
}

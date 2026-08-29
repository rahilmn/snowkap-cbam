import {
  toDecimal,
  toDecimalString,
  type DecimalString,
} from "../shared/decimal";

import type {
  ActualEmissionSnapshot,
  EmissionDetermination,
  RegulatoryResolutionSnapshot,
} from "../emissions/types";

import {
  ENGINE_VERSION,
  type CalculationStep,
  type LineEmissionsCalculation,
} from "./types";

const DEFAULT_RULE_REF =
  "RULE-EE-001";

const ACTUAL_RULE_REF =
  "RULE-EE-009";

/**
 * Owner-directed interim gate (2026-08-29,
 * docs/regulatory/CALCULATION_RULE_REGISTER.md, RULE-EE-009's own
 * Exceptions bullet): RULE-EE-004 requires Annex II goods (iron &
 * steel, aluminium -- Article 7(1) sentence 2) to use direct emissions
 * only, but RULE-EE-009 unconditionally sums direct+indirect and there
 * is no Annex II CN-code-list dataset anywhere in this schema to gate
 * a precise per-good exception -- only the coarser `sector` field
 * already on every `cbam_goods` row in the regulatory dataset. Using
 * that existing regulatory fact (not an invented list) as a
 * conservative, sector-level proxy for "may plausibly be Annex II"
 * until a real Annex II dataset lands, per the owner's explicit
 * decision to gate rather than accept the interim risk.
 */
const ANNEX_II_SECTORS: ReadonlySet<string> =
  new Set(
    [
      "IRON_STEEL",
      "ALUMINIUM",
    ],
  );

function noValueResult(
  status: Exclude<LineEmissionsCalculation["status"], "COMPUTED">,
): LineEmissionsCalculation {
  return {
    status,
    engine_version: ENGINE_VERSION,
  };
}

/**
 * Shared by both determination methods (RULE-EE-001 and RULE-EE-009) --
 * `emissionUnit` is a free-form string, but the two sources that
 * populate it use genuinely different conventions: the regulatory
 * dataset's own `emission_unit` (DEFAULT path) is always spelled out
 * ("TCO2E_PER_TONNE" -- confirmed live, and constrained at the DB layer
 * to exactly {'TCO2E_PER_TONNE','TCO2_PER_MWH'},
 * 20260826133116_create_regulatory_foundation.sql:367-373 -- this
 * function's own "TONNE"/"MWH" checks are only safe for the DEFAULT
 * path *because* of that constraint, not because of anything this
 * function itself verifies), while a producer's freeform
 * `EmissionData.emission_unit` field (ACTUAL path) has NO such
 * constraint (recordEmissionData passes it through unvalidated,
 * src/application/emissions/manage-emission-data.ts) and follows the
 * abbreviated format the producer entry form itself suggests as a
 * placeholder (app/(producer)/emission-data/emission-data-form.tsx:
 * "e.g. tCO2e/t") -- "TONNE" alone does not match "tCO2e/t" (found
 * live while verifying RULE-EE-009 in browser: a real producer-style
 * unit string was incorrectly rejected as UNIT_UNSUPPORTED).
 *
 * A first fix (bare `.includes("/T")`) was itself a bug, found in the
 * mandatory RULE-EE-009 engine review: `tCO2/TJ` (the standard EU ETS
 * MRR emission-factor denominator CBAM's own methodology derives
 * from -- not a contrived string), `tCO2e/TWh`, and `tCO2e/Th` all
 * contain "/T" as a bare substring (TJ/TWh/Th all start with T) while
 * being genuinely energy-denominated, not tonnes-denominated -- that
 * version silently accepted them as mass-basis and computed a
 * fabricated number instead of UNIT_UNSUPPORTED, exactly the failure
 * this guard exists to prevent. Fixed with an anchored pattern: "/T"
 * only counts when NOT immediately followed by another letter/digit
 * (so "/T" and "/t" match, but "/TJ"/"/TWh"/"/Th" do not), plus
 * whitespace normalization so "tCO2e / t" (a space around the slash)
 * isn't spuriously rejected either. Verified against both the original
 * false-negative ("tCO2e/t") and this new false-positive class
 * ("tCO2/TJ", "tCO2e/TWh", "tCO2e/Th") before trusting it.
 *
 * Distinct from -- and unvalidated against -- the *good's*
 * `functional_unit` that P4's classification already checked the
 * line's declared quantity kind against (QUANTITY_UNIT_MISMATCH, a
 * different table). Found in the mandatory P6 review for RULE-EE-001;
 * applied to RULE-EE-009 from the start rather than waiting for its
 * own review to find the same gap.
 *
 * The real fix is an allow-list on EmissionData.emission_unit at entry
 * (a DB CHECK or a small enum, mirroring default_emission_values' own
 * constraint) so the engine stops string-sniffing free text at all --
 * this function remains a stop-gap until that lands, not a permanent
 * design.
 */
function unitMatchesQuantityBasis(
  emissionUnit: string,
  netMassTonnes: DecimalString | null,
): boolean {
  const normalized =
    emissionUnit.toUpperCase().replace(/\s+/g, "");

  // The NUMERATOR must be tonnes-of-CO2e ("TCO2E" or "TCO2") -- this
  // function previously checked only the denominator, so a genuinely
  // standard industrial intensity unit like "kgCO2e/t" passed the "/T"
  // denominator check and was silently treated as if it were "tCO2e/t",
  // overstating embedded emissions 1000x (P13 adversarial audit,
  // live-reproduced). Anchored on this codebase's own two established
  // separator conventions -- a slash ("TCO2E/T") or "_PER_"
  // ("TCO2E_PER_TONNE", the regulatory dataset's own spelling) -- rather
  // than a bare substring check, so "KGCO2E/T"/"KTCO2E/T"/"GCO2E/T"/
  // "LBCO2E/T" are rejected outright instead of only failing the
  // denominator half.
  if (!/^TCO2E?(?:\/|_PER_|$)/.test(normalized)) {
    return false;
  }

  return netMassTonnes !== null
    ? normalized.includes("TONNE") || /\/T(?![A-Z0-9])/.test(normalized)
    : normalized.includes("MWH");
}

function calculateFromDefaultDetermination(
  resolution: RegulatoryResolutionSnapshot,
  quantity: DecimalString,
  netMassTonnes: DecimalString | null,
): LineEmissionsCalculation {
  const { total } =
    resolution.values;

  if (total.status !== "AVAILABLE" || total.value === null) {
    return noValueResult(
      "VALUE_UNAVAILABLE",
    );
  }

  if (!unitMatchesQuantityBasis(resolution.emission_unit, netMassTonnes)) {
    return noValueResult(
      "UNIT_UNSUPPORTED",
    );
  }

  const embeddedEmissionsString =
    toDecimalString(
      toDecimal(quantity).times(
        toDecimal(total.value as DecimalString),
      ),
    );

  const step: CalculationStep =
    {
      step: "LINE_EMBEDDED_EMISSIONS",
      rule_ref: DEFAULT_RULE_REF,
      formula: "line_embedded_emissions = quantity * resolution.values.total.value",
      inputs: {
        quantity: quantity,
        specific_embedded_emissions: total.value,
      },
      value: embeddedEmissionsString,
    };

  return {
    status: "COMPUTED",
    engine_version: ENGINE_VERSION,
    embedded_emissions_tco2e: embeddedEmissionsString,
    steps: [step],
  };
}

/**
 * RULE-EE-009 (docs/regulatory/CALCULATION_RULE_REGISTER.md):
 * line_embedded_emissions = quantity x (direct_specific + indirect_specific).
 * Unlike the DEFAULT path, which trusts the regulatory dataset's own
 * pre-summed `total` rather than re-deriving it, ActualEmissionSnapshot
 * has no pre-summed total -- the direct+indirect summation
 * (Annex IV point 2/3's own `AttrEm_g = DirEm + IndirEm`) is performed
 * here directly.
 *
 * `snapshot.verification.status` is a branded
 * `Extract<VerificationStatus, "VERIFIED">` at the TYPE level
 * (src/domain/emissions/types.ts), but this function re-checks it
 * anyway at runtime -- found in the mandatory RULE-EE-009 engine
 * review: the guarantee is only a compile-time fiction once the
 * snapshot round-trips through `shipment_lines.emission_determination
 * jsonb` (no CHECK constraint on that column,
 * 20260828150000_p4_shipment_intake_schema.sql) and is read back
 * through an unchecked cast (shipment-mapper.ts) -- a value that is
 * NOT "VERIFIED" at runtime would otherwise pass straight through.
 * Same defense-in-depth reasoning RULE-EE-001 already applies to a
 * non-AVAILABLE resolved `total` (that path's own comment: "this rule
 * is the engine's own defense-in-depth check, not a state P5 is
 * expected to produce") -- applied here for consistency rather than
 * relying on the type system alone.
 *
 * `goodSector` gates the Annex II exception RULE-EE-004 requires and
 * this rule's own direct+indirect summation does not yet reintroduce
 * -- see ANNEX_II_SECTORS above and RULE-EE-009's own Exceptions
 * bullet in the register. Only gates when indirect_specific is
 * genuinely non-zero: direct + 0 already equals the Annex II-correct,
 * direct-only value regardless of whether the platform "knows" the
 * good is Annex II, so a producer who has already reported indirect
 * emissions as zero is never blocked by this gate.
 */
function calculateFromActualDetermination(
  snapshot: ActualEmissionSnapshot,
  quantity: DecimalString,
  netMassTonnes: DecimalString | null,
  goodSector: string | null,
): LineEmissionsCalculation {
  if (snapshot.verification.status !== "VERIFIED") {
    return noValueResult(
      "VALUE_UNAVAILABLE",
    );
  }

  if (
    goodSector !== null &&
    ANNEX_II_SECTORS.has(goodSector) &&
    !toDecimal(snapshot.values.indirect_specific).isZero()
  ) {
    return noValueResult(
      "PARAMETER_DATASET_UNAVAILABLE",
    );
  }

  if (!unitMatchesQuantityBasis(snapshot.emission_unit, netMassTonnes)) {
    return noValueResult(
      "UNIT_UNSUPPORTED",
    );
  }

  const specificEmissions =
    toDecimal(snapshot.values.direct_specific).plus(
      toDecimal(snapshot.values.indirect_specific),
    );

  const embeddedEmissionsString =
    toDecimalString(
      toDecimal(quantity).times(
        specificEmissions,
      ),
    );

  const step: CalculationStep =
    {
      step: "LINE_EMBEDDED_EMISSIONS",
      rule_ref: ACTUAL_RULE_REF,
      formula: "line_embedded_emissions = quantity * (direct_specific + indirect_specific)",
      inputs: {
        quantity: quantity,
        direct_specific: snapshot.values.direct_specific,
        indirect_specific: snapshot.values.indirect_specific,
      },
      value: embeddedEmissionsString,
    };

  return {
    status: "COMPUTED",
    engine_version: ENGINE_VERSION,
    embedded_emissions_tco2e: embeddedEmissionsString,
    steps: [step],
  };
}

/**
 * Pure, no I/O, no clock -- same inputs always produce the same output,
 * byte-identical (docs/plans/MASTER_PLAN.md §17). Dispatches to
 * RULE-EE-001 (DEFAULT) or RULE-EE-009 (ACTUAL) depending on the line's
 * determination method -- see docs/regulatory/CALCULATION_RULE_REGISTER.md
 * for both.
 *
 * `good_sector` is the line's declared good's `cbam_goods.sector`
 * (looked up by the caller -- the engine itself does no I/O), used
 * only by the ACTUAL path's Annex II gate (see ANNEX_II_SECTORS
 * above); `null` when the caller has no sector to offer (e.g. a
 * DEFAULT determination, where it is never consulted).
 */
export function calculateLineEmissions(
  line: {
    net_mass_tonnes: DecimalString | null;
    quantity_mwh: DecimalString | null;
    emission_determination: EmissionDetermination | null;
    good_sector?: string | null;
  },
): LineEmissionsCalculation {
  if (!line.emission_determination) {
    return noValueResult(
      "INPUT_UNRESOLVED",
    );
  }

  const quantity =
    line.net_mass_tonnes ??
    line.quantity_mwh;

  if (quantity === null) {
    // Unreachable given isLineQuantityValid's exactly-one-quantity
    // invariant (src/domain/shipments/invariants.ts) -- guarded rather
    // than assumed, so a future invariant change fails loudly here
    // instead of the engine silently computing against a wrong quantity.
    throw new Error(
      "calculateLineEmissions: line has neither net_mass_tonnes nor quantity_mwh.",
    );
  }

  if (line.emission_determination.method === "ACTUAL") {
    return calculateFromActualDetermination(
      line.emission_determination.snapshot,
      quantity,
      line.net_mass_tonnes,
      line.good_sector ?? null,
    );
  }

  return calculateFromDefaultDetermination(
    line.emission_determination.resolution,
    quantity,
    line.net_mass_tonnes,
  );
}

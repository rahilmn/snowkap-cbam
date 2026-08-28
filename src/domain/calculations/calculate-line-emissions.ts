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
 * ("TCO2E_PER_TONNE" -- confirmed live, RULE-EE-001's own register
 * entry), while a producer's freeform `EmissionData.emission_unit`
 * field (ACTUAL path) follows the abbreviated format the producer
 * entry form itself suggests as a placeholder
 * (app/(producer)/emission-data/emission-data-form.tsx: "e.g. tCO2e/t")
 * -- "TONNE" alone does not match "tCO2e/t" (found live while
 * verifying RULE-EE-009 in browser: a real producer-style unit string
 * was incorrectly rejected as UNIT_UNSUPPORTED). "/T" (a slash directly
 * followed by T, as in ".../t") additionally matches the abbreviated
 * mass-basis convention without false-matching "TCO2E_PER_MWH" or
 * "tCO2e/MWh" (neither contains "/T" -- the character after their own
 * slash is "M", not "T"). Purely additive relative to the original
 * "TONNE"-only check: every unit string the DEFAULT path has ever
 * actually produced still matches exactly as before.
 *
 * Distinct from -- and unvalidated against -- the *good's*
 * `functional_unit` that P4's classification already checked the
 * line's declared quantity kind against (QUANTITY_UNIT_MISMATCH, a
 * different table). Found in the mandatory P6 review for RULE-EE-001;
 * applied to RULE-EE-009 from the start rather than waiting for its
 * own review to find the same gap.
 */
function unitMatchesQuantityBasis(
  emissionUnit: string,
  netMassTonnes: DecimalString | null,
): boolean {
  const normalized =
    emissionUnit.toUpperCase();

  return netMassTonnes !== null
    ? normalized.includes("TONNE") || normalized.includes("/T")
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
 * here directly. `snapshot.verification.status` is a branded
 * `Extract<VerificationStatus, "VERIFIED">` at the type level
 * (src/domain/emissions/types.ts) -- a snapshot cannot exist unverified,
 * so this function does not re-check it, the same way the DEFAULT path
 * trusts P5's buildResolutionSnapshot never freezing a non-RESOLVED
 * result.
 */
function calculateFromActualDetermination(
  snapshot: ActualEmissionSnapshot,
  quantity: DecimalString,
  netMassTonnes: DecimalString | null,
): LineEmissionsCalculation {
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
 */
export function calculateLineEmissions(
  line: {
    net_mass_tonnes: DecimalString | null;
    quantity_mwh: DecimalString | null;
    emission_determination: EmissionDetermination | null;
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
    );
  }

  return calculateFromDefaultDetermination(
    line.emission_determination.resolution,
    quantity,
    line.net_mass_tonnes,
  );
}

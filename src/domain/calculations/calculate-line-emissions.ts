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

// The rule that makes Annex II goods direct-only. A REGULATORY FACT,
// already in the register: Regulation (EU) 2023/956 Article 7(1)
// sentence 2, "For goods listed in Annex II only direct emissions shall
// be calculated and taken into account."
const ANNEX_II_RULE_REF =
  "RULE-EE-004";

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
// Exported (2026-09-06, S3) so the default-reference display
// (src/domain/emissions/default-reference.ts) consults this SAME set
// rather than defining its own copy -- "do not duplicate
// classification logic" applies to this proxy exactly as it would to
// a real dataset.
export const ANNEX_II_SECTORS: ReadonlySet<string> =
  new Set(
    [
      "IRON_STEEL",
      "ALUMINIUM",
    ],
  );

/**
 * 2026-09-03 -- OWNER DECISION D1. What this set now DOES, and the risk
 * that comes with it.
 *
 * Until today, an ACTUAL-method line on a good in one of these sectors
 * with non-zero indirect emissions returned
 * PARAMETER_DATASET_UNAVAILABLE and produced no number at all. That was
 * a deliberate 2026-08-29 interim gate, and it was too restrictive: it
 * blocked an entire legitimate workflow because indirect data merely
 * EXISTED, when the applicable treatment is simply to leave that data
 * out of the CBAM figure.
 *
 * The engine now applies the treatment instead of refusing: for these
 * sectors, embedded emissions are computed from direct emissions alone.
 * Indirect emissions remain stored on the producer's record and frozen
 * in the snapshot -- they are source data, and they are not deleted or
 * zeroed -- they are simply not added to the CBAM-relevant result. The
 * trace records the exclusion and names the rule, so the number can be
 * explained without reading this file.
 *
 * THE RISK, WHICH HAS CHANGED DIRECTION AND MUST NOT BE GLOSSED.
 *
 * `sector` is a PROXY. Annex II is a CN-code-level list; `cbam_goods`
 * carries no Annex II membership field at all, only this coarser
 * sector. Building the real list is a versioned-dataset ingestion pass
 * (CLAUDE.md's facts-as-datasets rule forbids hardcoding it here), and
 * it has not been done.
 *
 * While the proxy REFUSED, its imprecision was conservative: a
 * non-Annex-II good in these sectors was blocked needlessly, which is
 * annoying and safe. Now that the proxy APPLIES an exclusion, the same
 * imprecision points the other way: such a good would have its indirect
 * emissions excluded and would be UNDER-reported.
 *
 * That is the accepted cost of the owner's decision, recorded here, in
 * the calculation rule register, and in the release report -- not
 * discovered later from a wrong number. The real fix remains a properly
 * sourced, versioned Annex II CN-code dataset.
 *
 * Two things this deliberately does NOT do:
 *
 *   - It does not touch the DEFAULT path. RULE-EE-001 trusts the
 *     published dataset's own pre-summed total, which is already
 *     Annex-II-correct at source; recomputing there would be the exact
 *     violation RULE-EE-004 warns about.
 *   - It does not gate on a null sector. A good whose sector could not
 *     be resolved is unknown, not Annex II, and the engine does not
 *     guess in either direction.
 */

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

  // 2026-09-03 (P14 remediation). The DENOMINATOR must be an exact
  // token, not a substring.
  //
  // This previously read
  //   normalized.includes("TONNE") || /\/T(?![A-Z0-9])/.test(normalized)
  // and "KILOTONNE" contains "TONNE". Verified live before this fix:
  // `tCO2e/kilotonne`, `tCO2e/megatonne`, `TCO2E_PER_KILOTONNE` and
  // `TCO2E_PER_MEGATONNE` were all COMPUTED, at 1:1 -- a 1,000x and
  // 1,000,000x overstatement of the regulated figure, produced by the
  // trusted path from honest data.
  //
  // It matters because emission_data.emission_unit is an unconstrained
  // text column that a producer types into, and the ACTUAL branch
  // carries it straight into the engine. The unit guard is the only
  // wall between a free-text field and the number that gets filed.
  //
  // This is the SECOND time this function has been fixed for the same
  // shape of defect: the numerator check above exists because
  // "kgCO2e/t" passed a denominator-only test and overstated by 1000x
  // (P13). The lesson both times is that a substring test on a unit
  // string is not a unit check -- so the denominator is now split out
  // and compared against an exact allowlist, which is checkable by
  // reading rather than by imagining the strings that might match.
  //
  // Splitting on the two separator conventions this codebase uses -- a
  // slash, and "_PER_" (the regulatory dataset's own spelling).
  const denominator =
    normalized.includes("_PER_")
      ? normalized.split("_PER_").slice(1).join("_PER_")
      : normalized.slice(normalized.indexOf("/") + 1);

  // "tCO2e/t/yr" and "tCO2e/t-year" are refused by this too, and were
  // COMPUTED before -- the old `/T(?![A-Z0-9])` lookahead admitted any
  // non-alphanumeric suffix. They were a recorded follow-up defect
  // (tests/golden/fixtures pinned today's behaviour rather than the
  // right one); the exact-token rule closes them as a side effect,
  // which is why the goldens for them flip in the same change.
  return netMassTonnes !== null
    ? denominator === "T" || denominator === "TONNE" || denominator === "TONNES"
    : denominator === "MWH";
}

function calculateFromDefaultDetermination(
  resolution: RegulatoryResolutionSnapshot,
  quantity: DecimalString,
  netMassTonnes: DecimalString | null,
): LineEmissionsCalculation {
  // 2026-09-07 (S5 review round 3, finding S5R3-A-B1). `resolution` is
  // typed as required on the DEFAULT branch of EmissionDetermination,
  // but -- exactly as determinationDatasetIsCurrent's own comment
  // documents for the same field
  // (src/domain/emissions/determination-dataset-currency.ts) -- that
  // promise is a compile-time fiction for a row frozen before this
  // field existed: EmissionDetermination round-trips through
  // shipment_lines.emission_determination jsonb (no CHECK constraint)
  // and back through an unchecked cast. Live-reproduced against three
  // real rows in the local database that carry
  // {"method":"DEFAULT","resolved_value_id":null} with no `resolution`
  // key at all: calling this engine against any of them previously
  // threw "Cannot destructure property 'values' of 'undefined'" --
  // an unhandled exception out of the pure calculation engine itself,
  // from the primary Calculate/Recalculate Server Action, for exactly
  // the kind of state this file's own CalculationStatus contract
  // (src/domain/calculations/types.ts) says must come back as a named
  // outcome, never a thrown error. VALUE_UNAVAILABLE is the same
  // status this function already returns for a resolved-but-not-
  // AVAILABLE total -- an unresolved legacy shape belongs in the same
  // bucket, not a crash.
  if (!resolution?.values?.total) {
    return noValueResult(
      "VALUE_UNAVAILABLE",
    );
  }

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
  // 2026-09-07 (S5 review round 3, finding S5R3-A-B1, prophylactic --
  // no legacy-shape ACTUAL row exists in the local database today, but
  // the same "compile-time-only" gap the DEFAULT branch just closed
  // above applies symmetrically here: `snapshot` is typed as required
  // on the ACTUAL branch of EmissionDetermination, and that promise is
  // equally a compile-time fiction for the same unchecked-jsonb-cast
  // reason. Guarding here rather than waiting for a real row to prove
  // it, since the failure mode (an unhandled exception from a pure
  // engine) is identical either way.
  if (!snapshot?.verification) {
    return noValueResult(
      "VALUE_UNAVAILABLE",
    );
  }

  if (snapshot.verification.status !== "VERIFIED") {
    return noValueResult(
      "VALUE_UNAVAILABLE",
    );
  }

  // 2026-09-07 (S5 review round 6, finding S5R6-NUM-B). The guard just
  // above (and round 3's own S5R3-A-B1 fix it belongs to) only checked
  // that `snapshot` itself exists, not that its own required sub-fields
  // do -- the exact depth the DEFAULT branch's sibling guard above
  // (`!resolution?.values?.total`) already gets right. `values` and
  // `emission_unit` are, like `verification`, compile-time-required but
  // not runtime-guaranteed for a row frozen before either field
  // existed. Live-reproduced: a hand-built snapshot with `verification`
  // present and VERIFIED but no `values` key threw `TypeError: Cannot
  // read properties of undefined (reading 'direct_specific')` at the
  // `snapshot.values.direct_specific` dereference below; one with
  // `values` present but no `emission_unit` threw inside
  // unitMatchesQuantityBasis on the very next line.
  if (
    !snapshot.values?.direct_specific ||
    !snapshot.values?.indirect_specific ||
    !snapshot.emission_unit
  ) {
    return noValueResult(
      "VALUE_UNAVAILABLE",
    );
  }

  if (!unitMatchesQuantityBasis(snapshot.emission_unit, netMassTonnes)) {
    return noValueResult(
      "UNIT_UNSUPPORTED",
    );
  }

  // 2026-09-03 (owner decision D1). Annex II goods are direct-only.
  // See ANNEX_II_SECTORS above for what this proxy can and cannot
  // establish, and for the under-reporting risk its imprecision now
  // carries.
  //
  // Applied whether or not indirect emissions are zero. When they are
  // zero the arithmetic is identical either way, but the TRACE is not:
  // a reader of a frozen calculation must be able to see that the
  // Annex II treatment was applied, not infer it from a number that
  // happens to match.
  const annexIiDirectOnly =
    goodSector !== null &&
    ANNEX_II_SECTORS.has(goodSector);

  const steps: CalculationStep[] =
    [];

  if (annexIiDirectOnly) {
    steps.push(
      {
        step: "ANNEX_II_DIRECT_ONLY",
        rule_ref: ANNEX_II_RULE_REF,
        formula: "specific_emissions = direct_specific",
        inputs: {
          good_sector: goodSector,
          direct_specific: snapshot.values.direct_specific,
          // Recorded, not used. The producer reported this figure and
          // it stays visible in the trace; what the trace shows is
          // that it was deliberately left out of the result, which is
          // a different and much more useful thing than it being
          // absent.
          indirect_specific_excluded: snapshot.values.indirect_specific,
        },
        value: snapshot.values.direct_specific,
      },
    );
  }

  const specificEmissions =
    annexIiDirectOnly
      ? toDecimal(snapshot.values.direct_specific)
      : toDecimal(snapshot.values.direct_specific).plus(
          toDecimal(snapshot.values.indirect_specific),
        );

  const embeddedEmissionsString =
    toDecimalString(
      toDecimal(quantity).times(
        specificEmissions,
      ),
    );

  steps.push(
    {
      step: "LINE_EMBEDDED_EMISSIONS",
      rule_ref: ACTUAL_RULE_REF,
      formula:
        annexIiDirectOnly
          ? "line_embedded_emissions = quantity * direct_specific"
          : "line_embedded_emissions = quantity * (direct_specific + indirect_specific)",
      inputs:
        annexIiDirectOnly
          ? {
              quantity: quantity,
              direct_specific: snapshot.values.direct_specific,
            }
          : {
              quantity: quantity,
              direct_specific: snapshot.values.direct_specific,
              indirect_specific: snapshot.values.indirect_specific,
            },
      value: embeddedEmissionsString,
    },
  );

  return {
    status: "COMPUTED",
    engine_version: ENGINE_VERSION,
    embedded_emissions_tco2e: embeddedEmissionsString,
    steps,
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

import type {
  CalculationResultId,
  OrganizationId,
  ShipmentId,
  ShipmentLineId,
} from "../shared/ids";

import type {
  DecimalString,
  MoneyEUR,
} from "../shared/decimal";

import type {
  IsoTimestamp,
} from "../shared/reporting-period";

import type {
  EmissionDetermination,
} from "../emissions/types";

/**
 * Bumped on any behavioral change to the engine (a new/changed rule, a
 * different rounding policy, a different trace shape) -- see
 * docs/plans/MASTER_PLAN.md §17: "same inputs + version => byte-identical
 * output, re-provable on demand." Every CalculationResult carries the
 * engine_version that produced it, never recomputed silently against a
 * newer version.
 */
export type EngineVersion =
  string;

export const ENGINE_VERSION: EngineVersion =
  "1.1.0";

/**
 * Identifies one ACTIVE regulatory dataset the calculation engine read
 * (beyond the DEFAULT_EMISSION_VALUES dataset already captured inside
 * the line's own EmissionDetermination snapshot) — e.g. a MARKUPS,
 * BENCHMARKS, CERTIFICATE_PRICES, or EXEMPTIONS dataset, once those
 * exist. See docs/regulatory/CALCULATION_RULE_REGISTER.md (authored
 * before the calculation-engine phase) for which dataset types govern
 * which calculation components.
 */
export interface CalculationParameterDataset {
  dataset_id: string;
  dataset_type: string;
  dataset_version: string;
}

/**
 * One step of a calculation's trace. `rule_ref` points at the
 * calculation-rule register entry that justifies this step — the
 * engine never applies a formula that isn't registered there.
 */
export interface CalculationStep {
  step: string;
  rule_ref: string;
  formula: string;
  inputs: Record<string, string>;
  value: DecimalString;
}

export type CalculationQuantityUnit =
  | "TONNES"
  | "MWH";

export interface CalculationOutputs {
  embedded_emissions_tco2e: DecimalString;

  // Both remain null until the parameter datasets a liability estimate
  // depends on (markups, benchmarks, certificate prices) are ACTIVE —
  // see docs/architecture, "Calculation Engine": embedded-emissions
  // calculation and liability estimation are never conflated.
  certificates_due: DecimalString | null;
  liability: MoneyEUR | null;
}

/**
 * An append-only record of one calculation run. Never updated —
 * recalculation (e.g. after a re-determination) creates a new
 * CalculationResult row; superseded results remain queryable for audit
 * (see docs/architecture, "Auditability").
 */
export interface CalculationResult {
  id: CalculationResultId;
  org_id: OrganizationId;
  line_id: ShipmentLineId;
  shipment_id: ShipmentId;

  engine_version: string;
  parameter_datasets: CalculationParameterDataset[];

  inputs: {
    quantity: DecimalString;
    quantity_unit: CalculationQuantityUnit;
    determination: EmissionDetermination;
  };

  steps: CalculationStep[];
  outputs: CalculationOutputs;

  calculated_at: IsoTimestamp;
  correlation_id: string | null;
}

/**
 * The pure engine's own return shape (calculate-line-emissions.ts) --
 * distinct from CalculationResult above, which is the *persisted*
 * record and therefore assumes a successful computation (outputs.
 * embedded_emissions_tco2e is non-nullable). Only a COMPUTED result is
 * ever turned into a CalculationResult row -- mirroring how P5's
 * resolveLineEmissions never persists an UNRESOLVED attempt either
 * (src/application/emissions/resolve-line-emissions.ts): every other
 * status here is an explicit non-computable outcome
 * (docs/regulatory/CALCULATION_RULE_REGISTER.md RULE-EE-005) that the
 * caller surfaces for that render/response only, never zero, never
 * fabricated, and never written to calculation_results.
 *
 * - INPUT_UNRESOLVED: the line has no emission_determination at all.
 * - VALUE_UNAVAILABLE: defense-in-depth only, in both methods --
 *   (DEFAULT) a resolved total value is not AVAILABLE, though P5's
 *   buildResolutionSnapshot never freezes a non-AVAILABLE total in
 *   practice; (ACTUAL, P7/RULE-EE-009) a snapshot's verification.status
 *   is not "VERIFIED", though that is a branded, type-level-only
 *   guarantee (Extract<VerificationStatus, "VERIFIED">) that does not
 *   survive the round-trip through shipment_lines.emission_determination
 *   jsonb (no CHECK constraint on that column) and back through an
 *   unchecked cast. Neither case should occur in practice, but the
 *   engine checks rather than trusting that, mirroring each other.
 * - UNIT_UNSUPPORTED: the determination's emission_unit (a free-form
 *   string -- from the regulatory dataset for DEFAULT, RegulatoryRecord.
 *   emission_unit; producer-entered for ACTUAL, EmissionData.emission_unit)
 *   is not consistent with the line's own quantity basis (TONNES vs
 *   MWH). P4's QUANTITY_UNIT_MISMATCH check already validates the
 *   *good's* functional_unit against the declared quantity kind at
 *   classification time -- a different table (cbam_goods) from the
 *   *emission record's own* emission_unit, which nothing else
 *   validates. Found in the mandatory P6 review for RULE-EE-001;
 *   applied to RULE-EE-009 (ACTUAL) from the start. **Known,
 *   escalated gap** (docs/regulatory/CALCULATION_RULE_REGISTER.md,
 *   RULE-EE-009's own Exceptions bullet): this guard alone does not
 *   detect an Annex II good using the ACTUAL method with a non-zero
 *   indirect_specific -- there is no Annex II membership data anywhere
 *   in this schema yet, so RULE-EE-009 can currently overstate embedded
 *   emissions for iron & steel / aluminium ACTUAL-method lines. Not
 *   patched here -- needs a new versioned regulatory dataset, escalated
 *   to the owner rather than hardcoded.
 *
 * ACTUAL_METHOD_NOT_YET_SUPPORTED existed here through P6 (RULE-EE-002/
 * 003 registered but not implemented) and was removed once RULE-EE-009
 * implemented the ACTUAL-method branch in P7 -- an ACTUAL determination
 * now returns COMPUTED (or one of the non-computable statuses above,
 * same as DEFAULT), never a separate not-yet-supported status.
 */
export type CalculationStatus =
  | "COMPUTED"
  | "INPUT_UNRESOLVED"
  | "VALUE_UNAVAILABLE"
  | "UNIT_UNSUPPORTED";

export type LineEmissionsCalculation =
  | {
      status: "COMPUTED";
      engine_version: EngineVersion;
      embedded_emissions_tco2e: DecimalString;
      steps: CalculationStep[];
    }
  | {
      status: Exclude<CalculationStatus, "COMPUTED">;
      engine_version: EngineVersion;
    };

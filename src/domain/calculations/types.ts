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
  "1.0.0";

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
 * - VALUE_UNAVAILABLE: a DEFAULT determination's resolved total value
 *   is not AVAILABLE -- defense-in-depth only; P5's
 *   buildResolutionSnapshot never freezes a non-AVAILABLE total, so
 *   this should not occur in practice, but the engine checks rather
 *   than trusting that.
 * - ACTUAL_METHOD_NOT_YET_SUPPORTED: the determination method is
 *   ACTUAL (RULE-EE-002/003, P7 scope) -- registered but not
 *   implemented in this phase.
 * - UNIT_UNSUPPORTED: the resolved snapshot's emission_unit (a
 *   free-form string from the regulatory dataset, RegulatoryRecord.
 *   emission_unit) is not consistent with the line's own quantity
 *   basis (TONNES vs MWH). P4's QUANTITY_UNIT_MISMATCH check already
 *   validates the *good's* functional_unit against the declared
 *   quantity kind at classification time -- a different table
 *   (cbam_goods) from the *emission record's own* emission_unit
 *   (default_emission_values), which nothing else validates. Found in
 *   the mandatory P6 review: RULE-EE-001 assumed this could never
 *   diverge without an explicit guard.
 */
export type CalculationStatus =
  | "COMPUTED"
  | "INPUT_UNRESOLVED"
  | "VALUE_UNAVAILABLE"
  | "ACTUAL_METHOD_NOT_YET_SUPPORTED"
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

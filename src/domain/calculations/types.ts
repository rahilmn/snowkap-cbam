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

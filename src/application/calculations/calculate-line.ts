import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import {
  calculateLineEmissions,
} from "../../domain/calculations/calculate-line-emissions";

import type {
  CalculationQuantityUnit,
  LineEmissionsCalculation,
} from "../../domain/calculations/types";

import type {
  EmissionDetermination,
} from "../../domain/emissions/types";

import type {
  DecimalString,
} from "../../domain/shared/decimal";

import type {
  OrganizationId,
  ShipmentLineId,
  UserId,
} from "../../domain/shared/ids";

import {
  recordAuditEvent,
} from "../audit/record-audit-event";

export type CalculateLineRejectionReason =
  | "LINE_NOT_FOUND"
  | "FETCH_FAILED"
  | "PERSIST_FAILED";

export type CalculateLineResult =
  | { status: "OK"; calculation: LineEmissionsCalculation }
  | { status: "REJECTED"; reason: CalculateLineRejectionReason };

interface LineForCalculation {
  org_id: string;
  shipment_id: string;
  net_mass_tonnes: DecimalString | null;
  quantity_mwh: DecimalString | null;
  emission_determination: EmissionDetermination | null;
}

function quantityInput(
  line: LineForCalculation,
): { quantity: DecimalString; quantity_unit: CalculationQuantityUnit } {
  return line.net_mass_tonnes !== null
    ? { quantity: line.net_mass_tonnes, quantity_unit: "TONNES" }
    : { quantity: line.quantity_mwh as DecimalString, quantity_unit: "MWH" };
}

/**
 * Runs the pure engine (calculateLineEmissions, RULE-EE-001) against a
 * shipment line. Only a COMPUTED result is persisted to
 * calculation_results, as a new row -- "appends," not "writes,"
 * because recalculation is always a new row
 * (docs/plans/MASTER_PLAN.md §6/§12); this function never updates a
 * prior calculation_results row. A non-computable outcome
 * (INPUT_UNRESOLVED / VALUE_UNAVAILABLE / ACTUAL_METHOD_NOT_YET_SUPPORTED)
 * is returned to the caller but never written -- same precedent as
 * P5's resolve-line-emissions.ts never persisting an UNRESOLVED
 * attempt.
 *
 * Verifies the fetched line's own org_id against the caller's orgId
 * before proceeding (same defense the P5 mandatory review added to
 * resolve-line-emissions.ts's fetchLineForResolution -- orgId here is
 * the caller's *active* org, not yet proven to be the org that owns
 * this specific line).
 */
export async function calculateLine(
  supabase: SupabaseClient,
  orgId: OrganizationId,
  actorUserId: UserId,
  lineId: ShipmentLineId,
): Promise<CalculateLineResult> {
  const { data, error } =
    await supabase
      .from("shipment_lines")
      .select(
        "org_id, shipment_id, net_mass_tonnes, quantity_mwh, emission_determination",
      )
      .eq("id", lineId)
      .maybeSingle();

  if (error) {
    return {
      status: "REJECTED",
      reason: "FETCH_FAILED",
    };
  }

  if (!data) {
    return {
      status: "REJECTED",
      reason: "LINE_NOT_FOUND",
    };
  }

  const line =
    data as LineForCalculation;

  if (line.org_id !== orgId) {
    return {
      status: "REJECTED",
      reason: "LINE_NOT_FOUND",
    };
  }

  const calculation =
    calculateLineEmissions(
      {
        net_mass_tonnes: line.net_mass_tonnes,
        quantity_mwh: line.quantity_mwh,
        emission_determination: line.emission_determination,
      },
    );

  if (calculation.status !== "COMPUTED") {
    return {
      status: "OK",
      calculation,
    };
  }

  const { error: insertError } =
    await supabase
      .from("calculation_results")
      .insert(
        {
          org_id: orgId,
          line_id: lineId,
          shipment_id: line.shipment_id,
          engine_version: calculation.engine_version,
          parameter_datasets: [],
          ...quantityInput(
            line,
          ),
          determination: line.emission_determination,
          steps: calculation.steps,
          embedded_emissions_tco2e: calculation.embedded_emissions_tco2e,
          calculated_by_user_id: actorUserId,
        },
      );

  if (insertError) {
    return {
      status: "REJECTED",
      reason: "PERSIST_FAILED",
    };
  }

  await recordAuditEvent(
    supabase,
    {
      orgId,
      actorUserId,
      eventType: "calculation.computed",
      aggregateType: "SHIPMENT_LINE",
      aggregateId: lineId,
      payload: {
        shipment_id: line.shipment_id,
        engine_version: calculation.engine_version,
        embedded_emissions_tco2e: calculation.embedded_emissions_tco2e,
      },
    },
  );

  return {
    status: "OK",
    calculation,
  };
}

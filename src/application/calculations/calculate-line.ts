import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import {
  randomUUID,
} from "node:crypto";

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
  ShipmentLineId,
} from "../../domain/shared/ids";

import type {
  RegulatoryRepository,
} from "../../infrastructure/regulatory/regulatory-repository";

import {
  hasCapability,
  type OrgContext,
} from "../organizations/org-context";

import {
  recordAuditEvent,
} from "../audit/record-audit-event";

import type {
  CalculationResultWriter,
} from "./calculation-result-writer";

export type CalculateLineRejectionReason =
  | "LINE_NOT_FOUND"
  | "FETCH_FAILED"
  | "PERSIST_FAILED"
  | "SHIPMENT_NOT_EDITABLE"
  // The caller's org doesn't hold IMPORTER_DECLARANT -- calculating a
  // shipment line's embedded emissions is an importer-only workflow
  // (master plan §6/§14). Checked BEFORE any database read, same
  // posture as every hasAdminAccess gate elsewhere in this codebase
  // (P10/P11 capability-matrix hardening pass -- see
  // docs/architecture/AUTHORIZATION_MATRIX.md's "Capability
  // enforcement" section).
  | "CAPABILITY_NOT_HELD"
  // The line's determination or quantity changed between this function
  // reading it and the trusted write channel checking it again. Only
  // reachable under a concurrent edit: this service reads the line,
  // computes from that line, and writes the same values back within one
  // request. Surfaced as its own reason rather than folded into
  // PERSIST_FAILED because the user's next step is different -- reload
  // and recalculate, not "try again."
  | "CALCULATION_INPUTS_CHANGED"
  // The acting user is no longer a live member of the owning
  // organization. The RPC re-checks this because, writing under the
  // service role, `auth.uid()` is null and attribution arrives as a
  // parameter -- a claim, which gets re-authorized rather than believed.
  | "ACTOR_NO_LONGER_A_MEMBER";

export type CalculateLineResult =
  | { status: "OK"; calculation: LineEmissionsCalculation }
  | { status: "REJECTED"; reason: CalculateLineRejectionReason };

interface LineForCalculation {
  org_id: string;
  shipment_id: string;
  cn_code: string;
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
 * The engine's Annex II gate (calculate-line-emissions.ts,
 * ANNEX_II_SECTORS) needs the line's declared good's `cbam_goods.sector`
 * -- data this pure engine cannot fetch itself. Only called for ACTUAL
 * determinations (the DEFAULT path never consults good_sector, since
 * RULE-EE-001 already trusts the dataset's own Annex-II-correct total).
 * `findCbamGoodsByCode` needs an as-of date the same way classification
 * does (a shipment's own release_date, never "today" -- P4's own
 * doc comment on this port method) -- a second, separate query, matching
 * this codebase's convention of sequential queries over embedded joins
 * (see the regulatory adapter's own five-sequential-query design).
 *
 * Returns `null` -- not a rejection -- when the shipment's release_date
 * can't be found or no matching good exists: an already-classified line
 * reaching ACTUAL determination should always have exactly one match,
 * so this is an unexpected-data-drift case, not a normal outcome; the
 * engine's own `good_sector: null` handling already treats "unknown" as
 * "don't gate" (conservative in the other direction is not this
 * function's job -- see calculate-line-emissions.ts's own doc comment
 * on why an indeterminate sector does not block calculation).
 */
export async function resolveGoodSectorForActualLine(
  supabase: SupabaseClient,
  repository: RegulatoryRepository,
  shipmentId: string,
  cnCode: string,
): Promise<string | null> {
  const { data: shipment } =
    await supabase
      .from("shipments")
      .select(
        "release_date",
      )
      .eq("id", shipmentId)
      .maybeSingle();

  if (!shipment) {
    return null;
  }

  const candidates =
    await repository.findCbamGoodsByCode(
      cnCode,
      (shipment as { release_date: string }).release_date,
    );

  return candidates[0]?.sector ?? null;
}

/**
 * Runs the pure engine (calculateLineEmissions, RULE-EE-001 for DEFAULT
 * determinations / RULE-EE-009 for ACTUAL ones) against a shipment
 * line. Only a COMPUTED result is persisted to calculation_results, as
 * a new row -- "appends," not "writes," because recalculation is
 * always a new row (docs/plans/MASTER_PLAN.md §6/§12); this function
 * never updates a prior calculation_results row. A non-computable
 * outcome (INPUT_UNRESOLVED / VALUE_UNAVAILABLE / UNIT_UNSUPPORTED)
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
  repository: RegulatoryRepository,
  writer: CalculationResultWriter,
  context: OrgContext,
  lineId: ShipmentLineId,
): Promise<CalculateLineResult> {
  if (!hasCapability(context, "IMPORTER_DECLARANT")) {
    return {
      status: "REJECTED",
      reason: "CAPABILITY_NOT_HELD",
    };
  }

  const orgId =
    context.org_id;

  const actorUserId =
    context.user_id;

  const { data, error } =
    await supabase
      .from("shipment_lines")
      .select(
        "org_id, shipment_id, cn_code, net_mass_tonnes, quantity_mwh, emission_determination",
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

  const goodSector =
    line.emission_determination?.method === "ACTUAL"
      ? await resolveGoodSectorForActualLine(
          supabase,
          repository,
          line.shipment_id,
          line.cn_code,
        )
      : null;

  const calculation =
    calculateLineEmissions(
      {
        net_mass_tonnes: line.net_mass_tonnes,
        quantity_mwh: line.quantity_mwh,
        emission_determination: line.emission_determination,
        good_sector: goodSector,
      },
    );

  if (calculation.status !== "COMPUTED") {
    return {
      status: "OK",
      calculation,
    };
  }

  // Shared between this row and its audit event so the two can be
  // cross-checked later.
  //
  // 2026-09-03 (P14.1). This used to be a direct
  // `supabase.from("calculation_results").insert(...)` as the signed-in
  // member, and the comment here used to say the real fix -- "routing
  // writes through a SECURITY DEFINER RPC that recomputes and compares,
  // or removing direct INSERT entirely" -- was a materially larger
  // change than that pass could take. It was, and it has now been
  // taken, because the class it described turned out to be reachable
  // all the way into a filed declaration: a member posting raw
  // PostgREST could write this line's real determination and real
  // quantity beside a fabricated embedded_emissions_tco2e, and
  // record_declaration_filed froze it into an immutable snapshot.
  // Reproduced live at 0.001 against a true 139.
  //
  // Of the two options that comment named, "recomputes and compares" is
  // not available: the engine is this file's own
  // calculateLineEmissions, and a plpgsql copy of RULE-EE-001/EE-009,
  // the Annex II direct-only rule and decimal.js semantics would be a
  // second, silently diverging implementation of regulatory behaviour.
  // So the other one was taken -- `20260903190000` revoked INSERT from
  // anon and authenticated outright, and the only write channel left is
  // record_calculation_result, granted to service_role alone.
  const correlationId =
    randomUUID();

  if (line.emission_determination === null) {
    // Unreachable through the engine: calculateLineEmissions returns
    // INPUT_UNRESOLVED, never COMPUTED, for a line carrying no
    // determination, and only a COMPUTED result reaches this point. It
    // is checked anyway because the port's type says a determination is
    // required and this is the one place that claim is made -- the old
    // direct INSERT passed the nullable value straight through into an
    // untyped insert, where nothing ever asked the question.
    return {
      status: "REJECTED",
      reason: "CALCULATION_INPUTS_CHANGED",
    };
  }

  const persisted =
    await writer.recordCalculationResult(
      {
        org_id: orgId,
        line_id: lineId,
        calculated_by_user_id: actorUserId,
        engine_version: calculation.engine_version,
        parameter_datasets: [],
        ...quantityInput(
          line,
        ),
        determination: line.emission_determination,
        steps: calculation.steps,
        embedded_emissions_tco2e: calculation.embedded_emissions_tco2e,
        correlation_id: correlationId,
      },
    );

  if (persisted.status === "FAILED") {
    return {
      status: "REJECTED",
      reason: "PERSIST_FAILED",
    };
  }

  if (persisted.status === "REJECTED") {
    return {
      status: "REJECTED",
      reason:
        persisted.reason === "SHIPMENT_NOT_EDITABLE"
          ? "SHIPMENT_NOT_EDITABLE"
          : persisted.reason === "LINE_NOT_FOUND"
            ? "LINE_NOT_FOUND"
            : persisted.reason === "ACTOR_NOT_A_MEMBER"
              ? "ACTOR_NO_LONGER_A_MEMBER"
              : persisted.reason === "CAPABILITY_NOT_HELD"
                ? "CAPABILITY_NOT_HELD"
              // DETERMINATION_MISMATCH / QUANTITY_MISMATCH /
              // LINE_HAS_NO_QUANTITY. All three mean the same thing to
              // the person at the screen: what was calculated is not
              // what the line says now.
              : "CALCULATION_INPUTS_CHANGED",
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
      correlationId,
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

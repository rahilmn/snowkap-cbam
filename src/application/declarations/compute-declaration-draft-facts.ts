import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import {
  buildCompletenessReport,
  type CompletenessCheckShipment,
} from "../../domain/declarations/completeness";

import type {
  CompletenessReport,
} from "../../domain/declarations/types";

import type {
  OrganizationId,
  ShipmentId,
} from "../../domain/shared/ids";

import type {
  IsoTimestamp,
  ReportingPeriod,
} from "../../domain/shared/reporting-period";

import type {
  ShipmentStatus,
} from "../../domain/shipments/types";

import {
  listPeriodShipmentLines,
  type PeriodShipmentLine,
} from "../reporting/list-period-shipment-lines";

import {
  periodColumns,
} from "./declaration-mapper";

export interface DeclarationDraftFacts {
  member_shipment_ids: ShipmentId[];
  completeness_report: CompletenessReport;
}

interface ShipmentStatusRow {
  id: string;
  reference: string;
  status: ShipmentStatus;
}

/**
 * "What would this declaration's draft look like right now" -- the one
 * function generateOrRefreshDeclarationDraft.ts (writing a fresh
 * DRAFT-time snapshot) AND markDeclarationReady.ts (re-verifying the
 * report is CURRENT, never trusting a possibly-stale one already on the
 * row -- this task's own explicit requirement) both call, so the two
 * can never silently disagree about what "complete" means for the same
 * org+period.
 *
 * Reuses listPeriodShipmentLines (src/application/reporting/list-period-shipment-lines.ts,
 * built for the Reports screen) for the line + latest-calculation join
 * rather than re-deriving that three-query fetch -- per this task's own
 * instruction. That function's own return shape does not expose
 * per-shipment STATUS or shipments with zero lines as their own entries
 * (neither of which the Reports screen needed), both of which the
 * completeness gate genuinely does need ("every shipment in this
 * org+period," READY/LOCKED-ness) -- rather than widening a shared
 * reporting module to carry declaration-specific concerns, this issues
 * one small supplementary `shipments` query (id/reference/status only)
 * of its own and joins the two client-side. The supplementary query
 * duplicates listPeriodShipmentLines' own org+period WHERE clause, but
 * not its three-query join -- the expensive, security/visibility-
 * relevant part stays shared, exactly the "don't duplicate the
 * expensive fetch" reasoning that function's own doc comment states,
 * applied to the cheap part it doesn't already expose.
 */
export async function computeDeclarationDraftFacts(
  supabase: SupabaseClient,
  orgId: OrganizationId,
  period: ReportingPeriod,
): Promise<DeclarationDraftFacts> {
  const generatedAt =
    new Date().toISOString() as IsoTimestamp;

  const columns =
    periodColumns(
      period,
    );

  let shipmentsQuery =
    supabase
      .from("shipments")
      .select(
        "id, reference, status",
      )
      .eq("org_id", orgId)
      .eq("reporting_period_kind", columns.reporting_period_kind)
      .eq("reporting_period_year", columns.reporting_period_year)
      // VOID is the sanctioned retirement path for a shipment
      // (20260828150000's header comment; shipments has no DELETE
      // policy at all), and a VOID row is permanently un-reachable by
      // any bare client UPDATE back to a live status
      // (shipments_update_own_org_not_terminal's USING excludes VOID,
      // 20260829090000). Before this filter existed, a VOID shipment
      // still came back from this query and became a member
      // (member_shipment_ids is every row this query returns), and
      // buildCompletenessReport has no status branch that treats VOID
      // as anything but SHIPMENT_NOT_LOCKABLE -- a blocker
      // markDeclarationReady's caller can never clear, because there is
      // no UI action left that changes a VOID shipment's status. That
      // permanently deadlocked the whole period's declaration (found
      // live against local Postgres: void one shipment, then every
      // subsequent generateOrRefreshDeclarationDraft/markDeclarationReady
      // for that period returns INCOMPLETE forever). A VOID shipment is
      // excluded from period membership entirely instead -- it retired
      // before this declaration was prepared, so it never belonged in
      // the set record_declaration_filed() will LOCK. DRAFT stays IN
      // the member set and keeps blocking as SHIPMENT_NOT_LOCKABLE --
      // unlike VOID, a DRAFT shipment has a real, sanctioned recovery
      // path (finish it and mark it READY), so surfacing it as a
      // blocker is actionable, not a dead end.
      .neq("status", "VOID");

  shipmentsQuery =
    columns.reporting_period_quarter === null
      ? shipmentsQuery.is("reporting_period_quarter", null)
      : shipmentsQuery.eq("reporting_period_quarter", columns.reporting_period_quarter);

  const { data: shipmentRows, error: shipmentsError } =
    await shipmentsQuery;

  if (shipmentsError || !shipmentRows) {
    // Fails closed to "no members, incomplete" -- never a fabricated
    // complete: true, and never a partial member list a caller could
    // mistake for the real one. Matches listPeriodShipmentLines' own
    // fail-closed posture on a fetch error (that function's own doc
    // comment).
    return {
      member_shipment_ids: [],
      completeness_report: buildCompletenessReport(
        [],
        generatedAt,
      ),
    };
  }

  // Deterministic order -- member_shipment_ids is a frozen, persisted
  // fact once this declaration leaves DRAFT, so it should read the same
  // way on every refresh rather than however Postgres happened to
  // return rows this time (matches buildCompletenessReport's own
  // shipment_reference sort for its blockers).
  const sortedShipmentRows =
    [...(shipmentRows as ShipmentStatusRow[])].sort(
      (a, b) => a.reference.localeCompare(b.reference),
    );

  const { lines } =
    await listPeriodShipmentLines(
      supabase,
      orgId,
      period,
    );

  const linesByShipmentId =
    new Map<string, PeriodShipmentLine[]>();

  for (const entry of lines) {
    const bucket =
      linesByShipmentId.get(entry.shipment_id) ?? [];

    bucket.push(
      entry,
    );

    linesByShipmentId.set(
      entry.shipment_id,
      bucket,
    );
  }

  const checkShipments: CompletenessCheckShipment[] =
    sortedShipmentRows.map(
      (row) => (
        {
          shipment_id: row.id as ShipmentId,
          shipment_reference: row.reference,
          status: row.status,
          lines: (linesByShipmentId.get(row.id) ?? []).map(
            (entry) => (
              {
                line_id: entry.line.id,
                line_number: entry.line.line_number,
                has_emission_determination: entry.line.emission_determination !== null,
                has_calculation_result: entry.calculation !== null,
              }
            ),
          ),
        }
      ),
    );

  return {
    member_shipment_ids: checkShipments.map(
      (shipment) => shipment.shipment_id,
    ),
    completeness_report: buildCompletenessReport(
      checkShipments,
      generatedAt,
    ),
  };
}

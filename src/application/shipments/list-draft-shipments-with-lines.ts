import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  Shipment,
} from "../../domain/shipments/types";

import type {
  OrganizationId,
} from "../../domain/shared/ids";

import {
  SHIPMENT_COLUMNS,
  SHIPMENT_LINE_COLUMNS,
  toShipment,
  toShipmentLine,
  type ShipmentLineRow,
  type ShipmentRow,
} from "./shipment-mapper";

/**
 * S2's I19 guidance rule needs to know, for every DRAFT shipment,
 * whether transitionShipment(..., "MARK_READY") would succeed -- which
 * requires the shipment's own lines. listShipments.ts deliberately
 * never fetches lines (its own doc comment: the shipments list screen
 * doesn't need them, and fetching them there would cost an N+1 or a
 * large join at the 5k-row scale that screen names). This is a
 * narrower fetch: DRAFT shipments only (I19's own precondition), lines
 * included, in the two-query-then-group shape get-shipment-detail.ts
 * already uses for one shipment -- extended to a batch here rather
 * than N calls to that function.
 */
export async function listDraftShipmentsWithLines(
  supabase: SupabaseClient,
  orgId: OrganizationId,
): Promise<Shipment[]> {
  const { data: shipmentRows, error: shipmentsError } =
    await supabase
      .from("shipments")
      .select(
        SHIPMENT_COLUMNS,
      )
      .eq("org_id", orgId)
      .eq("status", "DRAFT");

  if (
    shipmentsError ||
    !shipmentRows ||
    shipmentRows.length === 0
  ) {
    return [];
  }

  const rows =
    shipmentRows as ShipmentRow[];

  const { data: lineRows, error: linesError } =
    await supabase
      .from("shipment_lines")
      .select(
        SHIPMENT_LINE_COLUMNS,
      )
      .eq("org_id", orgId)
      .in(
        "shipment_id",
        rows.map((row) => row.id),
      );

  if (linesError) {
    return [];
  }

  const linesByShipmentId =
    new Map<string, Shipment["lines"]>();

  for (
    const lineRow of (lineRows ?? []) as ShipmentLineRow[]
  ) {
    const existing =
      linesByShipmentId.get(
        lineRow.shipment_id,
      ) ?? [];

    existing.push(
      toShipmentLine(
        lineRow,
      ),
    );

    linesByShipmentId.set(
      lineRow.shipment_id,
      existing,
    );
  }

  return rows.map(
    (row) =>
      toShipment(
        row,
        (linesByShipmentId.get(row.id) ?? [])
          .slice()
          .sort(
            (a, b) => a.line_number - b.line_number,
          ),
      ),
  );
}

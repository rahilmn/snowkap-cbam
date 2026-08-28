import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  Shipment,
} from "../../domain/shipments/types";

import type {
  ShipmentId,
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
 * The shipment detail screen (§27.12): the shipment header plus every
 * line, ordered for display. Returns null when not found or not
 * visible to the caller (RLS) -- indistinguishable by design, same as
 * every other detail-fetch in this codebase (e.g. getOrganizationProfile).
 */
export async function getShipmentDetail(
  supabase: SupabaseClient,
  shipmentId: ShipmentId,
): Promise<Shipment | null> {
  const { data: shipmentRow, error: shipmentError } =
    await supabase
      .from("shipments")
      .select(
        SHIPMENT_COLUMNS,
      )
      .eq("id", shipmentId)
      .maybeSingle();

  if (shipmentError || !shipmentRow) {
    return null;
  }

  const { data: lineRows, error: linesError } =
    await supabase
      .from("shipment_lines")
      .select(
        SHIPMENT_LINE_COLUMNS,
      )
      .eq("shipment_id", shipmentId)
      .order("line_number", { ascending: true });

  if (linesError) {
    return null;
  }

  return toShipment(
    shipmentRow as ShipmentRow,
    ((lineRows ?? []) as ShipmentLineRow[]).map(
      toShipmentLine,
    ),
  );
}

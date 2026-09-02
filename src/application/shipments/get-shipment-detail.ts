import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  Shipment,
} from "../../domain/shipments/types";

import type {
  OrganizationId,
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
  orgId: OrganizationId,
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

  // 2026-09-03 (P14). RLS is NOT sufficient here, and the difference
  // matters for a user who belongs to more than one organization --
  // which production has today.
  //
  // shipments_select_own_org admits every org the USER is a member of
  // (app.user_org_ids()), not the one they are currently acting as. So
  // a user in orgs A and B, with A active, could open B's shipment and
  // the page would render it inside A's shell -- then compute A's
  // available actual data against B's lines, and attribute anything
  // they did to A. That is not a cross-tenant leak, but it is the
  // active organization operating on another organization's resources,
  // which is its own category of wrong.
  //
  // Indistinguishable from not-found on purpose, matching
  // getDeclarationDetail: a caller who supplied the wrong org should
  // learn nothing about whether the id exists.
  if ((shipmentRow as ShipmentRow).org_id !== orgId) {
    return null;
  }

  const { data: lineRows, error: linesError } =
    await supabase
      .from("shipment_lines")
      .select(
        SHIPMENT_LINE_COLUMNS,
      )
      .eq("org_id", orgId)
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

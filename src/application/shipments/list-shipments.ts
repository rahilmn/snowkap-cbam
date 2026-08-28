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
  toShipment,
  type ShipmentRow,
} from "./shipment-mapper";

/**
 * The shipments list screen (§27.9) never needs lines -- deliberately
 * not fetching them here keeps this cheap at the 5k-row scale the P4
 * acceptance criteria call out, rather than an N+1 or a large join.
 */
export async function listShipments(
  supabase: SupabaseClient,
  orgId: OrganizationId,
): Promise<Shipment[]> {
  const { data, error } =
    await supabase
      .from("shipments")
      .select(
        SHIPMENT_COLUMNS,
      )
      .eq("org_id", orgId)
      .order("created_at", { ascending: false });

  if (error || !data) {
    return [];
  }

  return (data as ShipmentRow[]).map(
    (row) =>
      toShipment(
        row,
      ),
  );
}

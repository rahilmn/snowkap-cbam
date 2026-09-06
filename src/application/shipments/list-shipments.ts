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
 *
 * 2026-09-06 (S5 cross-phase hardening). This USED to swallow a real
 * query error into `[]`, indistinguishable from "this org genuinely
 * has no shipments" -- rendered by the /shipments page (the primary
 * importer-journey landing page) as "No shipments yet. Create your
 * first shipment...", inviting a user with real DRAFT/READY/FILED
 * shipments to start over rather than seeing their existing work.
 * Matches this codebase's own "throw is for infrastructure failures"
 * convention (CLAUDE.md) and the identical fix already applied to
 * listDeclarations (list-declarations.ts) in the same class of gap --
 * the page itself needs no change, since app/error.tsx (P13) is
 * already the established boundary for an unhandled page-level throw.
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

  if (error) {
    throw new Error(
      `shipments: fetch failed (${error.message}).`,
    );
  }

  return ((data ?? []) as ShipmentRow[]).map(
    (row) =>
      toShipment(
        row,
      ),
  );
}

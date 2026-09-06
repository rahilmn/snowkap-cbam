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

  // 2026-09-07 (S5 review round 5, finding S5R5-A). THROWS on a genuine
  // query error -- distinct from `!shipmentRow`, which stays a null
  // return (see the doc comment just below on why not-found and
  // not-visible must remain indistinguishable from each other). A
  // transport failure previously collapsed into the SAME null as
  // "doesn't exist," and the one caller (app/(importer)/shipments/
  // [id]/page.tsx, no try/catch) silently redirected to /shipments as
  // though a real, existing shipment the user was just looking at had
  // vanished -- the identical failure round 4's own commit 10b7a1e
  // already fixed for this function's OTHER query (the shipment_lines
  // fetch, 40 lines below), whose own doc comment states the reasoning
  // this now applies here too.
  if (shipmentError) {
    throw new Error(
      `get-shipment-detail: shipment fetch failed (${shipmentError.message}).`,
    );
  }

  if (!shipmentRow) {
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

  // 2026-09-07 (supabase/config.toml `max_rows = 1000`; S5 review round
  // 3, finding S5R3-A-B2). An un-paged PostgREST query returns HTTP 200
  // with `error: null` and silently caps at 1000 rows -- a large
  // periodic import declaration can genuinely carry more than 1000
  // shipment lines, and this fetch previously had no .range(). Beyond
  // the display gap (missing lines on the detail screen), a silently
  // truncated line set here feeds directly into
  // getShipmentEmissionsTotal's headline sum via the caller -- lines
  // past the cap would not just be invisible, their embedded emissions
  // would be silently missing from the shipment's own reported total.
  // Same paging convention as the other fixes for this defect class
  // (list-period-shipment-lines.ts, get-declaration-detail.ts's
  // LINE_PAGE_SIZE).
  const LINE_PAGE_SIZE =
    1000;

  const lineRows: ShipmentLineRow[] =
    [];

  let offset =
    0;

  for (;;) {
    const { data, error: linesError } =
      await supabase
        .from("shipment_lines")
        .select(
          SHIPMENT_LINE_COLUMNS,
        )
        .eq("org_id", orgId)
        .eq("shipment_id", shipmentId)
        .order("line_number", { ascending: true })
        .range(offset, offset + LINE_PAGE_SIZE - 1);

    // 2026-09-07 (S5 review round 4, finding S5R4-A-B2). THROWS on a
    // genuine query error rather than degrading to null -- this is a
    // DIFFERENT case from the shipment-header not-found/not-visible
    // checks above, which are deliberately indistinguishable from each
    // other for the same not-found-not-forbidden reason
    // getDeclarationDetail uses. A lines-fetch infrastructure failure
    // is neither: it made an existing, visible shipment appear
    // not-found, silently redirecting the user to /shipments
    // (page.tsx) as though the shipment they were just looking at had
    // vanished, and -- per this function's own doc comment above --
    // fed a truncated/absent line set straight into
    // getShipmentEmissionsTotal's headline sum.
    if (linesError) {
      throw new Error(
        `get-shipment-detail: shipment_lines fetch failed (${linesError.message}).`,
      );
    }

    const page =
      (data ?? []) as ShipmentLineRow[];

    lineRows.push(
      ...page,
    );

    if (page.length < LINE_PAGE_SIZE) {
      break;
    }

    offset +=
      LINE_PAGE_SIZE;
  }

  return toShipment(
    shipmentRow as ShipmentRow,
    lineRows.map(
      toShipmentLine,
    ),
  );
}

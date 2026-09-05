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
 *
 * 2026-09-05 (S2 remediation, B3, fresh Opus 5 review). This USED to
 * issue one `shipment_lines` query with every draft shipment id in a
 * single `.in()` filter, and converted any query error into `[]`. Live
 * bisection against this exact request shape found it fails with HTTP
 * 414 "URI too long" from 220 draft shipments upward, and below that
 * threshold PostgREST's own `max_rows` (1000, supabase/config.toml)
 * silently truncated the lines result once an org's shipment_lines
 * exceeded it -- both failures then surfaced as an affirmative
 * "Nothing needs your attention right now.", the exact false
 * reassurance a compliance work-queue must never produce. Fixed by
 * chunking the id list to a bounded size well under that threshold,
 * paginating every query to completion via `.range()` (never trusting
 * a single page to be the whole result), and letting a real query
 * error THROW rather than degrade into an empty, indistinguishable-
 * from-genuinely-caught-up result -- matching this codebase's own
 * "throw is for infrastructure failures" convention (CLAUDE.md). The
 * caller (deriveDashboardGuidance) is what turns that throw into an
 * explicit UNAVAILABLE result distinct from a real empty queue.
 */

// Comfortably under the ~219-id threshold confirmed live for this exact
// query shape (SHIPMENT_LINE_COLUMNS + org_id + shipment_id .in(...)) --
// leaves real margin rather than riding the edge of a limit owned by an
// infrastructure component (the API gateway) this codebase doesn't
// control.
const SHIPMENT_ID_CHUNK_SIZE = 100;

// Matches PostgREST's own configured max_rows (supabase/config.toml) --
// requesting exactly that many per page means the common case (an org
// under the limit) still completes in one round trip.
const PAGE_SIZE = 1000;

function chunk<T>(
  items: T[],
  size: number,
): T[][] {
  const chunks: T[][] = [];

  for (
    let index = 0;
    index < items.length;
    index += size
  ) {
    chunks.push(
      items.slice(
        index,
        index + size,
      ),
    );
  }

  return chunks;
}

/**
 * Runs `runQuery` repeatedly over successive `.range()` windows until a
 * page comes back shorter than PAGE_SIZE, accumulating every row. A
 * query error is never converted into a partial result -- it throws
 * immediately, since a page that failed to load is not the same fact
 * as "no more rows."
 */
async function fetchAllPages<Row>(
  runQuery: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
): Promise<Row[]> {
  const all: Row[] = [];

  let from = 0;

  for (;;) {
    const to =
      from + PAGE_SIZE - 1;

    const { data, error } =
      await runQuery(
        from,
        to,
      );

    if (error) {
      throw new Error(
        `guidance: draft shipment fetch failed (${error.message}).`,
      );
    }

    const page =
      data ?? [];

    all.push(
      ...page,
    );

    if (page.length < PAGE_SIZE) {
      break;
    }

    from += PAGE_SIZE;
  }

  return all;
}

export async function listDraftShipmentsWithLines(
  supabase: SupabaseClient,
  orgId: OrganizationId,
): Promise<Shipment[]> {
  const shipmentRows =
    await fetchAllPages<ShipmentRow>(
      (from, to) =>
        supabase
          .from("shipments")
          .select(
            SHIPMENT_COLUMNS,
          )
          .eq("org_id", orgId)
          .eq("status", "DRAFT")
          // A stable order is required for .range() pagination to be
          // correct across pages -- without it Postgres makes no
          // guarantee that two separate queries see rows in the same
          // order, which would risk skipping or duplicating rows
          // across a page boundary.
          .order("id")
          .range(from, to),
    );

  if (shipmentRows.length === 0) {
    return [];
  }

  const idChunks =
    chunk(
      shipmentRows.map((row) => row.id),
      SHIPMENT_ID_CHUNK_SIZE,
    );

  const lineRowChunks =
    await Promise.all(
      idChunks.map(
        (ids) =>
          fetchAllPages<ShipmentLineRow>(
            (from, to) =>
              supabase
                .from("shipment_lines")
                .select(
                  SHIPMENT_LINE_COLUMNS,
                )
                .eq("org_id", orgId)
                .in(
                  "shipment_id",
                  ids,
                )
                .order("id")
                .range(from, to),
          ),
      ),
    );

  const linesByShipmentId =
    new Map<string, Shipment["lines"]>();

  for (
    const lineRow of lineRowChunks.flat()
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

  return shipmentRows.map(
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

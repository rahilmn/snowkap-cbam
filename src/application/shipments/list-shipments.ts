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
// 2026-09-07 (supabase/config.toml `max_rows = 1000`; S5 review round
// 4, finding S5R4-TRUNC-A1). An un-paged PostgREST query returns HTTP
// 200 with `error: null` and silently caps at 1000 rows -- and this
// query is the one place the master plan's own P4 acceptance criteria
// (docs/plans/MASTER_PLAN.md, "shipments list filter/paginate < 300ms
// at 50k shipments," "list budget sane at seeded 5k") explicitly name
// as an in-scope, production-scale case, not a hypothetical edge case.
// The P11 perf run (scripts/perf/RESULTS.md) already exercised this
// exact function against a real 50,000-row seeded org and reported
// only latency, never row-count correctness against the seeded total
// -- so this truncation was very likely already occurring silently in
// that evidence run itself. Paged with .range(), matching the
// established convention for this defect class elsewhere in this
// application layer.
const SHIPMENT_PAGE_SIZE =
  1000;

export async function listShipments(
  supabase: SupabaseClient,
  orgId: OrganizationId,
): Promise<Shipment[]> {
  const rows: ShipmentRow[] =
    [];

  let offset =
    0;

  for (;;) {
    const { data, error } =
      await supabase
        .from("shipments")
        .select(
          SHIPMENT_COLUMNS,
        )
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        // `id` as a deterministic tie-breaker so .range() pagination
        // stays stable across pages sharing a created_at value.
        .order("id", { ascending: false })
        .range(offset, offset + SHIPMENT_PAGE_SIZE - 1);

    if (error) {
      throw new Error(
        `shipments: fetch failed (${error.message}).`,
      );
    }

    const page =
      (data ?? []) as ShipmentRow[];

    rows.push(
      ...page,
    );

    if (page.length < SHIPMENT_PAGE_SIZE) {
      break;
    }

    offset +=
      SHIPMENT_PAGE_SIZE;
  }

  return rows.map(
    (row) =>
      toShipment(
        row,
      ),
  );
}

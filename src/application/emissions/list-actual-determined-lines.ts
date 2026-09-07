import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  Shipment,
  ShipmentLine,
} from "../../domain/shipments/types";

import type {
  EmissionDataMethodology,
  EmissionDetermination,
} from "../../domain/emissions/types";

import type {
  CountryCode,
} from "../../domain/shared/country";

import type {
  OrganizationId,
  SharingGrantId,
  ShipmentId,
  ShipmentLineId,
} from "../../domain/shared/ids";

import {
  formatReportingPeriod,
  type ReportingPeriod,
} from "../../domain/shared/reporting-period";

import {
  SHIPMENT_COLUMNS,
  SHIPMENT_LINE_COLUMNS,
  toShipment,
  toShipmentLine,
  type ShipmentLineRow,
  type ShipmentRow,
} from "../shipments/shipment-mapper";

import {
  checkActualDeterminationStalenessByShipment,
} from "./check-actual-determination-staleness";

import {
  effectiveSharingGrantStatus,
} from "../../domain/sharing/effective-grant-status";

import {
  UNKNOWN_GRANTOR_ORGANIZATION_NAME,
  type ActualDataProvenance,
} from "./list-available-actual-data";

import type {
  ActualSnapshotStaleness,
} from "../../domain/emissions/check-actual-snapshot-staleness";

import type {
  SharingGrantStatus,
} from "../../domain/sharing/types";

/**
 * One row of the importer's cross-shipment "Emissions" overview (master
 * plan §27 screen 15: "determinations overview ... read-only, grant-
 * labeled, stale indicators"). Unlike AvailableActualEmissionDataOption
 * (list-available-actual-data.ts, which describes a *candidate* dataset a
 * line COULD be determined from), this describes a line's *actual, already
 * -in-force* ACTUAL determination -- the frozen ActualEmissionSnapshot
 * already on the line, not a currently-queryable emission_data row.
 */
export interface ActualDeterminedLineOverviewRow {
  line_id: ShipmentLineId;
  shipment_id: ShipmentId;
  shipment_reference: string;
  line_number: number;
  cn_code: string;
  goods_description: string | null;
  origin_country: CountryCode;
  methodology: EmissionDataMethodology;
  provenance: ActualDataProvenance;

  // The grantor org's name for a SHARED row (resolved via the sharing
  // grant the snapshot was read through -- see this function's own doc
  // comment for why that join path, not emission_data.entered_by_org_id,
  // is used); always null for an OWN row.
  grantor_organization_name: string | null;

  // 2026-09-03 (P14). The grant's CURRENT status, carried so the UI can
  // be honest about the present without misrepresenting the past: the
  // frozen snapshot stays valid and attributable after revocation (that
  // is the whole point of freezing it), but a reader deserves to know
  // that the sharing relationship behind it has since ended. Null for an
  // OWN row.
  sharing_grant_status: SharingGrantStatus | null;

  staleness: ActualSnapshotStaleness;
}

type ActualDeterminedShipmentLine =
  ShipmentLine & {
    emission_determination: Extract<EmissionDetermination, { method: "ACTUAL" }>;
  };

interface SharingGrantGrantorLookupRow {
  status: SharingGrantStatus;
  id: string;
  grantor_org_id: string;
  expires_at: string | null;
}

interface OrganizationNameLookupRow {
  id: string;
  name: string;
}

function isActualDeterminedLine(
  line: ShipmentLine,
): line is ActualDeterminedShipmentLine {
  return line.emission_determination?.method === "ACTUAL";
}

// 2026-09-07 (S5 review round 6, finding S5R6-SHARE-B3). The `shipments`
// follow-up query below is filtered by `.in("id", shipmentIds)`, where
// shipmentIds is every DISTINCT shipment among this org's ACTUAL-
// determined lines -- unlike the shipment_lines query above (paged by
// row count via .range()), an oversized `.in()` list overflows the
// REQUEST URL itself (PostgREST/the API gateway rejects it with HTTP
// 414), well before max_rows=1000 row-count truncation would ever
// apply. Matches the identical, already live-verified fix shape used
// for this exact hazard shape elsewhere in this codebase
// (list-draft-shipments-with-lines.ts's own SHIPMENT_ID_CHUNK_SIZE/
// chunk() -- see that file's own doc comment for the ~219-id threshold
// confirmed live for a comparable query shape); reusing its same
// conservative chunk size here rather than re-deriving a new threshold
// for what is the same class of query.
const SHIPMENT_ID_CHUNK_SIZE =
  100;

function chunk<T>(
  items: T[],
  size: number,
): T[][] {
  const chunks: T[][] =
    [];

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
 * Every ACTUAL-determined shipment line across the ENTIRE org, decoupled
 * from any single shipment -- the cross-shipment counterpart to
 * checkActualDeterminationStalenessByShipment and
 * listAvailableActualEmissionData, both of which are (as their own names
 * say) scoped to one shipment or one line. Powers app/(importer)/emissions/
 * page.tsx's "determinations overview" section; never used to authorize
 * anything (read-only, per that screen's own master-plan spec).
 *
 * Filters on `determination_method = 'ACTUAL'` -- the generated, indexed
 * "hot key" column P5 added specifically for exactly this kind of filter
 * (shipment_lines_org_determination_method_idx,
 * 20260829150000_p5_emission_determination_generated_columns.sql's own
 * header comment: "so common filters/reports don't have to unpack jsonb
 * on every read") -- rather than fetching every line in the org and
 * filtering the jsonb payload in application code the way this codebase's
 * emission_data-side functions do (no equivalent generated column exists
 * there). The `org_id` filter alongside it is Wall 1 defense in depth on
 * top of RLS, matching every other org-scoped query in this codebase
 * (listAvailableActualEmissionData's own doc comment). The
 * `isActualDeterminedLine` re-check below on the mapped rows costs
 * nothing and means this function's own correctness never silently
 * depends on the generated column and its source jsonb never disagreeing.
 *
 * Three follow-up queries, none an embedded-resource select (no
 * precedent for that syntax anywhere in src/application/**, and it keeps
 * this testable against the established per-table mock-Supabase-client
 * pattern -- see listAvailableActualEmissionData's own doc comment for
 * the fuller reasoning this mirrors):
 *
 *   1. `shipments`, batched by every distinct shipment_id among the
 *      ACTUAL lines -- for the reference to link back with, AND for each
 *      shipment's own reporting_period (shipment_lines carries no period
 *      of its own; Shipment does). Different lines in this org-wide
 *      result can belong to shipments in DIFFERENT reporting periods
 *      (unlike checkActualDeterminationStalenessByShipment's usual one-
 *      shipment-at-a-time caller, app/(importer)/shipments/[id]/page.tsx,
 *      where every line necessarily shares one period) -- so lines are
 *      grouped by their own shipment's period below, and
 *      checkActualDeterminationStalenessByShipment (which never actually
 *      assumes single-shipment input -- it only needs a lines array and
 *      ONE shared period, see its own doc comment) is called once per
 *      distinct period group, exactly the same "one query per distinct
 *      X" shape listAvailableActualEmissionData already uses for
 *      distinct cn_code. A line whose shipment_id isn't found in this
 *      lookup is skipped, not rendered broken -- shouldn't happen (RLS
 *      already proved this same caller can see the shipment_lines row,
 *      and shipments_select_own_org grants identical org-scoped
 *      visibility for its parent shipment), matching this codebase's
 *      "never crash the picker" contract even if that invariant is ever
 *      violated.
 *
 *   2. `sharing_grants`, batched by every distinct
 *      snapshot.sharing_grant_id among the ACTUAL lines that have one
 *      (null means OWN -- no lookup needed) -- resolves each grant's
 *      grantor_org_id. This is deliberately NOT the same join path
 *      listAvailableActualEmissionData uses (emission_data.
 *      entered_by_org_id): that path requires the CURRENT emission_data
 *      row for the snapshot's installation+period to still be visible to
 *      this org, which fails the moment the sharing grant that produced
 *      THIS historical determination is later revoked (checkActual
 *      DeterminationStalenessByShipment's own doc comment documents this
 *      exact gap for the staleness signal; the same gap would silently
 *      degrade every revoked-grant row's provenance label to "Unknown
 *      organization" here too). sharing_grants_select_grantor_or_grantee
 *      RLS (20260829260000) grants a grantee visibility of its own grant
 *      rows regardless of status -- INVITED, ACTIVE, REVOKED, or EXPIRED
 *      all remain readable -- so resolving the grantor through the grant
 *      record itself, not through emission_data, is what actually
 *      survives revocation the way master plan §31's "history survives
 *      revocation" principle requires for this label.
 *
 *   3. `organizations`, batched by every distinct grantor_org_id the
 *      sharing_grants lookup resolved -- the grantor org's display name.
 *
 * A query that SUCCEEDS but simply doesn't return a specific id degrades
 * only that one row to UNKNOWN_GRANTOR_ORGANIZATION_NAME (imported from
 * list-available-actual-data.ts, not redefined here, so the two
 * "shared-in data" surfaces this screen and the per-line picker never
 * visibly disagree on wording).
 *
 * 2026-09-06 (S5 cross-phase hardening). All four of this function's own
 * query legs (shipment_lines, shipments, sharing_grants, the org-name
 * RPC) USED to fail the whole result to [] on a genuine transport/
 * PostgREST error -- silently indistinguishable from "no lines are
 * determined from actual data," on the one screen (master plan §27
 * screen 15) whose entire purpose is surfacing STALE determinations an
 * importer needs to re-check. The two legs that only run when a SHARED
 * row exists (sharing_grants, the org-name RPC) could blank the ENTIRE
 * table on a failure affecting only shared rows, not just degrade them.
 * Matches this codebase's own "throw is for infrastructure failures"
 * convention (CLAUDE.md) and the identical remediation already applied
 * to listDraftShipmentsWithLines/listDeclarations for the guidance
 * dashboard's own sibling gap (S2 B3) -- this function has no bespoke
 * caller-side UNAVAILABLE wrapper of its own; its one caller
 * (app/(importer)/emissions/page.tsx) is a plain server component with
 * no try/catch, so a throw here reaches app/error.tsx (P13's own
 * established page-level failure boundary) exactly the way
 * listShipments/listDeclarations already do for their own pages.
 *
 * Sorted STALE-first (then by shipment reference, then line number) --
 * this is a read-only overview whose whole purpose is surfacing what an
 * importer might want to act on next (master plan §27 screen 15: "P: set
 * determination"), so the rows most likely to need a re-determination
 * lead, matching this codebase's dashboard/action-queue ethos (§8/§27)
 * rather than an arbitrary insertion order.
 */
export async function listActualDeterminedLines(
  supabase: SupabaseClient,
  orgId: OrganizationId,
): Promise<ActualDeterminedLineOverviewRow[]> {
  // 2026-09-07 (supabase/config.toml `max_rows = 1000`; S5 review round
  // 3, finding S5R3-STALE-B3). This is the one query in this file with
  // no per-shipment scope at all -- every ACTUAL-determined line across
  // the ENTIRE org, which is exactly the shape most likely to exceed
  // PostgREST's row cap for an org with many shipments. Un-paged, it
  // previously returned HTTP 200 with `error: null` and silently kept
  // only the first 1000 rows (shipment_id, then line_number order) --
  // indistinguishable from "this org has no more than 1000 ACTUAL
  // lines," on the one screen whose entire purpose (master plan §27
  // screen 15) is surfacing which lines need re-determination. Paged
  // with .range(), matching the established convention for this defect
  // class elsewhere in this file's own siblings (list-shared-data-
  // status.ts, get-declaration-detail.ts).
  const LINE_PAGE_SIZE =
    1000;

  const lineRows: ShipmentLineRow[] =
    [];

  let lineOffset =
    0;

  for (;;) {
    const { data, error: lineError } =
      await supabase
        .from("shipment_lines")
        .select(
          SHIPMENT_LINE_COLUMNS,
        )
        .eq("org_id", orgId)
        .eq("determination_method", "ACTUAL")
        .order("shipment_id", { ascending: true })
        .order("line_number", { ascending: true })
        .range(lineOffset, lineOffset + LINE_PAGE_SIZE - 1);

    if (lineError) {
      throw new Error(
        `list-actual-determined-lines: shipment_lines fetch failed (${lineError.message}).`,
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

    lineOffset +=
      LINE_PAGE_SIZE;
  }

  const actualLines =
    lineRows
      .map(
        toShipmentLine,
      )
      .filter(
        isActualDeterminedLine,
      );

  if (actualLines.length === 0) {
    return [];
  }

  const shipmentIds =
    Array.from(
      new Set(
        actualLines.map((line) => line.shipment_id),
      ),
    );

  const SHIPMENT_PAGE_SIZE =
    1000;

  const shipmentIdChunks =
    chunk(
      shipmentIds,
      SHIPMENT_ID_CHUNK_SIZE,
    );

  const shipmentRowChunks =
    await Promise.all(
      shipmentIdChunks.map(
        async (ids) => {
          const rows: ShipmentRow[] =
            [];

          let offset =
            0;

          for (;;) {
            const { data, error: shipmentError } =
              await supabase
                .from("shipments")
                .select(
                  SHIPMENT_COLUMNS,
                )
                .eq("org_id", orgId)
                .in("id", ids)
                // A stable order is required for .range() pagination
                // to be correct across pages -- without it Postgres
                // makes no guarantee two separate queries see rows in
                // the same order, risking a skipped or duplicated row
                // across a page boundary.
                .order("id")
                .range(offset, offset + SHIPMENT_PAGE_SIZE - 1);

            if (shipmentError) {
              throw new Error(
                `list-actual-determined-lines: shipments fetch failed (${shipmentError.message}).`,
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

          return rows;
        },
      ),
    );

  const shipmentById =
    new Map<string, Shipment>(
      shipmentRowChunks.flat().map(
        (row) => [row.id, toShipment(row)],
      ),
    );

  // Group by reporting period (formatReportingPeriod's stable string
  // form, e.g. "2026" / "2025-Q4", is already a valid map key -- see this
  // function's own doc comment for why grouping happens at all).
  const linesByPeriodKey =
    new Map<string, { period: ReportingPeriod; lines: ShipmentLine[] }>();

  for (const line of actualLines) {
    const shipment =
      shipmentById.get(
        line.shipment_id,
      );

    if (!shipment) {
      continue;
    }

    const key =
      formatReportingPeriod(
        shipment.reporting_period,
      );

    const bucket =
      linesByPeriodKey.get(
        key,
      );

    if (bucket) {
      bucket.lines.push(
        line,
      );
    } else {
      linesByPeriodKey.set(
        key,
        { period: shipment.reporting_period, lines: [line] },
      );
    }
  }

  const stalenessByLineId: Record<string, ActualSnapshotStaleness> =
    {};

  for (const { period, lines } of linesByPeriodKey.values()) {
    Object.assign(
      stalenessByLineId,
      await checkActualDeterminationStalenessByShipment(
        supabase,
        orgId,
        lines,
        period,
      ),
    );
  }

  // 2026-09-07 (S5 review round 3, finding S5R3-A-B1's own sweep,
  // prophylactic -- no legacy-shape ACTUAL row exists today, but
  // `snapshot` is compile-time-required, not runtime-guaranteed, for
  // the same unchecked-jsonb-cast reason `resolution` isn't either --
  // isActualDeterminedLine only checks `method === "ACTUAL"`, not that
  // `snapshot` is actually present.
  const sharingGrantIds =
    Array.from(
      new Set(
        actualLines
          .map((line) => line.emission_determination.snapshot?.sharing_grant_id ?? null)
          .filter((id): id is SharingGrantId => id !== null),
      ),
    );

  const grantorOrgIdBySharingGrantId =
    new Map<string, string>();

  const grantStatusBySharingGrantId =
    new Map<string, SharingGrantStatus>();

  if (sharingGrantIds.length > 0) {
    // 2026-09-07 (S5 review round 7, finding S5R7-SHARE-B3). sharingGrantIds
    // is the org's ENTIRE history of ACTUAL-determined lines' sharing
    // grants, not scoped to one shipment or period -- and can exceed
    // even the installation count, since each grant revoke+reissue
    // cycle mints a new grant id a still-ACTUAL, un-redetermined
    // historical snapshot can still reference. Chunked for the
    // identical URL-length reason the shipments query just above this
    // one already was (S5R6-SHARE-B3) -- reusing the same
    // SHIPMENT_ID_CHUNK_SIZE/chunk() rather than a second, redundant
    // constant for what is the same class of hazard.
    const grantRowChunks =
      await Promise.all(
        chunk(
          sharingGrantIds,
          SHIPMENT_ID_CHUNK_SIZE,
        ).map(
          async (idsChunk) => {
            const { data, error: grantError } =
              await supabase
                .from("sharing_grants")
                .select(
                  "id, grantor_org_id, status, expires_at",
                )
                .in("id", idsChunk);

            // Throws rather than degrading -- see this function's own
            // doc comment for why a transport failure here must never
            // be indistinguishable from "no lines are determined from
            // actual data," and must not blank the ENTIRE result
            // (including unrelated OWN-provenance rows) just because a
            // failure touched only the SHARED-row lookup.
            if (grantError) {
              throw new Error(
                `list-actual-determined-lines: sharing_grants fetch failed (${grantError.message}).`,
              );
            }

            return (data ?? []) as SharingGrantGrantorLookupRow[];
          },
        ),
      );

    // 2026-09-07 (S5 review round 4, finding S5R4-VOCAB-1). One clock
    // reading for the whole page, matching the other spot in this
    // codebase that already does this for the identical reason
    // (list-shared-data-status.ts's own `now`): two grants that lapse
    // either side of an evaluation must not render inconsistently
    // within a single response.
    const now =
      new Date();

    for (const row of grantRowChunks.flat()) {
      grantorOrgIdBySharingGrantId.set(
        row.id,
        row.grantor_org_id,
      );

      // Every real access-control predicate this row's own visibility
      // already passed through (app.user_shared_installation_ids())
      // combines status='ACTIVE' with an explicit expires_at check --
      // nothing ever flips a time-lapsed ACTIVE grant's stored `status`
      // to EXPIRED (no cron/scheduled job exists for that transition;
      // see effective-grant-status.ts's own doc comment), so the raw
      // column alone would render "Active" for a grant whose access has
      // already lapsed, contradicting this same row's own "Access since
      // expired" annotation two cells over.
      grantStatusBySharingGrantId.set(
        row.id,
        effectiveSharingGrantStatus(
          row.status,
          row.expires_at,
          now,
        ),
      );
    }
  }

  const grantorOrgIds =
    Array.from(
      new Set(
        grantorOrgIdBySharingGrantId.values(),
      ),
    );

  const grantorOrgNameById =
    new Map<string, string>();

  if (grantorOrgIds.length > 0) {
    // 2026-08-31: a grantee has no membership in the grantor org, so a
    // direct RLS-scoped `organizations` read returned no row and every
    // SHARED line degraded to "Unknown organization" on the live
    // deployment. public.sharing_counterparty_org_names() returns only
    // (id, name).
    //
    // 2026-09-03 (P14): that function used to be gated on a
    // currently-ACTIVE, unexpired grant, which defeated this function's
    // own design -- resolving the grantor through the GRANT ROW rather
    // than through emission_data exists precisely so the label survives
    // revocation, and the name then did not. Reproduced in production
    // (grant 942ba281, revoked 15:28:55 on 2026-09-02): a frozen,
    // already-calculated ACTUAL determination rendered "Shared by
    // Unknown organization". 20260902150000 widens direction 1 (grantee
    // asking for its grantor's name) to any status, which is
    // self-disclosure by the grantor. The comment above is retained
    // because the join path it justifies is still the right one; only
    // its final clause was overtaken.
    const { data: organizationRows, error: organizationError } =
      await supabase
        .rpc(
          "sharing_counterparty_org_names",
        );

    if (organizationError) {
      throw new Error(
        `list-actual-determined-lines: grantor org-name lookup failed (${organizationError.message}).`,
      );
    }

    for (const row of (organizationRows ?? []) as OrganizationNameLookupRow[]) {
      grantorOrgNameById.set(
        row.id,
        row.name,
      );
    }
  }

  const rows: ActualDeterminedLineOverviewRow[] =
    [];

  for (const line of actualLines) {
    const shipment =
      shipmentById.get(
        line.shipment_id,
      );

    if (!shipment) {
      continue;
    }

    // 2026-09-07 (S5 review round 3, finding S5R3-A-B1's own sweep,
    // prophylactic -- no legacy-shape ACTUAL row exists today, but
    // `snapshot` is compile-time-required, not runtime-guaranteed, for
    // the same unchecked-jsonb-cast reason `resolution` isn't either.
    // Skipped like the missing-shipment case just above rather than
    // guarded field-by-field below: there is no partial row to build
    // without methodology/sharing_grant_id, and this is the one place
    // in this sweep where an unguarded access would crash the entire
    // cross-org listing (every other site degrades one field or one
    // row, not the whole response).
    const snapshot =
      line.emission_determination.snapshot;

    // 2026-09-07 (S5 review round 6, finding S5R6-NUM-B). The guard
    // above only checked that `snapshot` itself exists, not that
    // `methodology` -- the one other field this row-construction
    // actually requires -- does too, despite this function's own doc
    // comment already stating "there is no partial row to build
    // without methodology" as the stated reason for skipping rather
    // than guarding field-by-field. `sharing_grant_id` deliberately
    // needs no equivalent check: it is nullable BY DESIGN (null means
    // OWN provenance), so its absence is valid data, not a malformed
    // row -- only `methodology`, a required non-nullable field, must
    // exist for this row to be renderable at all.
    if (!snapshot || !snapshot.methodology) {
      continue;
    }

    const provenance: ActualDataProvenance =
      snapshot.sharing_grant_id === null
        ? "OWN"
        : "SHARED";

    const grantorOrganizationName =
      provenance === "OWN" || snapshot.sharing_grant_id === null
        ? null
        : grantorOrgNameById.get(
            grantorOrgIdBySharingGrantId.get(snapshot.sharing_grant_id) ?? "",
          ) ?? UNKNOWN_GRANTOR_ORGANIZATION_NAME;

    rows.push(
      {
        line_id: line.id,
        shipment_id: line.shipment_id,
        shipment_reference: shipment.reference,
        line_number: line.line_number,
        cn_code: line.cn_code,
        goods_description: line.goods_description,
        origin_country: line.origin_country,
        methodology: snapshot.methodology,
        provenance,
        grantor_organization_name: grantorOrganizationName,
        sharing_grant_status:
          snapshot.sharing_grant_id === null
            ? null
            : grantStatusBySharingGrantId.get(snapshot.sharing_grant_id) ?? null,
        staleness: stalenessByLineId[line.id] ?? "CURRENT",
      },
    );
  }

  rows.sort(
    (a, b) => {
      if (a.staleness !== b.staleness) {
        return a.staleness === "STALE" ? -1 : 1;
      }

      if (a.shipment_reference !== b.shipment_reference) {
        return a.shipment_reference.localeCompare(
          b.shipment_reference,
        );
      }

      return a.line_number - b.line_number;
    },
  );

  return rows;
}

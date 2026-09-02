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
 * Follows list-available-actual-data.ts's own established two-follow-up-
 * queries discipline for both of the lookups above: a transport/PostgREST
 * ERROR on either fails the WHOLE result to [] (never indistinguishable
 * from a fabricated placeholder shown for every row); a query that
 * SUCCEEDS but simply doesn't return a specific id degrades only that
 * one row to UNKNOWN_GRANTOR_ORGANIZATION_NAME (imported from that same
 * module, not redefined here, so the two "shared-in data" surfaces this
 * screen and the per-line picker never visibly disagree on wording).
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
  const { data: lineRows, error: lineError } =
    await supabase
      .from("shipment_lines")
      .select(
        SHIPMENT_LINE_COLUMNS,
      )
      .eq("org_id", orgId)
      .eq("determination_method", "ACTUAL")
      .order("shipment_id", { ascending: true })
      .order("line_number", { ascending: true });

  if (lineError || !lineRows) {
    return [];
  }

  const actualLines =
    (lineRows as ShipmentLineRow[])
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

  const { data: shipmentRows, error: shipmentError } =
    await supabase
      .from("shipments")
      .select(
        SHIPMENT_COLUMNS,
      )
      .eq("org_id", orgId)
      .in("id", shipmentIds);

  if (shipmentError || !shipmentRows) {
    return [];
  }

  const shipmentById =
    new Map<string, Shipment>(
      (shipmentRows as ShipmentRow[]).map(
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

  const sharingGrantIds =
    Array.from(
      new Set(
        actualLines
          .map((line) => line.emission_determination.snapshot.sharing_grant_id)
          .filter((id): id is SharingGrantId => id !== null),
      ),
    );

  const grantorOrgIdBySharingGrantId =
    new Map<string, string>();

  const grantStatusBySharingGrantId =
    new Map<string, SharingGrantStatus>();

  if (sharingGrantIds.length > 0) {
    const { data: grantRows, error: grantError } =
      await supabase
        .from("sharing_grants")
        .select(
          "id, grantor_org_id, status",
        )
        .in("id", sharingGrantIds);

    // Fails the whole result closed -- see this function's own doc
    // comment for why a transport failure here must never be
    // indistinguishable from a fabricated placeholder shown for every
    // SHARED row.
    if (grantError) {
      return [];
    }

    for (const row of (grantRows ?? []) as SharingGrantGrantorLookupRow[]) {
      grantorOrgIdBySharingGrantId.set(
        row.id,
        row.grantor_org_id,
      );

      grantStatusBySharingGrantId.set(
        row.id,
        row.status,
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
      return [];
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

    const snapshot =
      line.emission_determination.snapshot;

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

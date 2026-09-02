import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  Declaration,
  DeclarationStatus,
} from "../../domain/declarations/types";

import type {
  DeclarationId,
  OrganizationId,
  ShipmentId,
} from "../../domain/shared/ids";

import type {
  ShipmentStatus,
} from "../../domain/shipments/types";

import {
  DECLARATION_COLUMNS,
  toDeclaration,
  type DeclarationRow,
} from "./declaration-mapper";

export interface DeclarationMemberShipmentSummary {
  id: ShipmentId;
  reference: string;
  status: ShipmentStatus;
}

/**
 * A neighboring declaration in the amendment chain -- deliberately NOT
 * a full Declaration (the detail screen only ever renders id/status/
 * filed_reference for a lineage link, and fetching the full row
 * including completeness_report/filed_snapshot for a declaration that
 * isn't the one being viewed would be wasted payload for data the
 * screen never shows).
 */
export interface DeclarationLineageEntry {
  id: DeclarationId;
  status: DeclarationStatus;
  filed_reference: string | null;
}

export interface DeclarationDetail {
  declaration: Declaration;
  member_shipments: DeclarationMemberShipmentSummary[];
  // The declaration this one supersedes (an amendment's predecessor),
  // or null for an original.
  supersedes: DeclarationLineageEntry | null;
  // The non-VOID declaration that supersedes this one, or null if this
  // is the current version of its period. declarations_supersedes_uq
  // (20260829330000) guarantees at most one, so a single row (not a
  // list) is the correct shape here, not a simplification.
  superseded_by: DeclarationLineageEntry | null;
}

interface ShipmentSummaryRow {
  id: string;
  reference: string;
  status: ShipmentStatus;
}

interface LineageRow {
  id: string;
  status: DeclarationStatus;
  filed_reference: string | null;
}

/**
 * The declaration detail screen (master plan §27 screen 22): the
 * declaration itself, its member shipments (name + current status, so a
 * LOCKED-by-this-declaration shipment reads as exactly that on screen),
 * and both ends of its amendment chain. Returns null when not found or
 * not visible to the caller (RLS) -- indistinguishable by design, same
 * as getShipmentDetail's own posture -- OR when `orgId` doesn't match
 * the row's own org_id (the audit-attribution guard every mutating
 * declarations function in this module also applies; a read-only
 * detail fetch gets the identical guard for the identical reason: a
 * caller's active org should never be able to confirm a foreign
 * declaration id exists).
 */
/**
 * How many shipment ids go into one `.in()` filter.
 *
 * PostgREST puts filters in the QUERY STRING, so a large `.in()` builds
 * a very long URL and the gateway eventually refuses it outright.
 * Matched to list-period-shipment-lines.ts's own constant, which was
 * chosen for the same reason on the same shape of query.
 */
const MEMBER_ID_BATCH_SIZE =
  200;

/**
 * The member shipments of a declaration, batched, with the error
 * actually checked.
 *
 * 2026-09-03 (P14). This was a single unbounded `.in("id", memberIds)`
 * whose `error` was never destructured, and whose result went through
 * `?? []`. Past roughly two hundred members the gateway refused the URL,
 * `data` came back null, the `?? []` turned that into an empty list, and
 * a FILED_RECORDED declaration rendered "No member shipments yet." on
 * its own provenance screen -- the one page whose entire job is to show
 * what was filed.
 *
 * Two changes, and the second matters more than the first: the query is
 * batched so the URL stays reasonable, and a failure returns null so the
 * caller can refuse to render rather than quietly showing a short list.
 * Silence about a fetch failure on a compliance record is the defect;
 * the length limit was only what made it visible.
 */
async function fetchMemberShipments(
  supabase: SupabaseClient,
  memberIds: readonly string[],
): Promise<ShipmentSummaryRow[] | null> {
  if (memberIds.length === 0) {
    return [];
  }

  const rows: ShipmentSummaryRow[] =
    [];

  for (
    let offset = 0;
    offset < memberIds.length;
    offset += MEMBER_ID_BATCH_SIZE
  ) {
    const batch =
      memberIds.slice(
        offset,
        offset + MEMBER_ID_BATCH_SIZE,
      );

    const { data, error } =
      await supabase
        .from("shipments")
        .select("id, reference, status")
        .in("id", batch);

    if (error || !data) {
      return null;
    }

    rows.push(
      ...(data as ShipmentSummaryRow[]),
    );
  }

  return rows;
}

export async function getDeclarationDetail(
  supabase: SupabaseClient,
  orgId: OrganizationId,
  declarationId: DeclarationId,
): Promise<DeclarationDetail | null> {
  const { data: row, error } =
    await supabase
      .from("declarations")
      .select(
        DECLARATION_COLUMNS,
      )
      .eq("id", declarationId)
      .maybeSingle();

  if (error || !row) {
    return null;
  }

  const declaration =
    toDeclaration(
      row as DeclarationRow,
    );

  if (declaration.org_id !== orgId) {
    return null;
  }

  const memberIds =
    declaration.member_shipment_ids;

  const [
    memberShipmentRows,
    { data: predecessorRow },
    { data: successorRow },
  ] =
    await Promise.all(
      [
        fetchMemberShipments(
          supabase,
          memberIds,
        ),

        declaration.supersedes_declaration_id
          ? supabase
              .from("declarations")
              .select("id, status, filed_reference")
              .eq("id", declaration.supersedes_declaration_id)
              .maybeSingle()
          : Promise.resolve(
              { data: null as LineageRow | null },
            ),

        supabase
          .from("declarations")
          .select("id, status, filed_reference")
          .eq("supersedes_declaration_id", declarationId)
          .neq("status", "VOID")
          .maybeSingle(),
      ],
    );

  // Fail CLOSED. A declaration is a compliance record and its own
  // membership is the substance of it -- a partial list is worse than
  // no page at all, because it reads as complete.
  if (memberShipmentRows === null) {
    return null;
  }

  const memberShipments: DeclarationMemberShipmentSummary[] =
    memberShipmentRows
      .map(
        (shipmentRow) => (
          {
            id: shipmentRow.id as ShipmentId,
            reference: shipmentRow.reference,
            status: shipmentRow.status,
          }
        ),
      )
      .sort(
        (a, b) => a.reference.localeCompare(b.reference),
      );

  const toLineageEntry =
    (lineageRow: LineageRow | null): DeclarationLineageEntry | null =>
      lineageRow
        ? {
            id: lineageRow.id as DeclarationId,
            status: lineageRow.status,
            filed_reference: lineageRow.filed_reference,
          }
        : null;

  return {
    declaration,
    member_shipments: memberShipments,
    supersedes: toLineageEntry(
      predecessorRow as LineageRow | null,
    ),
    superseded_by: toLineageEntry(
      successorRow as LineageRow | null,
    ),
  };
}

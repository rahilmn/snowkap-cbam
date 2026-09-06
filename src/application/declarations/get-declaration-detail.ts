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

import {
  determinationDatasetIsCurrent,
} from "../../domain/emissions/determination-dataset-currency";

import type {
  EmissionDetermination,
} from "../../domain/emissions/types";

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
  // 2026-09-06 (S5 cross-phase hardening; widened same day, S5 review
  // remediation findings A3/EF-B3). true when the persisted
  // completeness_report claims complete:true but is no longer trustworthy,
  // for either of two independent reasons:
  //
  // (1) at least one CURRENT member shipment (member_shipments, fetched
  // fresh above, not cached) is no longer READY/LOCKED --
  // app.invalidate_declaration_approval_on_reopen (20260905140000)
  // correctly flips a READY declaration back to DRAFT the instant a
  // member shipment is reopened, but only touches `status`; it cannot
  // also clear completeness_report/member_shipment_ids in the same
  // UPDATE (app.prevent_declaration_fact_change forbids changing those
  // columns except from DRAFT, and old.status is still READY at that
  // point).
  //
  // (2) at least one member line's DEFAULT determination is resolved
  // against a regulatory_datasets row that is no longer ACTIVE (finding
  // A3/EF-B3). This file's own doc comment used to claim reason (1) was
  // the ONLY way a READY-population report goes stale, reasoning that
  // shipment_lines is DRAFT-only editable so nothing else could change
  // under it -- that claim was FALSE: a regulatory correction changes
  // nothing about the shipment or line at all, only the live
  // regulatory_datasets state compute-declaration-draft-facts.ts reads
  // fresh at generation time (LINE_DATASET_SUPERSEDED, added the SAME
  // S5 phase two commits earlier) -- an independent staleness axis this
  // detector was never reconciled with. Both checks share the identical
  // determinationDatasetIsCurrent() comparison
  // compute-declaration-draft-facts.ts itself uses, so this can never
  // disagree with what a fresh regeneration would find.
  //
  // Left unchecked, the UI kept rendering the pre-revert/pre-correction
  // "Complete -- ready to approve for filing" success badge. Never
  // affects markDeclarationReady's own gate, which always recomputes
  // fresh and never trusts this cached column either way.
  //
  // Round 2 (finding EF2-B1): reason (2) is now scoped to DRAFT/READY
  // declarations only -- a FILED_RECORDED or VOID declaration is an
  // immutable historical record and can never be reported stale by a
  // LATER regulatory correction.
  completeness_report_stale: boolean;
  // 2026-09-06 (S5 review remediation round 2, finding EF2-B3). Which
  // of the two independent reasons above raised completeness_report_stale
  // -- null when it is false. Mutually exclusive by construction, so a
  // caller can render the ACTUAL cause rather than a single hardcoded
  // "a member shipment was reopened" explanation that was wrong for
  // reason (2).
  completeness_report_stale_reason: "MEMBER_REOPENED" | "DATASET_SUPERSEDED" | null;
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
export async function fetchMemberShipments(
  supabase: SupabaseClient,
  memberIds: readonly string[],
): Promise<ShipmentSummaryRow[]> {
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

    // 2026-09-07 (S5 review round 5, finding S5R5-A). THROWS on a
    // genuine query error rather than folding it into the same null
    // the caller previously used for "fail closed, a declaration's own
    // membership is the substance of the record" -- that fail-closed
    // posture is right for the concept but the wrong TOOL: it made a
    // real, existing declaration whose member-shipments fetch merely
    // hit a transient failure indistinguishable from "doesn't exist,"
    // silently redirecting a user away from a real compliance record.
    if (error || !data) {
      throw new Error(
        `declarations: member shipments fetch failed (${error?.message ?? "no rows"}).`,
      );
    }

    rows.push(
      ...(data as ShipmentSummaryRow[]),
    );
  }

  return rows;
}

interface LineDeterminationRow {
  id: string;
  emission_determination: EmissionDetermination | null;
}

interface ActiveDatasetIdRow {
  id: string;
}

// Matches compute-declaration-draft-facts.ts's own SHIPMENTS_PAGE_SIZE --
// same PostgREST max_rows cap (supabase/config.toml), same reasoning:
// an un-ranged query silently truncates rather than erroring, so a
// declaration with more DEFAULT-determined member lines than this must
// be paged, not read in one shot.
const LINE_PAGE_SIZE =
  1000;

/**
 * 2026-09-06 (S5 review remediation, findings A3/EF-B3; hardened round
 * 2, finding EF2-B2). Whether ANY member shipment's line carries a
 * DEFAULT determination resolved against a regulatory dataset that is
 * no longer ACTIVE -- the second, independent half of
 * completeness_report_stale (see that field's own doc comment). Fails
 * OPEN to "not stale" on a query error rather than throwing: this is a
 * supplementary staleness SIGNAL on a read-only detail page whose
 * primary content (the declaration, its member shipments) already
 * succeeded -- a transient failure here should not take down the whole
 * page, and markDeclarationReady's own gate (which DOES throw, per S5's
 * earlier fix) is what actually blocks an incorrect filing regardless
 * of what this signal shows.
 *
 * Round-2 finding EF2-B2: the original version issued one unbounded
 * `.in("shipment_id", memberIds)` with no `.range()` -- PostgREST
 * refuses the URL outright above ~207 member ids (immediately above
 * this file's own MEMBER_ID_BATCH_SIZE, live-measured), and silently
 * caps the result at max_rows=1000 with no `.order()` even below that.
 * Both failure modes converted to a false "not stale" via the `return
 * false` error branch, exactly the fabricated-negative fetchMemberShipments'
 * own doc comment (above) was written to prevent for the member list
 * itself. Now batches member ids (MEMBER_ID_BATCH_SIZE, matching
 * fetchMemberShipments exactly) and pages each batch's lines
 * (LINE_PAGE_SIZE, matching compute-declaration-draft-facts.ts's own
 * shipments-paging shape) with a stable `.order("id")`.
 */
async function anyMemberLineDatasetSuperseded(
  supabase: SupabaseClient,
  memberIds: readonly string[],
): Promise<boolean> {
  if (memberIds.length === 0) {
    return false;
  }

  const { data: datasetRows, error: datasetError } =
    await supabase
      .from("regulatory_datasets")
      .select("id")
      .eq("status", "ACTIVE");

  if (datasetError || !datasetRows) {
    return false;
  }

  const activeDatasetIds =
    new Set(
      (datasetRows as ActiveDatasetIdRow[]).map(
        (row) => row.id,
      ),
    );

  for (
    let batchStart = 0;
    batchStart < memberIds.length;
    batchStart += MEMBER_ID_BATCH_SIZE
  ) {
    const batch =
      memberIds.slice(
        batchStart,
        batchStart + MEMBER_ID_BATCH_SIZE,
      );

    for (let offset = 0; ; offset += LINE_PAGE_SIZE) {
      const { data: lineRows, error: lineError } =
        await supabase
          .from("shipment_lines")
          .select("id, emission_determination")
          .in("shipment_id", batch)
          .eq("determination_method", "DEFAULT")
          .order("id", { ascending: true })
          .range(
            offset,
            offset + LINE_PAGE_SIZE - 1,
          );

      if (lineError || !lineRows) {
        return false;
      }

      const rows =
        lineRows as LineDeterminationRow[];

      if (
        rows.some(
          (row) =>
            !determinationDatasetIsCurrent(
              row.emission_determination,
              activeDatasetIds,
            ),
        )
      ) {
        return true;
      }

      if (rows.length < LINE_PAGE_SIZE) {
        break;
      }
    }
  }

  return false;
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

  // 2026-09-07 (S5 review round 5, finding S5R5-A). THROWS on a genuine
  // query error -- distinct from `!row`, which stays a null return (a
  // caller who supplied the wrong org, or an id that genuinely does
  // not exist, should learn nothing about which case it was). A
  // transport failure previously collapsed into the SAME null,
  // silently redirecting a user away from a real, existing declaration
  // as though it had vanished.
  if (error) {
    throw new Error(
      `declarations: declaration fetch failed (${error.message}).`,
    );
  }

  if (!row) {
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

  // 2026-09-07 (S5 review round 5, finding S5R5-A). fetchMemberShipments
  // now throws on its own fetch error rather than returning null for
  // this function to fold into an identical "not found" -- see its own
  // doc comment. memberShipmentRows is therefore always a real
  // (possibly empty) array here.
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

  const { stale: completenessReportStale, reason: completenessReportStaleReason } =
    await computeCompletenessReportStaleness(
      supabase,
      declaration,
      memberShipments,
      memberIds,
    );

  return {
    declaration,
    member_shipments: memberShipments,
    supersedes: toLineageEntry(
      predecessorRow as LineageRow | null,
    ),
    superseded_by: toLineageEntry(
      successorRow as LineageRow | null,
    ),
    completeness_report_stale: completenessReportStale,
    completeness_report_stale_reason: completenessReportStaleReason,
  };
}

export interface CompletenessReportStaleness {
  stale: boolean;
  reason: "MEMBER_REOPENED" | "DATASET_SUPERSEDED" | null;
}

/**
 * 2026-09-07 (S5 review round 6, finding S5R6-A-B1). Extracted from
 * this function's own body so the declarations LIST page
 * (app/(importer)/declarations/page.tsx) can compute the identical
 * signal per row, rather than the two screens risking disagreement
 * through two independently-maintained copies of the same logic. The
 * list page previously rendered a raw, unqualified status badge with
 * no staleness computation at all -- the byte-identical gap round 5
 * (S5R5-VOCAB-1) fixed on this detail page, deliberately deferred there
 * on the (incorrect) assumption that per-row staleness would require a
 * "meaningfully larger batched-query feature": declarations are
 * one-per-period by construction (declarations_period_in_preparation_uq/
 * declarations_period_original_uq), so a real org has at most a
 * handful of rows ever, not a scale problem.
 */
export async function computeCompletenessReportStaleness(
  supabase: SupabaseClient,
  declaration: Pick<Declaration, "status" | "completeness_report">,
  memberShipments: readonly DeclarationMemberShipmentSummary[],
  memberIds: readonly string[],
): Promise<CompletenessReportStaleness> {
  const reportClaimsComplete =
    declaration.completeness_report !== null &&
    declaration.completeness_report.complete;

  // 2026-09-07 (S5 review round 5, finding S5R5-GUID-B1). Scoped to
  // DRAFT/READY, matching datasetStale's own guard just below -- for
  // the identical reason. The original design assumed MEMBER_REOPENED
  // could only ever be observed on a DRAFT declaration, because
  // app.invalidate_declaration_approval_on_reopen (20260905140000)
  // flips a READY declaration back to DRAFT the instant a member
  // shipment leaves READY. True for READY, but that trigger's own
  // WHERE clause is `d.status = 'READY'` -- it does nothing for a VOID
  // declaration. VOID is reachable directly from READY
  // (declarations_update_own_org_pre_filing, the sanctioned retirement
  // path), and once VOID, member_shipment_ids/completeness_report
  // freeze forever (app.prevent_declaration_fact_change) while the
  // shipment itself stays completely free to be reopened later through
  // its own, unrelated "Reopen" button -- live-reproduced: void a
  // declaration, then reopen one of its former member shipments for
  // any unrelated reason, and this flag went true on a VOID
  // declaration with no live "Generate / refresh draft" control
  // anywhere on the page to act on it (DeclarationActions renders
  // nothing at all for VOID). A retired (VOID) or already-filed
  // (FILED_RECORDED) declaration has nothing this signal could usefully
  // drive -- neither can be regenerated -- so it is meaningless, not
  // merely inconvenient, outside DRAFT/READY.
  const memberStatusStale =
    reportClaimsComplete &&
    (declaration.status === "DRAFT" || declaration.status === "READY") &&
    memberShipments.some(
      (shipment) => shipment.status !== "READY" && shipment.status !== "LOCKED",
    );

  // 2026-09-06 (S5 review remediation round 2, finding EF2-B1). Scoped
  // to declarations that can still be PREPARED or FILED (DRAFT/READY)
  // -- a FILED_RECORDED declaration IS the historical result
  // (RegulatoryResolutionSnapshot's own doc comment: "a later dataset
  // supersession can never change a historical result"; its
  // filed_snapshot is the archived truth and its completeness report
  // was correct as of filing), and a VOID declaration is retired.
  // Without this guard, a regulatory correction landing AFTER filing
  // made an already-filed, immutable compliance record falsely report
  // "Needs refresh" -- the exact "no historical version may silently
  // change meaning" invariant this whole review was run against.
  const datasetStale =
    reportClaimsComplete &&
    !memberStatusStale &&
    (declaration.status === "DRAFT" || declaration.status === "READY") &&
    (await anyMemberLineDatasetSuperseded(
      supabase,
      memberIds,
    ));

  // 2026-09-06 (S5 review remediation round 2, finding EF2-B3). Lets
  // the UI explain the ACTUAL reason rather than always printing the
  // "a member shipment was reopened" copy -- memberStatusStale and
  // datasetStale are mutually exclusive by construction (datasetStale
  // is gated on `!memberStatusStale`), so this is a true discriminant,
  // never both/neither when the combined result is stale.
  return {
    stale: memberStatusStale || datasetStale,
    reason:
      memberStatusStale
        ? "MEMBER_REOPENED"
        : datasetStale
        ? "DATASET_SUPERSEDED"
        : null,
  };
}

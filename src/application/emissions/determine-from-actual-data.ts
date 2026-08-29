import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  ActualEmissionSnapshot,
  EmissionData,
  EmissionDetermination,
} from "../../domain/emissions/types";

import {
  summarizeDeterminationForAudit,
} from "../../domain/emissions/summarize-determination-for-audit";

import {
  checkEmissionDataEvidenceCompleteness,
} from "../../domain/emissions/snapshot-completeness";

import type {
  IsoTimestamp,
} from "../../domain/shared/reporting-period";

import type {
  ShipmentLine,
} from "../../domain/shipments/types";

import type {
  EmissionDataId,
  OrganizationId,
  ShipmentLineId,
  SharingGrantId,
  UserId,
} from "../../domain/shared/ids";

import {
  hasCapability,
  type OrgContext,
} from "../organizations/org-context";

import {
  recordAuditEvent,
} from "../audit/record-audit-event";

import {
  SHIPMENT_LINE_COLUMNS,
  toShipmentLine,
  type ShipmentLineRow,
} from "../shipments/shipment-mapper";

import {
  EMISSION_DATA_COLUMNS,
  toEmissionData,
  type EmissionDataRow,
} from "./emission-data-mapper";

export type DetermineFromActualDataRejectionReason =
  | "LINE_NOT_FOUND"
  | "ALREADY_DETERMINED"
  | "EMISSION_DATA_NOT_FOUND"
  | "DATA_INTEGRITY_ERROR"
  | "SHIPMENT_NOT_EDITABLE"
  | "FETCH_FAILED"
  | "PERSIST_FAILED"
  // The caller's org doesn't hold IMPORTER_DECLARANT -- determining a
  // shipment line's emissions (even from a shared ACTUAL dataset) is an
  // importer-only workflow (master plan §6/§14). Checked BEFORE any
  // database read, same posture as every hasAdminAccess gate elsewhere
  // in this codebase (P10/P11 capability-matrix hardening pass -- see
  // docs/architecture/AUTHORIZATION_MATRIX.md's "Capability
  // enforcement" section).
  | "CAPABILITY_NOT_HELD";

export type DetermineFromActualDataResult =
  | {
      status: "DETERMINED";
      line: ShipmentLine;
      snapshot: ActualEmissionSnapshot;
      // True whenever there was nothing cross-org to report
      // (snapshot.sharing_grant_id === null -- an own-org determination)
      // OR the record_shared_data_consumption RPC (S8, master plan §9:
      // "consumption events ... recorded on BOTH orgs' audit streams")
      // reported OK. False only when sharing_grant_id is non-null AND
      // that RPC call failed or returned a non-OK status -- see this
      // module's own file-level context below for why that does NOT
      // flip the overall result to REJECTED: the shipment_lines UPDATE
      // above has already durably committed by the time this call runs,
      // so reporting REJECTED here would misrepresent database state
      // (the line WAS determined) for a mutation this function has no
      // compensating-transaction mechanism to unwind. This field is the
      // non-silent signal instead -- a caller (the server action today;
      // a reconciliation job or UI warning later) can act on a
      // false here without this being indistinguishable from a fully
      // clean success, the same "returns whether it succeeded rather
      // than throwing or silently swallowing" posture recordAuditEvent's
      // own doc comment already establishes for the importer-side audit
      // event, applied here via a typed result field instead of a
      // boolean return value because the compliance stakes of the
      // GRANTOR never learning their data was read are higher than an
      // ordinary same-org audit gap.
      crossOrgConsumptionRecorded: boolean;
    }
  | { status: "REJECTED"; reason: DetermineFromActualDataRejectionReason };

interface LineForDetermination {
  org_id: string;
  emission_determination: EmissionDetermination | null;
}

/**
 * Same shape and reasoning as fetchLineForResolution in
 * resolve-line-emissions.ts (deliberately NOT extracted into a shared
 * helper -- see this module's own file-level context: every
 * application-service file in this codebase carries its own similarly-
 * shaped private fetch-and-ownership-check helper rather than a shared
 * one). `orgId` is the caller's *active* org, not necessarily the org
 * that owns `lineId` -- without this check a caller whose active org is
 * A, submitting a lineId that actually belongs to their other org B,
 * would write B's determination and audit event under A's org_id.
 * Rejecting as LINE_NOT_FOUND (not a more specific reason) matches how
 * an out-of-scope id is treated everywhere else in this codebase. Only
 * org_id/emission_determination are selected -- unlike
 * fetchLineForResolution, this determination path never touches
 * cn_code/origin_country/production_route_indicator (those feed the
 * regulatory resolver only; an ACTUAL determination is built entirely
 * from the emission_data row).
 */
async function fetchLineForDetermination(
  supabase: SupabaseClient,
  orgId: OrganizationId,
  lineId: ShipmentLineId,
): Promise<
  | { status: "OK"; line: LineForDetermination }
  | { status: "REJECTED"; reason: DetermineFromActualDataRejectionReason }
> {
  const { data, error } =
    await supabase
      .from("shipment_lines")
      .select(
        "org_id, emission_determination",
      )
      .eq("id", lineId)
      .maybeSingle();

  if (error) {
    return {
      status: "REJECTED",
      reason: "FETCH_FAILED",
    };
  }

  if (!data) {
    return {
      status: "REJECTED",
      reason: "LINE_NOT_FOUND",
    };
  }

  const line =
    data as LineForDetermination;

  if (line.org_id !== orgId) {
    return {
      status: "REJECTED",
      reason: "LINE_NOT_FOUND",
    };
  }

  return {
    status: "OK",
    line,
  };
}

interface AuthorizedEmissionData {
  record: EmissionData;
  sharingGrantId: SharingGrantId | null;
}

/**
 * Fetches `emissionDataId` through the ordinary RLS-scoped `supabase`
 * client and re-checks status/verification_status explicitly (Wall 1
 * app + Wall 2 RLS, never rely on RLS alone -- same discipline
 * fetchLineForResolution/verifyInstallationOwnership already apply
 * elsewhere in this codebase), even though RLS
 * (emission_data_select_own_org, 20260829260000) already guarantees any
 * row this SELECT returns is either owned by the caller's own org or
 * ACTIVE+VERIFIED for an installation the caller's org holds an ACTIVE
 * sharing grant for -- see this migration's header comment. Every
 * failure mode short of a genuine FETCH_FAILED (doesn't exist, RLS hid
 * it, exists but not ACTIVE+VERIFIED) collapses into the single
 * EMISSION_DATA_NOT_FOUND reason, matching this codebase's consistent
 * non-leaky-rejection posture (fetchOwnedEmissionData's own NOT_FOUND
 * in manage-emission-data.ts is the same pattern) -- a caller must never
 * be able to distinguish "doesn't exist" from "exists but unverified"
 * from "exists but belongs to someone else with no grant".
 */
async function fetchAuthorizedEmissionData(
  supabase: SupabaseClient,
  orgId: OrganizationId,
  emissionDataId: EmissionDataId,
): Promise<
  | { status: "OK"; data: AuthorizedEmissionData }
  | { status: "REJECTED"; reason: DetermineFromActualDataRejectionReason }
> {
  const { data, error } =
    await supabase
      .from("emission_data")
      .select(
        EMISSION_DATA_COLUMNS,
      )
      .eq("id", emissionDataId)
      .maybeSingle();

  if (error) {
    return {
      status: "REJECTED",
      reason: "FETCH_FAILED",
    };
  }

  if (!data) {
    return {
      status: "REJECTED",
      reason: "EMISSION_DATA_NOT_FOUND",
    };
  }

  const record =
    toEmissionData(
      data as EmissionDataRow,
    );

  if (record.status !== "ACTIVE" || record.verification_status !== "VERIFIED") {
    return {
      status: "REJECTED",
      reason: "EMISSION_DATA_NOT_FOUND",
    };
  }

  // LIVE evidence-completeness re-check, not a one-time gate trusted
  // from whenever verification/activation happened -- the owner's
  // blocking-model directive is explicit that a consumer must not use
  // an incomplete actual record as verified ACTUAL in present tense,
  // not "was complete once". verifyEmissionData and activateEmissionData
  // (manage-emission-data.ts) already check this at their own gates,
  // but evidence_file_ids can still shrink AFTER activation
  // (removeEvidenceFile in upload-evidence.ts does not itself gate
  // removal against verification_status -- a separate, tracked gap), so
  // a stale verification_status='VERIFIED' alone must never be trusted
  // here. Collapsed into the SAME EMISSION_DATA_NOT_FOUND reason as
  // every other ineligibility above, deliberately -- this function's own
  // doc comment already establishes that no failure mode short of a
  // genuine FETCH_FAILED may be distinguishable from any other by a
  // caller (own-org or cross-org via a sharing grant); "evidence was
  // since removed" joins "doesn't exist" / "exists but unverified" /
  // "exists but belongs to someone else with no grant" in that same
  // non-leaky posture rather than introducing an EVIDENCE_INCOMPLETE
  // reason here that would let a caller distinguish this specific case.
  const completeness =
    checkEmissionDataEvidenceCompleteness(
      record,
    );

  if (completeness.status === "INCOMPLETE") {
    return {
      status: "REJECTED",
      reason: "EMISSION_DATA_NOT_FOUND",
    };
  }

  if (record.entered_by_org_id === orgId) {
    return {
      status: "OK",
      data: {
        record,
        sharingGrantId: null,
      },
    };
  }

  // Cross-org read: the SELECT above could only have returned this row
  // because app.user_shared_installation_ids() (20260829260000) proved
  // the caller's org holds an ACTIVE, unexpired sharing_grants row for
  // record.installation_id -- so this lookup is expected to always find
  // exactly one row (the partial unique index
  // sharing_grants_installation_grantee_active_uq guarantees at most
  // one). expires_at is re-checked here too (defense in depth, not
  // trusting the RLS boundary alone), even though the same partial index
  // plus RLS's own `expires_at is null or expires_at > now()` clause
  // already make a genuinely-expired-but-still-ACTIVE row a
  // contradiction in terms.
  const { data: grantData, error: grantError } =
    await supabase
      .from("sharing_grants")
      .select(
        "id, expires_at",
      )
      .eq("installation_id", record.installation_id)
      .eq("grantee_org_id", orgId)
      .eq("status", "ACTIVE")
      .maybeSingle();

  if (grantError) {
    return {
      status: "REJECTED",
      reason: "FETCH_FAILED",
    };
  }

  const grant =
    grantData as { id: string; expires_at: string | null } | null;

  const grantIsLive =
    grant && (grant.expires_at === null || new Date(grant.expires_at) > new Date());

  if (!grantIsLive) {
    // Genuine inconsistency: RLS already proved a valid ACTIVE grant
    // exists for this org+installation (that is the only way the
    // emission_data SELECT above could have returned this row at all),
    // yet this direct query for that same grant found nothing live.
    // This should be unreachable in normal operation -- reaching it
    // anyway means something changed between the two reads (e.g. the
    // grant was revoked in the race window between this call's own two
    // queries) or a schema assumption here doesn't hold. Either way,
    // DATA_INTEGRITY_ERROR is strictly safer than silently emitting a
    // cross-org snapshot with a null grant reference, which would make
    // the frozen snapshot look like an own-org determination it isn't.
    return {
      status: "REJECTED",
      reason: "DATA_INTEGRITY_ERROR",
    };
  }

  return {
    status: "OK",
    data: {
      record,
      sharingGrantId: grant.id as SharingGrantId,
    },
  };
}

interface PerformDeterminationOptions {
  allowOverwrite: boolean;
  auditEventType: string;
  // Fed straight through to record_shared_data_consumption's own
  // p_determination_kind (validated there against this exact pair by
  // that function's own CHECK -- see 20260829310000). Distinct from
  // auditEventType (which both determine/redetermine already share,
  // per redetermineLineFromActualData's own doc comment) so the
  // GRANTOR-side event can still distinguish a first-time consumption
  // from a redetermination without depending on auditEventType's own
  // naming staying in sync with this RPC's enum.
  determinationKind: "DETERMINED" | "REDETERMINED";
}

async function performDetermination(
  supabase: SupabaseClient,
  orgId: OrganizationId,
  actorUserId: UserId,
  lineId: ShipmentLineId,
  emissionDataId: EmissionDataId,
  options: PerformDeterminationOptions,
): Promise<DetermineFromActualDataResult> {
  const fetchedLine =
    await fetchLineForDetermination(
      supabase,
      orgId,
      lineId,
    );

  if (fetchedLine.status === "REJECTED") {
    return fetchedLine;
  }

  const { line } =
    fetchedLine;

  if (line.emission_determination && !options.allowOverwrite) {
    return {
      status: "REJECTED",
      reason: "ALREADY_DETERMINED",
    };
  }

  const fetchedEmissionData =
    await fetchAuthorizedEmissionData(
      supabase,
      orgId,
      emissionDataId,
    );

  if (fetchedEmissionData.status === "REJECTED") {
    return fetchedEmissionData;
  }

  const { record, sharingGrantId } =
    fetchedEmissionData.data;

  // EmissionData.verifier_user_id is typed UserId | null (a record can
  // rest in any verification_status), but
  // ActualEmissionSnapshot.verification.verifier_user_id is typed
  // non-null UserId -- a row that is genuinely
  // verification_status='VERIFIED' must have gone through
  // verifyEmissionData (manage-emission-data.ts), which always sets
  // verifier_user_id in the same update as the status flip, so this
  // should never actually be null here. Treated as a data-integrity
  // error rather than silently coerced into a fake id (which would
  // forge an attribution in a frozen, audited snapshot) or a runtime
  // throw (which would break this function's established
  // discriminated-result contract, the same one
  // ResolveLineEmissionsResult already uses for every other expected
  // outcome here).
  if (!record.verifier_user_id) {
    return {
      status: "REJECTED",
      reason: "DATA_INTEGRITY_ERROR",
    };
  }

  const snapshot: ActualEmissionSnapshot =
    {
      emission_data_id: record.id,
      emission_data_version: record.version,
      installation_id: record.installation_id,
      resolved_at: new Date().toISOString() as IsoTimestamp,

      values: {
        direct_specific: record.direct_specific,
        indirect_specific: record.indirect_specific,
      },

      emission_unit: record.emission_unit,
      methodology: record.methodology,

      verification: {
        status: "VERIFIED",
        verifier_user_id: record.verifier_user_id,
      },

      evidence_file_ids: record.evidence_file_ids,
      sharing_grant_id: sharingGrantId,
    };

  const determination: EmissionDetermination =
    {
      method: "ACTUAL",
      snapshot,
    };

  // Same CAS shape as resolve-line-emissions.ts's performResolution --
  // see that function's own comment for the full race-condition
  // reasoning, copied here rather than re-derived: for a first-time
  // determination, .is("emission_determination", null) makes this a
  // compare-and-swap the database enforces against a concurrent second
  // submit; redetermineLineFromActualData (allowOverwrite: true)
  // intentionally omits it.
  let query =
    supabase
      .from("shipment_lines")
      .update(
        {
          emission_determination: determination,
        },
      )
      .eq("id", lineId);

  if (!options.allowOverwrite) {
    query =
      query.is(
        "emission_determination",
        null,
      );
  }

  const { data, error } =
    await query
      .select(
        SHIPMENT_LINE_COLUMNS,
      )
      .maybeSingle();

  if (error) {
    return {
      status: "REJECTED",
      reason: error.code === "42501" ? "SHIPMENT_NOT_EDITABLE" : "PERSIST_FAILED",
    };
  }

  if (!data) {
    // Zero rows with no error -- same two possible causes
    // performResolution's own comment documents (parent shipment
    // LOCKED/VOID, or a lost CAS race), resolved the identical way: a
    // recheck read distinguishes them rather than reporting a blanket
    // SHIPMENT_NOT_EDITABLE for what might actually be a lost race.
    if (!options.allowOverwrite) {
      const recheck =
        await fetchLineForDetermination(
          supabase,
          orgId,
          lineId,
        );

      if (recheck.status === "OK" && recheck.line.emission_determination) {
        return {
          status: "REJECTED",
          reason: "ALREADY_DETERMINED",
        };
      }
    }

    return {
      status: "REJECTED",
      reason: "SHIPMENT_NOT_EDITABLE",
    };
  }

  const updatedLine =
    toShipmentLine(
      data as ShipmentLineRow,
    );

  await recordAuditEvent(
    supabase,
    {
      orgId,
      actorUserId,
      eventType: options.auditEventType,
      aggregateType: "SHIPMENT_LINE",
      aggregateId: updatedLine.id,
      payload: {
        shipment_id: updatedLine.shipment_id,
        line_number: updatedLine.line_number,
        emission_data_id: snapshot.emission_data_id,
        emission_data_version: snapshot.emission_data_version,
        sharing_grant_id: snapshot.sharing_grant_id,
        determination_method: "ACTUAL",
        // Null on a first-time determination; the prior determination's
        // method/reason/emission_data_id on a redetermine -- see
        // summarizeDeterminationForAudit's own doc comment (found
        // missing in P7's mandatory review).
        previous_determination: summarizeDeterminationForAudit(
          line.emission_determination,
        ),
      },
    },
  );

  const crossOrgConsumptionRecorded =
    await recordSharedDataConsumptionIfCrossOrg(
      supabase,
      snapshot,
      updatedLine.id,
      options.determinationKind,
    );

  return {
    status: "DETERMINED",
    line: updatedLine,
    snapshot,
    crossOrgConsumptionRecorded,
  };
}

interface RecordSharedDataConsumptionRpcRow {
  result_status: string;
  result_audit_event_id: string | null;
}

/**
 * Calls record_shared_data_consumption()
 * (20260829310000_p7d3_shared_data_consumption_audit.sql) -- the only
 * way the GRANTOR org's own audit_events table can ever learn a member
 * of the grantee org actually read/used their shared data (S8, master
 * plan §9: "consumption events ... recorded on BOTH orgs' audit
 * streams"; recordAuditEvent's own doc comment explains why a bare
 * client-side insert can never write into an org other than the
 * caller's own, so this cross-org half needs a dedicated SECURITY
 * DEFINER RPC the same way accept_sharing_grant_invitation() does for
 * the grant-acceptance case).
 *
 * A no-op returning `true` (nothing to record, not a failure) for an
 * own-org determination -- `snapshot.sharing_grant_id === null` is
 * exactly the signal ActualEmissionSnapshot's own doc comment already
 * documents for "this snapshot was read across organizations".
 *
 * Checked, not fire-and-forget: unlike the plain recordAuditEvent()
 * call above (best-effort by that helper's own explicit design, since
 * an ordinary same-org audit gap is recoverable from the mutation's own
 * row history), this RPC's outcome is returned to the caller as
 * `crossOrgConsumptionRecorded` rather than silently discarded -- see
 * DetermineFromActualDataResult's own doc comment for why a failure
 * here does not flip the whole determination to REJECTED (the
 * shipment_lines UPDATE has already durably committed by the time this
 * runs) yet must still be visible rather than swallowed, given the
 * compliance stakes of the grantor never learning their data was
 * consumed.
 */
async function recordSharedDataConsumptionIfCrossOrg(
  supabase: SupabaseClient,
  snapshot: ActualEmissionSnapshot,
  shipmentLineId: string,
  determinationKind: "DETERMINED" | "REDETERMINED",
): Promise<boolean> {
  if (!snapshot.sharing_grant_id) {
    return true;
  }

  const { data, error } =
    await supabase.rpc(
      "record_shared_data_consumption",
      {
        p_sharing_grant_id: snapshot.sharing_grant_id,
        p_installation_id: snapshot.installation_id,
        p_emission_data_id: snapshot.emission_data_id,
        p_emission_data_version: snapshot.emission_data_version,
        p_shipment_line_id: shipmentLineId,
        p_determination_kind: determinationKind,
      },
    );

  if (error) {
    return false;
  }

  const row =
    (data as RecordSharedDataConsumptionRpcRow[] | null)?.[0];

  return row?.result_status === "OK";
}

/**
 * First-time determination from a shared/verified actual-emissions
 * dataset -- rejects ALREADY_DETERMINED rather than silently
 * overwriting, mirroring determineLineEmissions in
 * resolve-line-emissions.ts exactly (same immutability rule:
 * emission_determination is immutable once set regardless of which
 * method produced it -- src/domain/shipments/types.ts's doc comment).
 * Use redetermineLineFromActualData for an explicit, consciously-audited
 * override.
 */
export async function determineLineFromActualData(
  supabase: SupabaseClient,
  context: OrgContext,
  lineId: ShipmentLineId,
  emissionDataId: EmissionDataId,
): Promise<DetermineFromActualDataResult> {
  if (!hasCapability(context, "IMPORTER_DECLARANT")) {
    return {
      status: "REJECTED",
      reason: "CAPABILITY_NOT_HELD",
    };
  }

  return performDetermination(
    supabase,
    context.org_id,
    context.user_id,
    lineId,
    emissionDataId,
    {
      allowOverwrite: false,
      auditEventType: "emission_determination.set",
      determinationKind: "DETERMINED",
    },
  );
}

/**
 * Explicit, audited replacement of an existing determination -- same
 * "re-determination is an explicit audited action, never automatic"
 * rule as redetermineLineEmissions (docs/plans/MASTER_PLAN.md §18).
 * Works symmetrically regardless of the existing determination's own
 * method: a DEFAULT determination can be redetermined to ACTUAL, and an
 * existing ACTUAL determination can be redetermined to a different
 * actual dataset, since ShipmentLine.emission_determination doesn't
 * distinguish by method for the "already determined" check (this
 * module's own file-level context, and ShipmentLine's own doc comment).
 *
 * Audit-event-naming decision: this reuses the SAME event_type strings
 * the DEFAULT path already uses (emission_determination.set /
 * .redetermined) rather than introducing ACTUAL-specific ones, with a
 * `determination_method: "ACTUAL"` field added to the payload to
 * disambiguate. Reasoning: EmissionDetermination is already one domain
 * concept with two methods (src/domain/emissions/types.ts's own
 * discriminated union), not two unrelated concepts -- "this line's
 * determination changed" is the single query-relevant event class an
 * audit trail reader cares about (e.g. "show me every determination
 * change on this line, in order, regardless of how"), and splitting the
 * event_type by method would fragment that one timeline into two
 * namespaces a reader has to know to query separately. The method is
 * still fully recoverable from the payload (and from the persisted
 * emission_determination.method itself), so nothing about method-level
 * detail is lost by sharing the event_type.
 */
export async function redetermineLineFromActualData(
  supabase: SupabaseClient,
  context: OrgContext,
  lineId: ShipmentLineId,
  emissionDataId: EmissionDataId,
): Promise<DetermineFromActualDataResult> {
  if (!hasCapability(context, "IMPORTER_DECLARANT")) {
    return {
      status: "REJECTED",
      reason: "CAPABILITY_NOT_HELD",
    };
  }

  return performDetermination(
    supabase,
    context.org_id,
    context.user_id,
    lineId,
    emissionDataId,
    {
      allowOverwrite: true,
      auditEventType: "emission_determination.redetermined",
      determinationKind: "REDETERMINED",
    },
  );
}

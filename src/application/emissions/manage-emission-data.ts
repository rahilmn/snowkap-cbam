import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import {
  transitionEmissionData,
  type EmissionDataAction,
  type EmissionDataTransitionRejectionReason,
} from "../../domain/emissions/emission-data-lifecycle";

import type {
  EmissionData,
  EmissionDataMethodology,
} from "../../domain/emissions/types";

import type {
  ReportingPeriod,
} from "../../domain/shared/reporting-period";

import {
  parseDecimalString,
} from "../../domain/shared/decimal";

import type {
  EmissionDataId,
  InstallationId,
  OrganizationId,
  UserId,
} from "../../domain/shared/ids";

import {
  hasAdminAccess,
  type OrgContext,
} from "../organizations/org-context";

import {
  recordAuditEvent,
} from "../audit/record-audit-event";

import {
  EMISSION_DATA_COLUMNS,
  reportingPeriodColumns,
  toEmissionData,
  type EmissionDataRow,
} from "./emission-data-mapper";

export async function listEmissionData(
  supabase: SupabaseClient,
  orgId: OrganizationId,
): Promise<EmissionData[]> {
  const { data, error } =
    await supabase
      .from("emission_data")
      .select(
        EMISSION_DATA_COLUMNS,
      )
      .eq("entered_by_org_id", orgId)
      .order("created_at", { ascending: false });

  if (error || !data) {
    return [];
  }

  return (data as EmissionDataRow[]).map(
    toEmissionData,
  );
}

export interface RecordEmissionDataInput {
  installationId: InstallationId;
  cnScope: string[];
  period: ReportingPeriod;
  directSpecific: string;
  indirectSpecific: string;
  emissionUnit: string;
  methodology: EmissionDataMethodology;
}

export type RecordEmissionDataResult =
  | { status: "OK"; record: EmissionData }
  | {
      status: "REJECTED";
      reason:
        | "EMPTY_CN_SCOPE"
        | "INVALID_DIRECT_SPECIFIC"
        | "INVALID_INDIRECT_SPECIFIC"
        | "INSTALLATION_NOT_FOUND"
        | "PERSIST_FAILED";
    };

interface InstallationOwnershipRow {
  org_id: string;
}

/**
 * `orgId` is the caller's *active* org -- same "verify a referenced
 * parent belongs to my org" shape as verifyOperatorOwnership in
 * manage-installations.ts (this session), just checking installations
 * instead of operators. Without this, a caller whose active org is A,
 * submitting an installationId that actually belongs to their other
 * org B, would rely entirely on emission_data_insert_own_org's RLS
 * EXISTS clause to reject the insert -- correct, but Wall 1
 * (application) should not depend on Wall 2 (RLS) alone catching this.
 * Rejecting as INSTALLATION_NOT_FOUND (not a more specific reason)
 * matches how an out-of-scope id is treated elsewhere in this codebase.
 */
async function verifyInstallationOwnership(
  supabase: SupabaseClient,
  orgId: OrganizationId,
  installationId: InstallationId,
): Promise<
  | { status: "OK" }
  | { status: "REJECTED"; reason: "INSTALLATION_NOT_FOUND" | "PERSIST_FAILED" }
> {
  const { data, error } =
    await supabase
      .from("installations")
      .select(
        "org_id",
      )
      .eq("id", installationId)
      .maybeSingle();

  if (error) {
    return {
      status: "REJECTED",
      reason: "PERSIST_FAILED",
    };
  }

  if (!data || (data as InstallationOwnershipRow).org_id !== orgId) {
    return {
      status: "REJECTED",
      reason: "INSTALLATION_NOT_FOUND",
    };
  }

  return {
    status: "OK",
  };
}

/**
 * Creates a new DRAFT EmissionData row. Per
 * src/domain/emissions/emission-data-lifecycle.ts's own doc comment,
 * version/predecessor_id form a per (installation, period) lineage --
 * cn_scope is deliberately NOT part of that lineage key here, matching
 * the same simplification the one-ACTIVE-per-scope unique index makes
 * (see the P7-B migration's header comment for the full reasoning).
 * Looks up the current ACTIVE record for the same installation+period
 * (if any) to compute version = predecessor.version + 1; when none
 * exists this is the first version (version 1, predecessor_id null).
 */
export async function recordEmissionData(
  supabase: SupabaseClient,
  orgId: OrganizationId,
  actorUserId: UserId,
  input: RecordEmissionDataInput,
): Promise<RecordEmissionDataResult> {
  if (input.cnScope.length === 0) {
    return {
      status: "REJECTED",
      reason: "EMPTY_CN_SCOPE",
    };
  }

  const directSpecific =
    parseDecimalString(
      input.directSpecific,
    );

  if (directSpecific.status !== "OK") {
    return {
      status: "REJECTED",
      reason: "INVALID_DIRECT_SPECIFIC",
    };
  }

  const indirectSpecific =
    parseDecimalString(
      input.indirectSpecific,
    );

  if (indirectSpecific.status !== "OK") {
    return {
      status: "REJECTED",
      reason: "INVALID_INDIRECT_SPECIFIC",
    };
  }

  const ownership =
    await verifyInstallationOwnership(
      supabase,
      orgId,
      input.installationId,
    );

  if (ownership.status === "REJECTED") {
    return ownership;
  }

  const periodColumns =
    reportingPeriodColumns(
      input.period,
    );

  // Deliberately NOT filtered to status='ACTIVE' -- version/predecessor_id
  // must be computed from the LATEST row in the (installation, period)
  // lineage regardless of status, not just the currently-ACTIVE one
  // (found in P7's mandatory review: two DRAFT corrections recorded in a
  // row, before either is ever activated, both looked up "the current
  // ACTIVE row" -- which hadn't changed between them -- and both got the
  // SAME version number with the SAME predecessor_id, forking the
  // lineage into two same-numbered rows instead of a chain). Ordering by
  // version descending with limit(1) keeps this a single-row lookup
  // (.maybeSingle() would otherwise error on 2+ matching rows once the
  // status filter is gone) -- see emission_data_version_uq and
  // emission_data_predecessor_id_uq (20260829290000) for the DB-level
  // backstop against this same class of collision.
  let latestVersionQuery =
    supabase
      .from("emission_data")
      .select(
        "id, version",
      )
      .eq("installation_id", input.installationId)
      .eq("entered_by_org_id", orgId)
      .eq("reporting_period_kind", periodColumns.reporting_period_kind)
      .eq("reporting_period_year", periodColumns.reporting_period_year);

  latestVersionQuery =
    periodColumns.reporting_period_quarter === null
      ? latestVersionQuery.is("reporting_period_quarter", null)
      : latestVersionQuery.eq("reporting_period_quarter", periodColumns.reporting_period_quarter);

  const { data: latestVersionRow, error: latestVersionError } =
    await latestVersionQuery
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

  if (latestVersionError) {
    return {
      status: "REJECTED",
      reason: "PERSIST_FAILED",
    };
  }

  const latestRecord =
    latestVersionRow as { id: string; version: number } | null;

  const version =
    latestRecord
      ? latestRecord.version + 1
      : 1;

  const predecessorId =
    latestRecord
      ? latestRecord.id
      : null;

  const { data, error } =
    await supabase
      .from("emission_data")
      .insert(
        {
          installation_id: input.installationId,
          entered_by_org_id: orgId,
          cn_scope: input.cnScope,
          ...periodColumns,
          direct_specific: directSpecific.value,
          indirect_specific: indirectSpecific.value,
          emission_unit: input.emissionUnit,
          methodology: input.methodology,
          version,
          predecessor_id: predecessorId,
        },
      )
      .select(
        EMISSION_DATA_COLUMNS,
      )
      .single();

  if (error || !data) {
    return {
      status: "REJECTED",
      reason: "PERSIST_FAILED",
    };
  }

  const record =
    toEmissionData(
      data as EmissionDataRow,
    );

  await recordAuditEvent(
    supabase,
    {
      orgId,
      actorUserId,
      eventType: "emission_data.recorded",
      aggregateType: "EMISSION_DATA",
      aggregateId: record.id,
      payload: {
        installation_id: record.installation_id,
        version: record.version,
        predecessor_id: record.predecessor_id,
      },
    },
  );

  return {
    status: "OK",
    record,
  };
}

export type EmissionDataActionResult =
  | { status: "OK"; record: EmissionData }
  | {
      status: "REJECTED";
      reason:
        | EmissionDataTransitionRejectionReason
        | "NOT_FOUND"
        | "FETCH_FAILED"
        | "PERSIST_FAILED"
        | "PERMISSION_DENIED";
    };

/**
 * `orgId` is the caller's *active* org, not necessarily the org that
 * owns `emissionDataId` -- same reasoning as transitionShipmentStatus
 * in transition-shipment.ts: without this check a caller whose active
 * org is A, submitting an emissionDataId that actually belongs to their
 * other org B, would apply the transition to B's record while the
 * audit event records A's org_id. Rejecting as NOT_FOUND (not a more
 * specific reason) matches the rest of this codebase.
 */
async function fetchOwnedEmissionData(
  supabase: SupabaseClient,
  orgId: OrganizationId,
  emissionDataId: EmissionDataId,
): Promise<
  | { status: "OK"; record: EmissionData }
  | { status: "REJECTED"; reason: "NOT_FOUND" | "FETCH_FAILED" }
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

  if (!data || (data as EmissionDataRow).entered_by_org_id !== orgId) {
    return {
      status: "REJECTED",
      reason: "NOT_FOUND",
    };
  }

  return {
    status: "OK",
    record: toEmissionData(
      data as EmissionDataRow,
    ),
  };
}

const AUDIT_EVENT_TYPE_BY_ACTION: Record<EmissionDataAction["action"], string> =
  {
    SUBMIT_FOR_VERIFICATION: "emission_data.submitted",
    VERIFY: "emission_data.verified",
    REJECT: "emission_data.rejected",
    ACTIVATE: "emission_data.activated",
    DISCARD: "emission_data.discarded",
  };

/**
 * Fetches the record, applies the pure transitionEmissionData function
 * (already tested) to decide whether the transition is allowed, and
 * only then persists exactly the columns that action can change --
 * same "fetch, apply pure lifecycle function, persist, audit" shape as
 * transitionShipmentStatus in transition-shipment.ts. ACTIVATE is
 * deliberately NOT routed through this helper -- it is a two-row
 * operation (see activateEmissionData below), which this single-row
 * persist cannot express.
 */
async function applyTransition(
  supabase: SupabaseClient,
  orgId: OrganizationId,
  actorUserId: UserId,
  emissionDataId: EmissionDataId,
  action: Exclude<EmissionDataAction, { action: "ACTIVATE" }>,
  updateColumns: (record: EmissionData) => Record<string, unknown>,
): Promise<EmissionDataActionResult> {
  const fetched =
    await fetchOwnedEmissionData(
      supabase,
      orgId,
      emissionDataId,
    );

  if (fetched.status === "REJECTED") {
    return fetched;
  }

  const transition =
    transitionEmissionData(
      fetched.record,
      action,
    );

  if (transition.status === "REJECTED") {
    return transition;
  }

  const { error } =
    await supabase
      .from("emission_data")
      .update(
        updateColumns(
          transition.record,
        ),
      )
      .eq("id", emissionDataId);

  if (error) {
    return {
      status: "REJECTED",
      reason: "PERSIST_FAILED",
    };
  }

  await recordAuditEvent(
    supabase,
    {
      orgId,
      actorUserId,
      eventType: AUDIT_EVENT_TYPE_BY_ACTION[action.action],
      aggregateType: "EMISSION_DATA",
      aggregateId: emissionDataId,
      payload: {
        from_verification_status: fetched.record.verification_status,
        to_verification_status: transition.record.verification_status,
        from_status: fetched.record.status,
        to_status: transition.record.status,
      },
    },
  );

  return {
    status: "OK",
    record: transition.record,
  };
}

export async function submitForVerification(
  supabase: SupabaseClient,
  orgId: OrganizationId,
  actorUserId: UserId,
  emissionDataId: EmissionDataId,
): Promise<EmissionDataActionResult> {
  return applyTransition(
    supabase,
    orgId,
    actorUserId,
    emissionDataId,
    { action: "SUBMIT_FOR_VERIFICATION" },
    (record) => (
      {
        verification_status: record.verification_status,
        rejection_reason: record.rejection_reason,
      }
    ),
  );
}

/**
 * ADMIN+ only, per docs/plans/MASTER_PLAN.md §14's roles matrix
 * ("verify/reject ADMIN+") -- checked here, in the application layer,
 * BEFORE any database read, mirroring hasAdminAccess's other call
 * sites (org-context.test.ts) and giving a clean, directly-testable
 * PERMISSION_DENIED result. See this module's own file-level doc
 * comment (and the P7-B migration's header comment) for why this is
 * the PRIMARY enforcement layer here, with a DB-level trigger as an
 * independent backstop rather than a bare RLS policy WITH CHECK: a
 * bare policy can only see the proposed new row, not what changed, so
 * it cannot distinguish "verification_status is resting at VERIFIED
 * from a past VERIFY" (which a plain MEMBER's later ACTIVATE/DISCARD
 * must still be allowed to touch) from "verification_status is being
 * set to VERIFIED right now" (which must require ADMIN+) -- that
 * distinction needs an OLD-vs-NEW comparison, which only a trigger can
 * make.
 */
export async function verifyEmissionData(
  supabase: SupabaseClient,
  context: OrgContext,
  emissionDataId: EmissionDataId,
): Promise<EmissionDataActionResult> {
  if (!hasAdminAccess(context)) {
    return {
      status: "REJECTED",
      reason: "PERMISSION_DENIED",
    };
  }

  return applyTransition(
    supabase,
    context.org_id,
    context.user_id,
    emissionDataId,
    { action: "VERIFY", verifierUserId: context.user_id },
    (record) => (
      {
        verification_status: record.verification_status,
        verifier_user_id: record.verifier_user_id,
      }
    ),
  );
}

/**
 * ADMIN+ only -- see verifyEmissionData's doc comment for the full
 * reasoning (identical here).
 */
export async function rejectEmissionData(
  supabase: SupabaseClient,
  context: OrgContext,
  emissionDataId: EmissionDataId,
  rejectionReason: string,
): Promise<EmissionDataActionResult> {
  if (!hasAdminAccess(context)) {
    return {
      status: "REJECTED",
      reason: "PERMISSION_DENIED",
    };
  }

  return applyTransition(
    supabase,
    context.org_id,
    context.user_id,
    emissionDataId,
    { action: "REJECT", rejectionReason },
    (record) => (
      {
        verification_status: record.verification_status,
        rejection_reason: record.rejection_reason,
      }
    ),
  );
}

export async function discardEmissionData(
  supabase: SupabaseClient,
  orgId: OrganizationId,
  actorUserId: UserId,
  emissionDataId: EmissionDataId,
): Promise<EmissionDataActionResult> {
  return applyTransition(
    supabase,
    orgId,
    actorUserId,
    emissionDataId,
    { action: "DISCARD" },
    (record) => (
      {
        status: record.status,
      }
    ),
  );
}

/**
 * ACTIVATE is the producer's explicit "publish" step
 * (emission-data-lifecycle.ts's doc comment) and, uniquely among these
 * actions, a two-row operation: activating this record must also
 * supersede whatever record is currently ACTIVE for the same
 * installation+period (there can be at most one, per the P7-B
 * migration's partial unique index) -- the pure transitionEmissionData
 * function explicitly says this coordination belongs at the
 * application layer, not inside it.
 *
 * The supersede-then-activate order is deliberate: these are two
 * separate PostgREST statements, not one DB transaction (this codebase
 * has no cross-statement transaction mechanism for plain application-
 * layer services -- see record-audit-event.ts's own doc comment on the
 * same limitation), so activating the NEW row before superseding the
 * OLD one would momentarily attempt two ACTIVE rows for the same
 * installation+period and fail against the unique index immediately.
 * Superseding first keeps every individual statement within that
 * constraint. This is still not fully atomic (a crash between the two
 * updates leaves neither row ACTIVE) -- true atomicity would need a
 * SECURITY DEFINER RPC, the same escalation this codebase already made
 * for organization creation, and is a reasonable candidate for a later
 * hardening pass, not silently assumed away here.
 */
export async function activateEmissionData(
  supabase: SupabaseClient,
  orgId: OrganizationId,
  actorUserId: UserId,
  emissionDataId: EmissionDataId,
): Promise<EmissionDataActionResult> {
  const fetched =
    await fetchOwnedEmissionData(
      supabase,
      orgId,
      emissionDataId,
    );

  if (fetched.status === "REJECTED") {
    return fetched;
  }

  const transition =
    transitionEmissionData(
      fetched.record,
      { action: "ACTIVATE" },
    );

  if (transition.status === "REJECTED") {
    return transition;
  }

  const periodColumns =
    reportingPeriodColumns(
      fetched.record.period,
    );

  let priorActiveQuery =
    supabase
      .from("emission_data")
      .select(
        "id",
      )
      .eq("installation_id", fetched.record.installation_id)
      .eq("entered_by_org_id", orgId)
      .eq("status", "ACTIVE")
      .eq("reporting_period_kind", periodColumns.reporting_period_kind)
      .eq("reporting_period_year", periodColumns.reporting_period_year);

  priorActiveQuery =
    periodColumns.reporting_period_quarter === null
      ? priorActiveQuery.is("reporting_period_quarter", null)
      : priorActiveQuery.eq("reporting_period_quarter", periodColumns.reporting_period_quarter);

  const { data: priorActive, error: priorActiveError } =
    await priorActiveQuery.maybeSingle();

  if (priorActiveError) {
    return {
      status: "REJECTED",
      reason: "PERSIST_FAILED",
    };
  }

  const priorActiveId =
    priorActive
      ? (priorActive as { id: string }).id
      : null;

  if (priorActiveId) {
    const { error: supersedeError } =
      await supabase
        .from("emission_data")
        .update(
          { status: "SUPERSEDED" },
        )
        .eq("id", priorActiveId);

    if (supersedeError) {
      return {
        status: "REJECTED",
        reason: "PERSIST_FAILED",
      };
    }
  }

  const { error: activateError } =
    await supabase
      .from("emission_data")
      .update(
        { status: "ACTIVE" },
      )
      .eq("id", emissionDataId);

  if (activateError) {
    return {
      status: "REJECTED",
      reason: "PERSIST_FAILED",
    };
  }

  await recordAuditEvent(
    supabase,
    {
      orgId,
      actorUserId,
      eventType: "emission_data.activated",
      aggregateType: "EMISSION_DATA",
      aggregateId: emissionDataId,
      payload: {
        superseded_id: priorActiveId,
      },
    },
  );

  return {
    status: "OK",
    record: transition.record,
  };
}

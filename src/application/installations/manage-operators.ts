import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import {
  parseCountryCode,
} from "../../domain/shared/country";

import type {
  InstallationRecordProvenance,
  Operator,
} from "../../domain/installations/types";

import type {
  OperatorId,
  OrganizationId,
} from "../../domain/shared/ids";

import {
  type OrgContext,
} from "../organizations/org-context";

import {
  capabilityAllowsProvenance,
  mayManageOwnInstallationRecords,
} from "./provenance-capability";

import {
  recordAuditEvent,
} from "../audit/record-audit-event";

interface OperatorRow {
  id: string;
  org_id: string;
  provenance: string;
  name: string;
  country: string;
  contact_email: string | null;
  created_at: string;
}

const OPERATOR_COLUMNS =
  "id, org_id, provenance, name, country, contact_email, created_at";

function toOperator(
  row: OperatorRow,
): Operator {
  return {
    id: row.id as Operator["id"],
    org_id: row.org_id as Operator["org_id"],
    provenance: row.provenance as InstallationRecordProvenance,
    name: row.name,
    country: row.country as Operator["country"],
    contact_email: row.contact_email,
    created_at: row.created_at as Operator["created_at"],
  };
}

export async function listOperators(
  supabase: SupabaseClient,
  orgId: OrganizationId,
): Promise<Operator[]> {
  const { data, error } =
    await supabase
      .from("operators")
      .select(
        OPERATOR_COLUMNS,
      )
      .eq("org_id", orgId)
      .order("name", { ascending: true });

  if (error || !data) {
    return [];
  }

  return (data as OperatorRow[]).map(
    toOperator,
  );
}

export interface OperatorInput {
  provenance: InstallationRecordProvenance;
  name: string;
  country: string;
  contactEmail: string | null;
}

export type ManageOperatorResult =
  | { status: "OK"; operator: Operator }
  | {
      status: "REJECTED";
      reason:
        | "INVALID_COUNTRY"
        | "PERSIST_FAILED"
        // The caller's org doesn't hold PRODUCER_OPERATOR -- operators
        // are a producer-only workflow (master plan §6/§14). Checked
        // BEFORE any database read, same posture as every hasAdminAccess
        // gate elsewhere in this codebase (P10/P11 capability-matrix
        // hardening pass -- see docs/architecture/AUTHORIZATION_MATRIX.md's
        // "Capability enforcement" section).
        | "CAPABILITY_NOT_HELD";
    };

export async function createOperator(
  supabase: SupabaseClient,
  context: OrgContext,
  input: OperatorInput,
): Promise<ManageOperatorResult> {
  // 2026-09-03 (owner decision D2). The capability required follows
  // from the PROVENANCE being claimed, not from a fixed role -- see
  // provenance-capability.ts. An importer recording an external
  // operator's details uses IMPORTER_ENTERED; a producer recording its
  // own uses OPERATOR_PROVIDED. The database enforces the same rule
  // (migration 20260903120000); this is here so the message can say
  // which one the caller could legitimately have used.
  if (!capabilityAllowsProvenance(context, input.provenance)) {
    return {
      status: "REJECTED",
      reason: "CAPABILITY_NOT_HELD",
    };
  }

  const orgId =
    context.org_id;

  const actorUserId =
    context.user_id;

  const country =
    parseCountryCode(
      input.country,
    );

  if (country.status !== "OK") {
    return {
      status: "REJECTED",
      reason: "INVALID_COUNTRY",
    };
  }

  const { data, error } =
    await supabase
      .from("operators")
      .insert(
        {
          org_id: orgId,
          provenance: input.provenance,
          name: input.name,
          country: country.value,
          contact_email: input.contactEmail,
        },
      )
      .select(
        OPERATOR_COLUMNS,
      )
      .single();

  if (error || !data) {
    return {
      status: "REJECTED",
      reason: "PERSIST_FAILED",
    };
  }

  const operator =
    toOperator(
      data as OperatorRow,
    );

  await recordAuditEvent(
    supabase,
    {
      orgId,
      actorUserId,
      eventType: "operator.created",
      aggregateType: "OPERATOR",
      aggregateId: operator.id,
      payload: {
        name: operator.name,
      },
    },
  );

  return {
    status: "OK",
    operator,
  };
}

export type RemoveOperatorResult =
  | { status: "OK" }
  | {
      status: "REJECTED";
      reason: "OPERATOR_NOT_FOUND" | "PERSIST_FAILED" | "CAPABILITY_NOT_HELD";
    };

interface OperatorOwnershipRow {
  org_id: string;
}

/**
 * `orgId` is the caller's *active* org, not necessarily the org that
 * owns `operatorId` -- same reasoning as fetchLineForResolution in
 * resolve-line-emissions.ts and removeSupplier in
 * manage-suppliers.ts: RLS alone confines the eventual delete to *an*
 * org the caller belongs to, not specifically this active orgId, so
 * without this check a caller whose active org is A, submitting an
 * operatorId that actually belongs to their other org B, would delete
 * B's operator while the audit event is recorded under A's org_id -- a
 * cross-aggregate audit misattribution. Rejecting as
 * OPERATOR_NOT_FOUND (not a more specific reason) matches how an
 * out-of-scope id is treated elsewhere in this codebase -- it doesn't
 * reveal that the id exists under a different org.
 */
export async function removeOperator(
  supabase: SupabaseClient,
  context: OrgContext,
  operatorId: OperatorId,
): Promise<RemoveOperatorResult> {
  // 2026-09-03 (D2): either kind of organization may act on its OWN
  // records. RLS already scopes this to the caller's org; requiring
  // PRODUCER_OPERATOR here would lock an importer out of the records it
  // just created.
  if (!mayManageOwnInstallationRecords(context)) {
    return {
      status: "REJECTED",
      reason: "CAPABILITY_NOT_HELD",
    };
  }

  const orgId =
    context.org_id;

  const actorUserId =
    context.user_id;

  const { data: existing, error: fetchError } =
    await supabase
      .from("operators")
      .select(
        "org_id",
      )
      .eq("id", operatorId)
      .maybeSingle();

  if (fetchError) {
    return {
      status: "REJECTED",
      reason: "PERSIST_FAILED",
    };
  }

  if (!existing || (existing as OperatorOwnershipRow).org_id !== orgId) {
    return {
      status: "REJECTED",
      reason: "OPERATOR_NOT_FOUND",
    };
  }

  const { error } =
    await supabase
      .from("operators")
      .delete()
      .eq("id", operatorId);

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
      eventType: "operator.removed",
      aggregateType: "OPERATOR",
      aggregateId: operatorId,
    },
  );

  return {
    status: "OK",
  };
}

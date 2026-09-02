import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import {
  parseCountryCode,
} from "../../domain/shared/country";

import type {
  Installation,
  InstallationRecordProvenance,
} from "../../domain/installations/types";

import type {
  InstallationId,
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

interface InstallationRow {
  id: string;
  operator_id: string;
  org_id: string;
  provenance: string;
  name: string;
  country: string;
  un_locode: string | null;
  address: string | null;
  cbam_installation_id: string | null;
  created_at: string;
}

const INSTALLATION_COLUMNS =
  "id, operator_id, org_id, provenance, name, country, un_locode, address, cbam_installation_id, created_at";

function toInstallation(
  row: InstallationRow,
): Installation {
  return {
    id: row.id as Installation["id"],
    operator_id: row.operator_id as Installation["operator_id"],
    org_id: row.org_id as Installation["org_id"],
    provenance: row.provenance as InstallationRecordProvenance,
    name: row.name,
    country: row.country as Installation["country"],
    un_locode: row.un_locode,
    address: row.address,
    cbam_installation_id: row.cbam_installation_id,
    created_at: row.created_at as Installation["created_at"],
  };
}

export async function listInstallations(
  supabase: SupabaseClient,
  orgId: OrganizationId,
): Promise<Installation[]> {
  const { data, error } =
    await supabase
      .from("installations")
      .select(
        INSTALLATION_COLUMNS,
      )
      .eq("org_id", orgId)
      .order("name", { ascending: true });

  if (error || !data) {
    return [];
  }

  return (data as InstallationRow[]).map(
    toInstallation,
  );
}

export async function listInstallationsByOperator(
  supabase: SupabaseClient,
  orgId: OrganizationId,
  operatorId: OperatorId,
): Promise<Installation[]> {
  const { data, error } =
    await supabase
      .from("installations")
      .select(
        INSTALLATION_COLUMNS,
      )
      .eq("org_id", orgId)
      .eq("operator_id", operatorId)
      .order("name", { ascending: true });

  if (error || !data) {
    return [];
  }

  return (data as InstallationRow[]).map(
    toInstallation,
  );
}

export interface InstallationInput {
  operatorId: OperatorId;
  provenance: InstallationRecordProvenance;
  name: string;
  country: string;
  unLocode: string | null;
  address: string | null;
  cbamInstallationId: string | null;
}

export type ManageInstallationResult =
  | { status: "OK"; installation: Installation }
  | {
      status: "REJECTED";
      reason:
        | "INVALID_COUNTRY"
        | "OPERATOR_NOT_FOUND"
        | "PERSIST_FAILED"
        // The caller's org doesn't hold PRODUCER_OPERATOR -- installations
        // are a producer-only workflow (master plan §6/§14). Checked
        // BEFORE any database read, same posture as every hasAdminAccess
        // gate elsewhere in this codebase (P10/P11 capability-matrix
        // hardening pass -- see docs/architecture/AUTHORIZATION_MATRIX.md's
        // "Capability enforcement" section).
        | "CAPABILITY_NOT_HELD";
    };

interface OperatorOwnershipRow {
  org_id: string;
}

/**
 * `orgId` is the caller's *active* org. The operator_id the caller
 * supplies is a plain form input, not something RLS alone should be
 * trusted to gate before we act on it app-side: without this check, a
 * caller whose active org is A, submitting an operatorId that actually
 * belongs to their other org B, would rely entirely on the
 * installations_insert_own_org policy's exists-clause
 * (20260829220000_p7_installations_operators_schema.sql) to reject the
 * insert at the DB layer -- correct, but Wall 1 (application) should
 * not depend on Wall 2 (RLS) alone catching this, per
 * docs/plans/MASTER_PLAN.md §126's "two walls, always both". Rejecting
 * as OPERATOR_NOT_FOUND (not a more specific reason) matches how an
 * out-of-scope id is treated elsewhere in this codebase (see
 * fetchLineForResolution in resolve-line-emissions.ts and
 * removeSupplier in manage-suppliers.ts) -- it doesn't reveal that the
 * id exists under a different org.
 */
async function verifyOperatorOwnership(
  supabase: SupabaseClient,
  orgId: OrganizationId,
  operatorId: OperatorId,
): Promise<
  | { status: "OK" }
  | { status: "REJECTED"; reason: "OPERATOR_NOT_FOUND" | "PERSIST_FAILED" }
> {
  const { data, error } =
    await supabase
      .from("operators")
      .select(
        "org_id",
      )
      .eq("id", operatorId)
      .maybeSingle();

  if (error) {
    return {
      status: "REJECTED",
      reason: "PERSIST_FAILED",
    };
  }

  if (!data || (data as OperatorOwnershipRow).org_id !== orgId) {
    return {
      status: "REJECTED",
      reason: "OPERATOR_NOT_FOUND",
    };
  }

  return {
    status: "OK",
  };
}

export async function createInstallation(
  supabase: SupabaseClient,
  context: OrgContext,
  input: InstallationInput,
): Promise<ManageInstallationResult> {
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

  const ownership =
    await verifyOperatorOwnership(
      supabase,
      orgId,
      input.operatorId,
    );

  if (ownership.status === "REJECTED") {
    return ownership;
  }

  const { data, error } =
    await supabase
      .from("installations")
      .insert(
        {
          operator_id: input.operatorId,
          org_id: orgId,
          provenance: input.provenance,
          name: input.name,
          country: country.value,
          un_locode: input.unLocode,
          address: input.address,
          cbam_installation_id: input.cbamInstallationId,
        },
      )
      .select(
        INSTALLATION_COLUMNS,
      )
      .single();

  if (error || !data) {
    return {
      status: "REJECTED",
      reason: "PERSIST_FAILED",
    };
  }

  const installation =
    toInstallation(
      data as InstallationRow,
    );

  await recordAuditEvent(
    supabase,
    {
      orgId,
      actorUserId,
      eventType: "installation.created",
      aggregateType: "INSTALLATION",
      aggregateId: installation.id,
      payload: {
        name: installation.name,
        operator_id: installation.operator_id,
      },
    },
  );

  return {
    status: "OK",
    installation,
  };
}

export type RemoveInstallationResult =
  | { status: "OK" }
  | {
      status: "REJECTED";
      reason:
        | "INSTALLATION_NOT_FOUND"
        | "INSTALLATION_HAS_DEPENDENTS"
        | "PERSIST_FAILED"
        | "CAPABILITY_NOT_HELD";
    };

interface InstallationOwnershipRow {
  org_id: string;
}

/**
 * Same cross-org-active-id reasoning as removeOperator in
 * manage-operators.ts and removeSupplier in manage-suppliers.ts --
 * see either for the full explanation. Rejecting as
 * INSTALLATION_NOT_FOUND (not a more specific reason) matches how an
 * out-of-scope id is treated elsewhere in this codebase.
 *
 * The DELETE itself can fail with Postgres error 23503
 * (foreign_key_violation) if emission_data or sharing_grants rows still
 * reference this installation -- 20260829270000 changed both of those
 * FKs from ON DELETE CASCADE to ON DELETE RESTRICT specifically so this
 * function can no longer silently cascade-destroy VERIFIED emission
 * data, its evidence, and active sharing grants (found in P7's
 * mandatory review: the RLS "no DELETE policy" on both those tables
 * only ever stopped a direct DELETE, never one arriving via cascade,
 * and cascade deletes are not subject to a child table's RLS at all).
 * INSTALLATION_HAS_DEPENDENTS surfaces that as a real, actionable
 * rejection instead of a generic PERSIST_FAILED. Note this is
 * permanent, not something the caller can clear and retry: the FK
 * fires on the dependent ROW's existence, not its status, so
 * discarding emission_data or revoking a sharing_grant (both status
 * flips, never row deletions -- deliberately, so that history stays
 * intact) does NOT remove the block. An installation that has ever
 * had emission_data or a sharing_grant recorded against it can never
 * be deleted again; only an installation with zero recorded activity
 * can be (P13 adversarial audit finding: the caller-facing message
 * used to imply discard/revoke-then-retry would work, which is false
 * and left users at a dead end -- see app/(producer)/installations/
 * actions.ts's corrected copy).
 */
export async function removeInstallation(
  supabase: SupabaseClient,
  context: OrgContext,
  installationId: InstallationId,
): Promise<RemoveInstallationResult> {
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
      .from("installations")
      .select(
        "org_id",
      )
      .eq("id", installationId)
      .maybeSingle();

  if (fetchError) {
    return {
      status: "REJECTED",
      reason: "PERSIST_FAILED",
    };
  }

  if (!existing || (existing as InstallationOwnershipRow).org_id !== orgId) {
    return {
      status: "REJECTED",
      reason: "INSTALLATION_NOT_FOUND",
    };
  }

  const { error } =
    await supabase
      .from("installations")
      .delete()
      .eq("id", installationId);

  if (error) {
    return {
      status: "REJECTED",
      reason: (error as { code?: string }).code === "23503" ? "INSTALLATION_HAS_DEPENDENTS" : "PERSIST_FAILED",
    };
  }

  await recordAuditEvent(
    supabase,
    {
      orgId,
      actorUserId,
      eventType: "installation.removed",
      aggregateType: "INSTALLATION",
      aggregateId: installationId,
    },
  );

  return {
    status: "OK",
  };
}

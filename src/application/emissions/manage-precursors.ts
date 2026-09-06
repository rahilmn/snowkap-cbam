import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  EmissionDataPrecursor,
  PrecursorProvenance,
} from "../../domain/emissions/declaration-context-types";

import {
  parseDecimalString,
  type DecimalString,
} from "../../domain/shared/decimal";

import type {
  EmissionDataId,
  OrganizationId,
  PrecursorId,
} from "../../domain/shared/ids";

import {
  mayManageOwnInstallationRecords,
} from "../installations/provenance-capability";

import type {
  OrgContext,
} from "../organizations/org-context";

import {
  recordAuditEvent,
} from "../audit/record-audit-event";

const PRECURSOR_COLUMNS =
  "id, emission_data_id, material_description, cn_code, source_description, direct_specific, indirect_specific, emission_unit, provenance, verifier_report_description, created_at, updated_at";

interface PrecursorRow {
  id: string;
  emission_data_id: string;
  material_description: string;
  cn_code: string | null;
  source_description: string | null;
  direct_specific: string | null;
  indirect_specific: string | null;
  emission_unit: string | null;
  provenance: PrecursorProvenance;
  verifier_report_description: string | null;
  created_at: string;
  updated_at: string;
}

function toPrecursor(
  row: PrecursorRow,
): EmissionDataPrecursor {
  return {
    id: row.id as PrecursorId,
    emission_data_id: row.emission_data_id as EmissionDataId,
    material_description: row.material_description,
    cn_code: row.cn_code,
    source_description: row.source_description,
    direct_specific: row.direct_specific as DecimalString | null,
    indirect_specific: row.indirect_specific as DecimalString | null,
    emission_unit: row.emission_unit,
    provenance: row.provenance,
    verifier_report_description: row.verifier_report_description,
    created_at: row.created_at as never,
    updated_at: row.updated_at as never,
  };
}

interface EmissionDataOwnershipRow {
  org_id: string;
  status: string;
}

/**
 * Same shape as manage-declaration-context.ts's own
 * verifyEmissionDataDraft -- deliberately duplicated rather than
 * shared, matching this codebase's own established convention for a
 * small helper used by more than one sibling file in the same
 * directory when sharing it would mean a new file for a five-line
 * function (see e.g. reproduce-calculation-result.ts's own file-local
 * deepEqual next to check-calculation-currency.ts's determinationsEqual,
 * both doing the identical jsonb-key-order-safe comparison).
 */
async function verifyEmissionDataDraft(
  supabase: SupabaseClient,
  orgId: OrganizationId,
  emissionDataId: EmissionDataId,
): Promise<
  | { status: "OK" }
  | { status: "REJECTED"; reason: "RECORD_NOT_FOUND" | "RECORD_NOT_DRAFT" | "PERSIST_FAILED" }
> {
  const { data, error } =
    await supabase
      .from("emission_data")
      .select(
        "org_id:entered_by_org_id, status",
      )
      .eq("id", emissionDataId)
      .maybeSingle();

  if (error) {
    return {
      status: "REJECTED",
      reason: "PERSIST_FAILED",
    };
  }

  const row =
    data as EmissionDataOwnershipRow | null;

  if (!row || row.org_id !== orgId) {
    return {
      status: "REJECTED",
      reason: "RECORD_NOT_FOUND",
    };
  }

  if (row.status !== "DRAFT") {
    return {
      status: "REJECTED",
      reason: "RECORD_NOT_DRAFT",
    };
  }

  return {
    status: "OK",
  };
}

/**
 * Read-only, no capability check -- matches getDeclarationContext's own
 * posture. Ordered by created_at so the list order a producer entered
 * precursors in is preserved.
 */
export async function listPrecursors(
  supabase: SupabaseClient,
  orgId: OrganizationId,
  emissionDataId: EmissionDataId,
): Promise<EmissionDataPrecursor[]> {
  const { data, error } =
    await supabase
      .from("emission_data_precursors")
      .select(
        PRECURSOR_COLUMNS,
      )
      .eq("org_id", orgId)
      .eq("emission_data_id", emissionDataId)
      .order("created_at", { ascending: true });

  if (error || !data) {
    return [];
  }

  return (data as PrecursorRow[]).map(
    toPrecursor,
  );
}

export interface AddPrecursorInput {
  emissionDataId: EmissionDataId;
  materialDescription: string;
  cnCode: string | null;
  sourceDescription: string | null;
  directSpecific: string | null;
  indirectSpecific: string | null;
  emissionUnit: string | null;
  provenance: PrecursorProvenance;
  verifierReportDescription: string | null;
}

export type AddPrecursorResult =
  | { status: "OK"; precursor: EmissionDataPrecursor }
  | {
      status: "REJECTED";
      reason:
        | "CAPABILITY_NOT_HELD"
        | "RECORD_NOT_FOUND"
        | "RECORD_NOT_DRAFT"
        | "EMPTY_MATERIAL_DESCRIPTION"
        | "INVALID_DIRECT_SPECIFIC"
        | "INVALID_INDIRECT_SPECIFIC"
        // v2.1.1 §12: a verifier report description only means
        // anything alongside ACTUAL_WITH_DECLARED_REPORT provenance --
        // the same invariant emission_data_precursors_check enforces
        // in the database, checked here first for a clearer reason.
        | "VERIFIER_REPORT_DESCRIPTION_WITHOUT_DECLARED_REPORT"
        | "PERSIST_FAILED";
    };

export async function addPrecursor(
  supabase: SupabaseClient,
  context: OrgContext,
  input: AddPrecursorInput,
): Promise<AddPrecursorResult> {
  if (!mayManageOwnInstallationRecords(context)) {
    return {
      status: "REJECTED",
      reason: "CAPABILITY_NOT_HELD",
    };
  }

  if (input.materialDescription.trim().length === 0) {
    return {
      status: "REJECTED",
      reason: "EMPTY_MATERIAL_DESCRIPTION",
    };
  }

  let directSpecific: DecimalString | null =
    null;

  if (input.directSpecific !== null) {
    const parsed =
      parseDecimalString(
        input.directSpecific,
      );

    if (parsed.status !== "OK") {
      return {
        status: "REJECTED",
        reason: "INVALID_DIRECT_SPECIFIC",
      };
    }

    directSpecific =
      parsed.value;
  }

  let indirectSpecific: DecimalString | null =
    null;

  if (input.indirectSpecific !== null) {
    const parsed =
      parseDecimalString(
        input.indirectSpecific,
      );

    if (parsed.status !== "OK") {
      return {
        status: "REJECTED",
        reason: "INVALID_INDIRECT_SPECIFIC",
      };
    }

    indirectSpecific =
      parsed.value;
  }

  if (
    input.verifierReportDescription !== null
    && input.provenance !== "ACTUAL_WITH_DECLARED_REPORT"
  ) {
    return {
      status: "REJECTED",
      reason: "VERIFIER_REPORT_DESCRIPTION_WITHOUT_DECLARED_REPORT",
    };
  }

  const orgId =
    context.org_id;

  const ownership =
    await verifyEmissionDataDraft(
      supabase,
      orgId,
      input.emissionDataId,
    );

  if (ownership.status === "REJECTED") {
    return ownership;
  }

  const { data, error } =
    await supabase
      .from("emission_data_precursors")
      .insert(
        {
          org_id: orgId,
          emission_data_id: input.emissionDataId,
          material_description: input.materialDescription,
          cn_code: input.cnCode,
          source_description: input.sourceDescription,
          direct_specific: directSpecific,
          indirect_specific: indirectSpecific,
          emission_unit: input.emissionUnit,
          provenance: input.provenance,
          verifier_report_description: input.verifierReportDescription,
        },
      )
      .select(
        PRECURSOR_COLUMNS,
      )
      .single();

  if (error || !data) {
    return {
      status: "REJECTED",
      reason: "PERSIST_FAILED",
    };
  }

  const row =
    data as PrecursorRow;

  await recordAuditEvent(
    supabase,
    {
      orgId,
      actorUserId: context.user_id,
      eventType: "precursor.added",
      aggregateType: "PRECURSOR",
      aggregateId: row.id,
      payload: {
        emission_data_id: input.emissionDataId,
        provenance: input.provenance,
      },
    },
  );

  return {
    status: "OK",
    precursor: toPrecursor(
      row,
    ),
  };
}

export type RemovePrecursorResult =
  | { status: "OK" }
  | {
      status: "REJECTED";
      reason:
        | "CAPABILITY_NOT_HELD"
        | "PRECURSOR_NOT_FOUND"
        | "RECORD_NOT_DRAFT"
        | "PERSIST_FAILED";
    };

/**
 * A real DELETE, not a soft-retirement -- precursors have no lifecycle
 * of their own to retire through (matching evidence_files' own real-
 * DELETE posture, not emission_data's DISCARD-not-delete one). Only
 * legal while the parent emission_data row is still DRAFT, same gate
 * as addPrecursor.
 */
export async function removePrecursor(
  supabase: SupabaseClient,
  context: OrgContext,
  precursorId: PrecursorId,
): Promise<RemovePrecursorResult> {
  if (!mayManageOwnInstallationRecords(context)) {
    return {
      status: "REJECTED",
      reason: "CAPABILITY_NOT_HELD",
    };
  }

  const orgId =
    context.org_id;

  const { data: existing, error: fetchError } =
    await supabase
      .from("emission_data_precursors")
      .select(
        "id, org_id, emission_data_id",
      )
      .eq("id", precursorId)
      .maybeSingle();

  if (fetchError) {
    return {
      status: "REJECTED",
      reason: "PERSIST_FAILED",
    };
  }

  const precursorRow =
    existing as { id: string; org_id: string; emission_data_id: string } | null;

  if (!precursorRow || precursorRow.org_id !== orgId) {
    return {
      status: "REJECTED",
      reason: "PRECURSOR_NOT_FOUND",
    };
  }

  const ownership =
    await verifyEmissionDataDraft(
      supabase,
      orgId,
      precursorRow.emission_data_id as EmissionDataId,
    );

  if (ownership.status === "REJECTED") {
    if (ownership.reason === "RECORD_NOT_FOUND") {
      return {
        status: "REJECTED",
        reason: "PRECURSOR_NOT_FOUND",
      };
    }

    if (ownership.reason === "RECORD_NOT_DRAFT") {
      return {
        status: "REJECTED",
        reason: "RECORD_NOT_DRAFT",
      };
    }

    return {
      status: "REJECTED",
      reason: "PERSIST_FAILED",
    };
  }

  const { error: deleteError } =
    await supabase
      .from("emission_data_precursors")
      .delete()
      .eq("id", precursorId)
      .eq("org_id", orgId);

  if (deleteError) {
    return {
      status: "REJECTED",
      reason: "PERSIST_FAILED",
    };
  }

  await recordAuditEvent(
    supabase,
    {
      orgId,
      actorUserId: context.user_id,
      eventType: "precursor.removed",
      aggregateType: "PRECURSOR",
      aggregateId: precursorId,
      payload: {
        emission_data_id: precursorRow.emission_data_id,
      },
    },
  );

  return {
    status: "OK",
  };
}

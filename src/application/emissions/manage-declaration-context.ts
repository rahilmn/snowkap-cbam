import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  EmissionDataDeclarationContext,
} from "../../domain/emissions/declaration-context-types";

import type {
  DeclarationContextId,
  EmissionDataId,
  OrganizationId,
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

const DECLARATION_CONTEXT_COLUMNS =
  "id, emission_data_id, production_process_description, uses_purchased_precursors, verifier_report_declared, verifier_report_description, created_at, updated_at";

interface DeclarationContextRow {
  id: string;
  emission_data_id: string;
  production_process_description: string | null;
  uses_purchased_precursors: boolean;
  verifier_report_declared: boolean;
  verifier_report_description: string | null;
  created_at: string;
  updated_at: string;
}

function toDeclarationContext(
  row: DeclarationContextRow,
): EmissionDataDeclarationContext {
  return {
    id: row.id as DeclarationContextId,
    emission_data_id: row.emission_data_id as EmissionDataId,
    production_process_description: row.production_process_description,
    uses_purchased_precursors: row.uses_purchased_precursors,
    verifier_report_declared: row.verifier_report_declared,
    verifier_report_description: row.verifier_report_description,
    created_at: row.created_at as never,
    updated_at: row.updated_at as never,
  };
}

interface EmissionDataOwnershipRow {
  org_id: string;
  status: string;
  verification_status: string;
}

/**
 * Mirrors verifyInstallationOwnership's shape (manage-emission-data.ts)
 * one layer up: `orgId` is the caller's active org, not yet proven to
 * be the org that owns this specific emission_data row. Also checks
 * the row's own `status` AND `verification_status` -- v2.1.1's
 * "pre-publication editability, post-VERIFICATION locking" requirement
 * (§11) needs both of emission_data's two coupled state axes
 * (emission-data-lifecycle.ts's own doc comment), not just one: a
 * record can sit DRAFT + VERIFIED for as long as the producer wants
 * before choosing to ACTIVATE it, so `status === 'DRAFT'` alone is
 * NOT "not yet verified" -- checking only that would leave context
 * editable for the entire DRAFT+VERIFIED window, directly contradicting
 * "post-verification locking". Enforced here, at the application
 * layer, matching emission_data_update_own_org's own stated reasoning
 * for why lifecycle-stage editability is not an RLS concern
 * (20260829230000).
 */
async function verifyEmissionDataEditable(
  supabase: SupabaseClient,
  orgId: OrganizationId,
  emissionDataId: EmissionDataId,
): Promise<
  | { status: "OK" }
  | { status: "REJECTED"; reason: "RECORD_NOT_FOUND" | "RECORD_LOCKED" | "PERSIST_FAILED" }
> {
  const { data, error } =
    await supabase
      .from("emission_data")
      .select(
        "org_id:entered_by_org_id, status, verification_status",
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

  if (row.status !== "DRAFT" || row.verification_status === "VERIFIED") {
    return {
      status: "REJECTED",
      reason: "RECORD_LOCKED",
    };
  }

  return {
    status: "OK",
  };
}

/**
 * Read-only. No capability check (matches listEmissionData's own
 * posture, manage-emission-data.ts) -- anyone who can see the parent
 * emission_data row may see its declared context. `null` means no
 * context has been captured yet, not an error.
 */
export async function getDeclarationContext(
  supabase: SupabaseClient,
  orgId: OrganizationId,
  emissionDataId: EmissionDataId,
): Promise<EmissionDataDeclarationContext | null> {
  const { data, error } =
    await supabase
      .from("emission_data_declaration_context")
      .select(
        DECLARATION_CONTEXT_COLUMNS,
      )
      .eq("org_id", orgId)
      .eq("emission_data_id", emissionDataId)
      .maybeSingle();

  if (error || !data) {
    return null;
  }

  return toDeclarationContext(
    data as DeclarationContextRow,
  );
}

export interface UpsertDeclarationContextInput {
  emissionDataId: EmissionDataId;
  productionProcessDescription: string | null;
  usesPurchasedPrecursors: boolean;
  verifierReportDeclared: boolean;
  verifierReportDescription: string | null;
}

export type UpsertDeclarationContextResult =
  | { status: "OK"; context: EmissionDataDeclarationContext }
  | {
      status: "REJECTED";
      reason:
        | "CAPABILITY_NOT_HELD"
        | "RECORD_NOT_FOUND"
        | "RECORD_LOCKED"
        // v2.1.1 §13: a verifier report description only means
        // anything alongside a declaration that one exists -- the same
        // invariant emission_data_declaration_context_check enforces
        // in the database, checked here first for a clearer reason
        // than a raw constraint-violation error.
        | "VERIFIER_REPORT_DESCRIPTION_WITHOUT_DECLARATION"
        | "PERSIST_FAILED";
    };

/**
 * Create-or-update -- one emission_data row has exactly one
 * declaration context (unique constraint on emission_data_id), so this
 * is always an upsert, never a separate create/update pair. Only legal
 * while the parent emission_data row is still DRAFT and not yet
 * VERIFIED: v2.1.1 §11's "authoritative context for a published
 * dossier version is the context captured by its last successful
 * verification transition" -- once the record is verified, its context
 * is locked, the same way emission_data's own fact columns freeze
 * (though by a different mechanism: a DB trigger for emission_data's
 * facts, an application-layer check here, matching this table's own
 * RLS not encoding lifecycle stage -- see this file's
 * verifyEmissionDataEditable).
 */
export async function upsertDeclarationContext(
  supabase: SupabaseClient,
  context: OrgContext,
  input: UpsertDeclarationContextInput,
): Promise<UpsertDeclarationContextResult> {
  if (!mayManageOwnInstallationRecords(context)) {
    return {
      status: "REJECTED",
      reason: "CAPABILITY_NOT_HELD",
    };
  }

  if (
    input.verifierReportDescription !== null
    && !input.verifierReportDeclared
  ) {
    return {
      status: "REJECTED",
      reason: "VERIFIER_REPORT_DESCRIPTION_WITHOUT_DECLARATION",
    };
  }

  const orgId =
    context.org_id;

  const ownership =
    await verifyEmissionDataEditable(
      supabase,
      orgId,
      input.emissionDataId,
    );

  if (ownership.status === "REJECTED") {
    return ownership;
  }

  const { data, error } =
    await supabase
      .from("emission_data_declaration_context")
      .upsert(
        {
          org_id: orgId,
          emission_data_id: input.emissionDataId,
          production_process_description: input.productionProcessDescription,
          uses_purchased_precursors: input.usesPurchasedPrecursors,
          verifier_report_declared: input.verifierReportDeclared,
          verifier_report_description: input.verifierReportDescription,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "emission_data_id",
        },
      )
      .select(
        DECLARATION_CONTEXT_COLUMNS,
      )
      .single();

  if (error || !data) {
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
      eventType: "declaration_context.upserted",
      aggregateType: "DECLARATION_CONTEXT",
      aggregateId: (data as DeclarationContextRow).id,
      payload: {
        emission_data_id: input.emissionDataId,
        uses_purchased_precursors: input.usesPurchasedPrecursors,
        verifier_report_declared: input.verifierReportDeclared,
      },
    },
  );

  return {
    status: "OK",
    context: toDeclarationContext(
      data as DeclarationContextRow,
    ),
  };
}

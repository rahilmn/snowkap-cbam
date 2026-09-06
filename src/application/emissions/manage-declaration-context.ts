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
 * context has been captured yet -- a real, distinct outcome from a
 * genuine fetch error, which THROWS rather than also returning null.
 *
 * This function backs a producer's own EDIT form
 * (declaration-context-section.tsx): `context?.field ?? ""` fills the
 * form from whatever this returns, and the form's Save button is a
 * full upsert (replace, not a patch). A masked fetch error here would
 * render the form as if nothing had ever been captured, and pressing
 * Save on it would genuinely overwrite real, previously-saved context
 * with empty values -- exactly the failure-handling anti-pattern
 * v2.1.1 section 25 names ("never turn infrastructure/data-access
 * failure into successful empty state"), and the identical class of
 * bug S2's B3 blocker fixed in list-declarations.ts (return [] -> throw).
 * Throwing surfaces a real error.tsx boundary instead of a silently
 * wrong "nothing here yet" form.
 *
 * getDeclarationContextById (below) deliberately does NOT throw --
 * see its own doc comment for why that function's risk profile is
 * different.
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

  if (error) {
    throw new Error(
      `getDeclarationContext: failed to fetch declaration context for ${emissionDataId}: ${error.message}`,
    );
  }

  if (!data) {
    return null;
  }

  return toDeclarationContext(
    data as DeclarationContextRow,
  );
}

/**
 * RLS-trusted variant of getDeclarationContext, for a caller that does
 * NOT own the record -- e.g. an importer freezing a shared record's
 * context into an ActualEmissionSnapshot at determination time
 * (determine-from-actual-data.ts). Deliberately takes no `orgId` and
 * filters by `emission_data_id` alone: the row's own `org_id` is the
 * PRODUCER's, never the caller's, so an explicit `.eq("org_id", ...)`
 * filter here would always return nothing for a legitimate cross-org
 * grantee even after RLS correctly admits the row. Mirrors
 * fetchAuthorizedEmissionData's own posture (determine-from-actual-data.ts)
 * -- the security boundary is entirely
 * emission_data_declaration_context_select_shared
 * (20260906190000_s4_widen_dossier_select_for_grantee.sql), which only
 * admits a shared installation's ACTIVE+VERIFIED emission_data row's
 * context, the same boundary emission_data_select_own_org itself
 * enforces on the parent row. Never use this for an "own org" listing
 * UI -- use getDeclarationContext there, so a bug in this function
 * can't silently leak into a screen that owns the record.
 *
 * Deliberately does NOT throw on a fetch error, unlike
 * getDeclarationContext above -- this function's two callers
 * (determine-from-actual-data.ts's performDetermination, and
 * get-buyer-view.ts) both treat the frozen/displayed context as a
 * best-effort ENRICHMENT of a determination that must not itself fail
 * because of it, the same posture record_provenance/
 * dataset_reporting_period already have on ActualEmissionSnapshot. The
 * Server Action wrapping determineLineFromActualData has no top-level
 * try/catch, so a thrown error here would surface as an unstructured
 * crash instead of the caller's own {status, reason} result shape --
 * a materially worse outcome for a merely-decorative field than
 * freezing null/[] and letting the core (regulatory-relevant)
 * determination succeed.
 */
export async function getDeclarationContextById(
  supabase: SupabaseClient,
  emissionDataId: EmissionDataId,
): Promise<EmissionDataDeclarationContext | null> {
  const { data, error } =
    await supabase
      .from("emission_data_declaration_context")
      .select(
        DECLARATION_CONTEXT_COLUMNS,
      )
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

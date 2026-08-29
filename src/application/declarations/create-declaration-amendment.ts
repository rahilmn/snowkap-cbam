import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  Declaration,
} from "../../domain/declarations/types";

import type {
  DeclarationId,
} from "../../domain/shared/ids";

import {
  hasAdminAccess,
  type OrgContext,
} from "../organizations/org-context";

import {
  recordAuditEvent,
} from "../audit/record-audit-event";

import {
  DECLARATION_COLUMNS,
  periodColumns,
  toDeclaration,
  type DeclarationRow,
} from "./declaration-mapper";

export type CreateDeclarationAmendmentResult =
  | { status: "OK"; declaration: Declaration }
  | {
      status: "REJECTED";
      reason:
        | "PERMISSION_DENIED"
        | "NOT_FOUND"
        // The original isn't FILED_RECORDED yet -- there is nothing to
        // amend; refresh/mark-ready/file it first.
        | "ORIGINAL_NOT_FILED"
        // A non-VOID successor already supersedes this exact original --
        // matches declarations_supersedes_uq's own linear-chain
        // invariant (20260829330000), checked explicitly first so the
        // caller gets a named reason instead of a raw constraint error.
        | "ALREADY_AMENDED"
        | "FETCH_FAILED"
        | "PERSIST_FAILED";
    };

/**
 * ADMIN+-gated, only from a FILED_RECORDED original (master plan §6:
 * "amendments as versions" -- a correction is a new DRAFT row chained by
 * supersedes_declaration_id, never an edit to a filed row). Creates a
 * bare DRAFT with no member_shipment_ids/completeness_report yet --
 * ready for generateOrRefreshDeclarationDraft.ts to populate, exactly
 * the way that function already treats "an existing DRAFT for this
 * period" as its refresh target, an amendment DRAFT included.
 *
 * declarations_insert_own_org's own WITH CHECK
 * (20260829340000_p9_declarations_insert_policy_recursion_fix.sql,
 * via app.declaration_predecessor_matches()) independently re-verifies
 * that `originalDeclarationId` names a declaration in the caller's OWN
 * org and OWN period -- this function's own org_id === original.org_id
 * check below is Wall 1 (application), that policy is Wall 2 (RLS), same
 * two-wall posture as every other cross-row ownership check in this
 * codebase (manage-sharing-grants.ts's verifyInstallationOwnership doc
 * comment).
 */
export async function createDeclarationAmendment(
  supabase: SupabaseClient,
  context: OrgContext,
  originalDeclarationId: DeclarationId,
): Promise<CreateDeclarationAmendmentResult> {
  if (!hasAdminAccess(context)) {
    return {
      status: "REJECTED",
      reason: "PERMISSION_DENIED",
    };
  }

  const { data: row, error: fetchError } =
    await supabase
      .from("declarations")
      .select(
        DECLARATION_COLUMNS,
      )
      .eq("id", originalDeclarationId)
      .maybeSingle();

  if (fetchError) {
    return {
      status: "REJECTED",
      reason: "FETCH_FAILED",
    };
  }

  if (!row) {
    return {
      status: "REJECTED",
      reason: "NOT_FOUND",
    };
  }

  const original =
    toDeclaration(
      row as DeclarationRow,
    );

  if (original.org_id !== context.org_id) {
    return {
      status: "REJECTED",
      reason: "NOT_FOUND",
    };
  }

  if (original.status !== "FILED_RECORDED") {
    return {
      status: "REJECTED",
      reason: "ORIGINAL_NOT_FILED",
    };
  }

  const { data: successorRows, error: successorError } =
    await supabase
      .from("declarations")
      .select(
        "id",
      )
      .eq("supersedes_declaration_id", originalDeclarationId)
      .neq("status", "VOID");

  if (successorError) {
    return {
      status: "REJECTED",
      reason: "FETCH_FAILED",
    };
  }

  if (successorRows && successorRows.length > 0) {
    return {
      status: "REJECTED",
      reason: "ALREADY_AMENDED",
    };
  }

  const columns =
    periodColumns(
      original.reporting_period,
    );

  const { data: inserted, error: insertError } =
    await supabase
      .from("declarations")
      .insert(
        {
          org_id: context.org_id,
          reporting_period_kind: columns.reporting_period_kind,
          reporting_period_year: columns.reporting_period_year,
          reporting_period_quarter: columns.reporting_period_quarter,
          supersedes_declaration_id: originalDeclarationId,
          created_by_user_id: context.user_id,
        },
      )
      .select(
        DECLARATION_COLUMNS,
      )
      .single();

  if (insertError || !inserted) {
    return {
      status: "REJECTED",
      reason: "PERSIST_FAILED",
    };
  }

  const amendment =
    toDeclaration(
      inserted as DeclarationRow,
    );

  await recordAuditEvent(
    supabase,
    {
      orgId: context.org_id,
      actorUserId: context.user_id,
      eventType: "declaration.amendment_created",
      aggregateType: "DECLARATION",
      aggregateId: amendment.id,
      payload: {
        supersedes_declaration_id: originalDeclarationId,
        reporting_period: amendment.reporting_period,
      },
    },
  );

  return {
    status: "OK",
    declaration: amendment,
  };
}

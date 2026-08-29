import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  CompletenessReport,
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
  computeDeclarationDraftFacts,
} from "./compute-declaration-draft-facts";

import {
  DECLARATION_COLUMNS,
  toDeclaration,
  type DeclarationRow,
} from "./declaration-mapper";

export type MarkDeclarationReadyResult =
  | { status: "OK"; declaration: Declaration }
  | {
      status: "REJECTED";
      reason:
        | "PERMISSION_DENIED"
        | "NOT_FOUND"
        | "NOT_DRAFT"
        | "INCOMPLETE"
        | "CONCURRENT_MODIFICATION"
        | "FETCH_FAILED"
        | "PERSIST_FAILED";
      // Present only on INCOMPLETE -- the exact, named blockers the
      // caller (the declaration detail screen) renders, per this task's
      // own "name every blocker explicitly, not a bare boolean"
      // requirement.
      completeness_report?: CompletenessReport;
    };

/**
 * ADMIN+-gated DRAFT -> READY transition (master plan §6/§38). Re-runs
 * computeDeclarationDraftFacts() itself rather than trusting the
 * declaration row's OWN completeness_report -- that field is a DRAFT-time
 * cache generateOrRefreshDeclarationDraft.ts last wrote, and
 * shipment_lines stays editable while its parent shipment is READY (the
 * exact staleness window public.record_declaration_filed()'s own filing-
 * time re-check exists to close, per that migration's section 4 header
 * comment: "a line can be added or re-determined AFTER the completeness
 * gate passed and BEFORE anyone clicks record filed"). Trusting a stale
 * report here would let this function mark READY a period that has
 * since regressed.
 *
 * On success, this ALSO re-writes member_shipment_ids/completeness_report
 * to the freshly-computed values in the same UPDATE that flips status --
 * "freezing member_shipment_ids/completeness_report at that instant"
 * (20260829330000's own header comment on the RLS-allowed DRAFT -> READY
 * transition) means the frozen facts must be the ones this function just
 * verified, not whatever the row happened to hold before this call.
 */
export async function markDeclarationReady(
  supabase: SupabaseClient,
  context: OrgContext,
  declarationId: DeclarationId,
): Promise<MarkDeclarationReadyResult> {
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
      .eq("id", declarationId)
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

  const declaration =
    toDeclaration(
      row as DeclarationRow,
    );

  // Audit-attribution guard: `declarationId` is caller-supplied and
  // could name a real row in a DIFFERENT org (context.org_id is the
  // caller's ACTIVE org, not necessarily this row's) -- rejecting as
  // NOT_FOUND rather than a more specific reason matches
  // transitionShipmentStatus's own fetchLineForResolution posture
  // (never confirm a foreign id exists).
  if (declaration.org_id !== context.org_id) {
    return {
      status: "REJECTED",
      reason: "NOT_FOUND",
    };
  }

  if (declaration.status !== "DRAFT") {
    return {
      status: "REJECTED",
      reason: "NOT_DRAFT",
    };
  }

  const facts =
    await computeDeclarationDraftFacts(
      supabase,
      context.org_id,
      declaration.reporting_period,
    );

  if (!facts.completeness_report.complete) {
    return {
      status: "REJECTED",
      reason: "INCOMPLETE",
      completeness_report: facts.completeness_report,
    };
  }

  // CAS guard (.eq("status", "DRAFT")): closes the exact race this
  // function's own doc comment names -- a concurrent
  // generateOrRefreshDeclarationDraft/second markDeclarationReady call
  // landing between the fetch above and this UPDATE.
  const { data: updated, error: updateError } =
    await supabase
      .from("declarations")
      .update(
        {
          status: "READY",
          member_shipment_ids: facts.member_shipment_ids,
          completeness_report: facts.completeness_report,
        },
      )
      .eq("id", declarationId)
      .eq("status", "DRAFT")
      .select(
        DECLARATION_COLUMNS,
      )
      .maybeSingle();

  if (updateError) {
    return {
      status: "REJECTED",
      reason: "PERSIST_FAILED",
    };
  }

  if (!updated) {
    return {
      status: "REJECTED",
      reason: "CONCURRENT_MODIFICATION",
    };
  }

  const readyDeclaration =
    toDeclaration(
      updated as DeclarationRow,
    );

  await recordAuditEvent(
    supabase,
    {
      orgId: context.org_id,
      actorUserId: context.user_id,
      eventType: "declaration.marked_ready",
      aggregateType: "DECLARATION",
      aggregateId: readyDeclaration.id,
      payload: {
        reporting_period: readyDeclaration.reporting_period,
        member_shipment_ids: facts.member_shipment_ids,
        line_count: facts.completeness_report.line_count,
      },
    },
  );

  return {
    status: "OK",
    declaration: readyDeclaration,
  };
}

import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  Declaration,
} from "../../domain/declarations/types";

import type {
  ReportingPeriod,
} from "../../domain/shared/reporting-period";

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
  periodColumns,
  toDeclaration,
  type DeclarationRow,
} from "./declaration-mapper";

export type GenerateOrRefreshDeclarationDraftResult =
  | { status: "OK"; declaration: Declaration }
  | {
      status: "REJECTED";
      reason:
        // A non-VOID READY declaration already exists for this period --
        // reopen it to DRAFT (out of this function's scope) or wait for
        // it to be filed before starting a fresh one.
        | "PERIOD_HAS_READY_DECLARATION"
        // The period's non-superseded original is already FILED_RECORDED
        // -- use createDeclarationAmendment, not this function, to
        // correct a filed period.
        | "PERIOD_ALREADY_FILED"
        // Lost a race against a concurrent transition (someone else
        // marked this exact DRAFT READY between the fetch and the
        // refresh UPDATE below).
        | "CONCURRENT_MODIFICATION"
        | "PERMISSION_DENIED"
        | "FETCH_FAILED"
        | "PERSIST_FAILED";
    };

/**
 * ADMIN+-gated (master plan §27 screen 22), per docs/plans/MASTER_PLAN.md
 * §6/§38's "generate/refresh" half of declaration preparation: finds the
 * (org, period)'s existing DRAFT and refreshes it, or creates one, from
 * a FRESH computeDeclarationDraftFacts() pass every time -- safe to call
 * repeatedly while DRAFT, since every call recomputes member_shipment_ids
 * and completeness_report from the shipments/lines/calculations tables
 * as they stand right now rather than incrementally patching a prior
 * snapshot.
 *
 * declarations_period_in_preparation_uq/declarations_period_original_uq
 * (20260829330000) mean an INSERT here would fail at the database if a
 * READY or FILED_RECORDED (non-superseded) declaration already exists
 * for this period -- checked explicitly first so the caller gets a
 * named, actionable reason instead of a raw constraint-violation error,
 * matching this codebase's "Wall 1 (application) should not depend on
 * Wall 2 (RLS/constraints) alone" posture (manage-sharing-grants.ts's
 * verifyInstallationOwnership doc comment).
 */
export async function generateOrRefreshDeclarationDraft(
  supabase: SupabaseClient,
  context: OrgContext,
  period: ReportingPeriod,
): Promise<GenerateOrRefreshDeclarationDraftResult> {
  if (!hasAdminAccess(context)) {
    return {
      status: "REJECTED",
      reason: "PERMISSION_DENIED",
    };
  }

  const columns =
    periodColumns(
      period,
    );

  let existingQuery =
    supabase
      .from("declarations")
      .select(
        DECLARATION_COLUMNS,
      )
      .eq("org_id", context.org_id)
      .eq("reporting_period_kind", columns.reporting_period_kind)
      .eq("reporting_period_year", columns.reporting_period_year)
      .neq("status", "VOID");

  existingQuery =
    columns.reporting_period_quarter === null
      ? existingQuery.is("reporting_period_quarter", null)
      : existingQuery.eq("reporting_period_quarter", columns.reporting_period_quarter);

  const { data: existingRows, error: fetchError } =
    await existingQuery;

  if (fetchError) {
    return {
      status: "REJECTED",
      reason: "FETCH_FAILED",
    };
  }

  const existing =
    ((existingRows ?? []) as DeclarationRow[]).map(
      toDeclaration,
    );

  const draft =
    existing.find(
      (declaration) => declaration.status === "DRAFT",
    );

  if (!draft) {
    const ready =
      existing.find(
        (declaration) => declaration.status === "READY",
      );

    if (ready) {
      return {
        status: "REJECTED",
        reason: "PERIOD_HAS_READY_DECLARATION",
      };
    }

    const filedOriginal =
      existing.find(
        (declaration) =>
          declaration.status === "FILED_RECORDED" &&
          declaration.supersedes_declaration_id === null,
      );

    if (filedOriginal) {
      return {
        status: "REJECTED",
        reason: "PERIOD_ALREADY_FILED",
      };
    }
  }

  const facts =
    await computeDeclarationDraftFacts(
      supabase,
      context.org_id,
      period,
    );

  if (draft) {
    // CAS guard (.eq("status", "DRAFT")): without it, a concurrent
    // markDeclarationReady call between the fetch above and this UPDATE
    // would have declarations_update_own_org_pre_filing's own USING
    // clause silently exclude the now-READY row (a zero-row UPDATE
    // is {error: null, data: null} in supabase-js, not an error) --
    // same CAS shape acceptSharingGrant/revokeSharingGrant already use.
    const { data, error } =
      await supabase
        .from("declarations")
        .update(
          {
            member_shipment_ids: facts.member_shipment_ids,
            completeness_report: facts.completeness_report,
          },
        )
        .eq("id", draft.id)
        .eq("status", "DRAFT")
        .select(
          DECLARATION_COLUMNS,
        )
        .maybeSingle();

    if (error) {
      return {
        status: "REJECTED",
        reason: "PERSIST_FAILED",
      };
    }

    if (!data) {
      return {
        status: "REJECTED",
        reason: "CONCURRENT_MODIFICATION",
      };
    }

    const declaration =
      toDeclaration(
        data as DeclarationRow,
      );

    await recordAuditEvent(
      supabase,
      {
        orgId: context.org_id,
        actorUserId: context.user_id,
        eventType: "declaration.draft_refreshed",
        aggregateType: "DECLARATION",
        aggregateId: declaration.id,
        payload: {
          reporting_period: declaration.reporting_period,
          member_shipment_count: facts.member_shipment_ids.length,
          complete: facts.completeness_report.complete,
        },
      },
    );

    return {
      status: "OK",
      declaration,
    };
  }

  const { data, error } =
    await supabase
      .from("declarations")
      .insert(
        {
          org_id: context.org_id,
          reporting_period_kind: columns.reporting_period_kind,
          reporting_period_year: columns.reporting_period_year,
          reporting_period_quarter: columns.reporting_period_quarter,
          member_shipment_ids: facts.member_shipment_ids,
          completeness_report: facts.completeness_report,
          created_by_user_id: context.user_id,
        },
      )
      .select(
        DECLARATION_COLUMNS,
      )
      .single();

  if (error || !data) {
    return {
      status: "REJECTED",
      reason: "PERSIST_FAILED",
    };
  }

  const declaration =
    toDeclaration(
      data as DeclarationRow,
    );

  await recordAuditEvent(
    supabase,
    {
      orgId: context.org_id,
      actorUserId: context.user_id,
      eventType: "declaration.draft_generated",
      aggregateType: "DECLARATION",
      aggregateId: declaration.id,
      payload: {
        reporting_period: declaration.reporting_period,
        member_shipment_count: facts.member_shipment_ids.length,
        complete: facts.completeness_report.complete,
      },
    },
  );

  return {
    status: "OK",
    declaration,
  };
}

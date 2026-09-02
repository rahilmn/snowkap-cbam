import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  DeclarationId,
} from "../../domain/shared/ids";

import {
  hasAdminAccess,
  hasCapability,
  type OrgContext,
} from "../organizations/org-context";

export type RecordDeclarationFiledResult =
  | { status: "OK"; declarationId: DeclarationId }
  | {
      status: "REJECTED";
      reason:
        | "PERMISSION_DENIED"
        // The caller's org doesn't hold IMPORTER_DECLARANT -- declarations
        // are an importer-only workflow (master plan §6/§14). Checked
        // alongside the ADMIN+ role check, before the RPC is ever called
        // (P10/P11 capability-matrix hardening pass -- see
        // docs/architecture/AUTHORIZATION_MATRIX.md's "Capability
        // enforcement" section).
        | "CAPABILITY_NOT_HELD"
        // Never sent to the RPC at all -- the declarant's own filing
        // record is the entire substance of "recording a filing," and
        // is never optional. Named separately from the RPC's own
        // identically-named result_status so a caller can distinguish
        // "rejected before any network call" from "the RPC itself
        // rejected it," though both map to the same user-facing message.
        | "EMPTY_FILED_REFERENCE"
        | "NOT_FOUND"
        | "NOT_ADMIN"
        | "ALREADY_FILED"
        | "NOT_READY"
        | "NO_MEMBER_SHIPMENTS"
        | "SHIPMENTS_NOT_LOCKABLE"
        | "INCOMPLETE"
        // The RPC call itself errored, or returned no row at all
        // (network/transport failure -- distinct from every named
        // result_status above, all of which the RPC returns, never
        // raises).
        | "RPC_FAILED";
    };

interface RecordDeclarationFiledRpcRow {
  result_status: string;
  result_declaration_id: string | null;
}

/**
 * ADMIN+-gated (checked here as defense-in-depth, mirroring
 * acceptSharingGrantInvitation's own posture in manage-sharing-grants.ts
 * -- the RPC below re-derives and re-checks admin status itself from
 * auth.uid(), since it is directly callable via supabase.rpc() with any
 * declaration id, not only through this call site). Thin: calls
 * public.record_declaration_filed() (20260829330000, section 4) and maps
 * its result_status to this module's own discriminated result type --
 * no completeness/locking logic is re-implemented here, since that RPC
 * is the ONE place the READY -> FILED_RECORDED transition, the member
 * shipments' LOCK, and the filed_snapshot aggregation happen atomically
 * together (that migration's own "ATOMICITY -- the decision, stated
 * plainly" header comment).
 *
 * Deliberately records NO audit event of its own: the RPC already
 * inserts BOTH `declaration.filed` and one `shipment.locked` per member
 * shipment, in the SAME transaction as the state changes themselves
 * (20260829330000's own comment on why the audit insert lives inside
 * the SECURITY DEFINER function rather than the caller -- "an audit row
 * that survives a rolled-back filing, or a filing that commits without
 * one, are both worse than the small precedent break"). A second,
 * client-side audit_events insert here would be a duplicate event for
 * the identical fact, not a genuinely new one.
 *
 * `filedReference` is forwarded to the RPC EXACTLY as received --
 * never trimmed, reformatted, or otherwise touched. Declarant-typed
 * filing references are stored byte-for-byte verbatim (this codebase's
 * "never invent, never substitute" posture applied to the one field
 * that is entirely the declarant's own record, not Snowkap's --
 * see the migration's own REGULATORY HONESTY header block). The
 * EMPTY_FILED_REFERENCE pre-check below only CLASSIFIES the string
 * (whitespace-only counts as empty), it never MODIFIES what's sent.
 */
export async function recordDeclarationFiled(
  supabase: SupabaseClient,
  context: OrgContext,
  declarationId: DeclarationId,
  filedReference: string,
): Promise<RecordDeclarationFiledResult> {
  if (!hasAdminAccess(context)) {
    return {
      status: "REJECTED",
      reason: "PERMISSION_DENIED",
    };
  }

  if (!hasCapability(context, "IMPORTER_DECLARANT")) {
    return {
      status: "REJECTED",
      reason: "CAPABILITY_NOT_HELD",
    };
  }

  if (filedReference.trim().length === 0) {
    return {
      status: "REJECTED",
      reason: "EMPTY_FILED_REFERENCE",
    };
  }

  // Pre-flight ACTIVE-org scoping, matching markDeclarationReady's own
  // `declaration.org_id !== context.org_id` guard.
  //
  // `declarationId` is caller-supplied. The RPC (20260829470000) does
  // re-check membership and ADMIN/OWNER against the declaration's OWN
  // org, so this was never an "anyone can file anyone's declaration"
  // hole -- and this guard is deliberately NOT the security boundary,
  // which is why the RPC is left untouched.
  //
  // What it restores is ACTIVE-org scoping: a user who is ADMIN/OWNER of
  // both org A (active) and org B could otherwise replay this Server
  // Action with a READY declaration id from B and file it while acting
  // as A. That also matters because the IMPORTER_DECLARANT check above
  // is evaluated against the ACTIVE org, and the database enforces
  // capabilities nowhere at all -- so without this, B's declaration
  // could be filed on the strength of A's capability.
  //
  // NOT_FOUND rather than anything more specific, matching the sibling:
  // never confirm a foreign id exists. (P13 Bucket C sweep, 2026-08-31.)
  const { data: scopeRow, error: scopeError } =
    await supabase
      .from("declarations")
      .select("org_id")
      .eq("id", declarationId)
      .maybeSingle();

  if (scopeError) {
    return {
      status: "REJECTED",
      reason: "RPC_FAILED",
    };
  }

  const scopedOrgId =
    (scopeRow as { org_id?: string } | null)?.org_id;

  if (!scopedOrgId || scopedOrgId !== context.org_id) {
    return {
      status: "REJECTED",
      reason: "NOT_FOUND",
    };
  }

  const { data, error } =
    await supabase.rpc(
      "record_declaration_filed",
      {
        p_declaration_id: declarationId,
        p_filed_reference: filedReference,
      },
    );

  const row =
    (data as RecordDeclarationFiledRpcRow[] | null)?.[0];

  if (error || !row) {
    return {
      status: "REJECTED",
      reason: "RPC_FAILED",
    };
  }

  switch (row.result_status) {
    case "OK":
      return {
        status: "OK",
        declarationId: row.result_declaration_id as DeclarationId,
      };

    case "NOT_FOUND":
      return { status: "REJECTED", reason: "NOT_FOUND" };

    case "NOT_ADMIN":
      return { status: "REJECTED", reason: "NOT_ADMIN" };

    case "ALREADY_FILED":
      return { status: "REJECTED", reason: "ALREADY_FILED" };

    case "NOT_READY":
      return { status: "REJECTED", reason: "NOT_READY" };

    case "EMPTY_FILED_REFERENCE":
      return { status: "REJECTED", reason: "EMPTY_FILED_REFERENCE" };

    case "NO_MEMBER_SHIPMENTS":
      return { status: "REJECTED", reason: "NO_MEMBER_SHIPMENTS" };

    case "SHIPMENTS_NOT_LOCKABLE":
      return { status: "REJECTED", reason: "SHIPMENTS_NOT_LOCKABLE" };

    case "INCOMPLETE":
      return { status: "REJECTED", reason: "INCOMPLETE" };

    default:
      return { status: "REJECTED", reason: "RPC_FAILED" };
  }
}

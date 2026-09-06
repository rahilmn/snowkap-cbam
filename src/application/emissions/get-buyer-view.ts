import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import {
  listAvailableActualEmissionData,
  type AvailableActualEmissionDataOption,
} from "./list-available-actual-data";

import {
  getDeclarationContextById,
  type DeclarationContextByIdResult,
} from "./manage-declaration-context";

import {
  listPrecursorsById,
  type PrecursorsByIdResult,
} from "./manage-precursors";

import type {
  EmissionDataId,
  OrganizationId,
} from "../../domain/shared/ids";

// 2026-09-06 (S5 cross-phase hardening). Each of the three legs below
// now carries its own {status} rather than a bare value -- this
// screen's whole point is showing a cross-org viewer explicit Yes/No
// readiness claims about a DIFFERENT organization's data, and a
// transient fetch error on any one leg used to collapse to the exact
// same value ("No"/null/[]) a genuine absence produces. See
// getDeclarationContextById's own doc comment (manage-declaration-
// context.ts) for the full reasoning.
export type BuyerViewEvidence =
  // A count only -- never the file list or download links. This
  // codebase never widened evidence_files' own RLS for a sharing-grant
  // grantee (checked: none of the 11 migrations that widen a table for
  // app.user_shared_installation_ids() touch evidence_files), and this
  // feature does not start now -- "evidence... state" (v2.1.1 §19)
  // means completeness, not file access. See v2.1.1 §18's own
  // "do not expand sharing permissions merely to simplify the SME UI".
  | { status: "OK"; count: number }
  | { status: "UNAVAILABLE" };

export interface BuyerViewData {
  option: AvailableActualEmissionDataOption;
  evidence: BuyerViewEvidence;
  declarationContext: DeclarationContextByIdResult;
  precursors: PrecursorsByIdResult;
}

/**
 * S4 (producer/trust/sharing), v2.1.1 §19: everything a "Buyer view &
 * readiness" screen needs for one emission_data record the caller's
 * org may see -- either its own, or a producer's shared, ACTIVE+VERIFIED
 * record (the exact visibility rule listAvailableActualEmissionData's
 * own doc comment states).
 *
 * Deliberately reuses listAvailableActualEmissionData rather than a
 * second query against emission_data with its own join logic -- the
 * SAME function the existing shared-in-data picker
 * (app/(importer)/emissions/page.tsx) already calls, so this screen's
 * facts can never disagree with what that list shows. `cnCode: null`
 * (unscoped) matches that page's own call shape exactly.
 *
 * `null` return means the caller's org cannot see this record at all
 * (not a member of its org, and no ACTIVE grant covers it) -- treated
 * as NOT_FOUND by the caller, not an error, matching this codebase's
 * not-found-not-forbidden IDOR posture elsewhere.
 */
export async function getBuyerView(
  supabase: SupabaseClient,
  orgId: OrganizationId,
  emissionDataId: EmissionDataId,
): Promise<BuyerViewData | null> {
  const listing =
    await listAvailableActualEmissionData(
      supabase,
      orgId,
      null,
    );

  const option =
    listing.options.find(
      (candidate) => candidate.emission_data_id === emissionDataId,
    );

  if (!option) {
    return null;
  }

  const [declarationContext, precursors, evidence] =
    await Promise.all(
      [
        getDeclarationContextById(
          supabase,
          emissionDataId,
        ),
        listPrecursorsById(
          supabase,
          emissionDataId,
        ),
        countEvidenceFiles(
          supabase,
          emissionDataId,
        ),
      ],
    );

  return {
    option,
    evidence,
    declarationContext,
    precursors,
  };
}

interface EvidenceCountRow {
  evidence_file_ids: string[];
}

/**
 * RLS-trusted, by id alone -- same posture as
 * getDeclarationContextById/listPrecursorsById. Only the COUNT is ever
 * read out of the row; see this file's BuyerViewEvidence doc comment on
 * why the file list itself is never exposed to a grantee.
 *
 * 2026-09-06 (S5 cross-phase hardening): returns a discriminated result
 * rather than collapsing a genuine fetch error into the same `0` a
 * record with no evidence also produces -- see BuyerViewEvidence's own
 * doc comment above.
 */
async function countEvidenceFiles(
  supabase: SupabaseClient,
  emissionDataId: EmissionDataId,
): Promise<BuyerViewEvidence> {
  const { data, error } =
    await supabase
      .from("emission_data")
      .select(
        "evidence_file_ids",
      )
      .eq("id", emissionDataId)
      .maybeSingle();

  if (error) {
    return {
      status: "UNAVAILABLE",
    };
  }

  return {
    status: "OK",
    count: data ? (data as EvidenceCountRow).evidence_file_ids.length : 0,
  };
}

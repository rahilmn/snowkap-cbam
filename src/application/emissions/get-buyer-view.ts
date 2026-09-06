import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import {
  listAvailableActualEmissionData,
  type AvailableActualEmissionDataOption,
} from "./list-available-actual-data";

import {
  getDeclarationContextById,
} from "./manage-declaration-context";

import {
  listPrecursorsById,
} from "./manage-precursors";

import type {
  EmissionDataDeclarationContext,
  EmissionDataPrecursor,
} from "../../domain/emissions/declaration-context-types";

import type {
  EmissionDataId,
  OrganizationId,
} from "../../domain/shared/ids";

export interface BuyerViewData {
  option: AvailableActualEmissionDataOption;
  // A count only -- never the file list or download links. This
  // codebase never widened evidence_files' own RLS for a sharing-grant
  // grantee (checked: none of the 11 migrations that widen a table for
  // app.user_shared_installation_ids() touch evidence_files), and this
  // feature does not start now -- "evidence... state" (v2.1.1 §19)
  // means completeness, not file access. See v2.1.1 §18's own
  // "do not expand sharing permissions merely to simplify the SME UI".
  evidenceFileCount: number;
  declarationContext: EmissionDataDeclarationContext | null;
  precursors: EmissionDataPrecursor[];
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

  const [declarationContext, precursors, evidenceFileCount] =
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
    evidenceFileCount,
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
 * read out of the row; see this file's BuyerViewData doc comment on
 * why the file list itself is never exposed to a grantee.
 */
async function countEvidenceFiles(
  supabase: SupabaseClient,
  emissionDataId: EmissionDataId,
): Promise<number> {
  const { data, error } =
    await supabase
      .from("emission_data")
      .select(
        "evidence_file_ids",
      )
      .eq("id", emissionDataId)
      .maybeSingle();

  if (error || !data) {
    return 0;
  }

  return (data as EvidenceCountRow).evidence_file_ids.length;
}

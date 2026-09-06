import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  OrganizationId,
} from "../../domain/shared/ids";

import type {
  RejectedEmissionDataForGuidance,
} from "../../domain/guidance/producer-rejected-emission-data";

interface RejectedEmissionDataRow {
  id: string;
  installation_id: string;
  rejection_reason: string | null;
}

interface InstallationNameRow {
  id: string;
  name: string;
  provenance: string;
}

/**
 * S5 cross-phase hardening (2026-09-06). The guidance-specific narrow
 * fetch behind deriveProducerRejectedEmissionDataItems -- mirrors
 * listDraftShipmentsWithLines' own established shape (a dedicated,
 * narrower query for guidance's own needs, separate from the general-
 * purpose listEmissionData producer-list-screen fetch) for the same
 * reason: listEmissionData still returns `[]` on a genuine fetch
 * error (an already-assessed, non-blocking gap for its own direct
 * callers), which would be exactly the wrong behavior to inherit here
 * -- a fetch failure feeding the guidance dashboard must THROW, so
 * deriveGuidanceItems' own try/catch can turn it into an explicit
 * UNAVAILABLE result instead of a false "nothing needs your
 * attention." Matches this codebase's own "throw is for infrastructure
 * failures" convention (CLAUDE.md).
 */
export async function listRejectedEmissionDataForGuidance(
  supabase: SupabaseClient,
  orgId: OrganizationId,
): Promise<RejectedEmissionDataForGuidance[]> {
  const { data: recordRows, error: recordError } =
    await supabase
      .from("emission_data")
      .select(
        "id, installation_id, rejection_reason",
      )
      .eq("entered_by_org_id", orgId)
      .eq("verification_status", "REJECTED")
      // 2026-09-06 (S5 review remediation, finding EF-B2/S5R-B2). DISCARD
      // is allowed from DRAFT regardless of verification_status and
      // deliberately leaves verification_status untouched (see
      // src/domain/emissions/emission-data-lifecycle.ts), so a
      // discarded-after-rejection record still matches
      // verification_status='REJECTED' -- but DISCARDED is terminal (no
      // transition returns it to DRAFT), so SUBMIT_FOR_VERIFICATION can
      // never succeed on it again. Without this filter the guidance item
      // is permanent and, being REQUIRED, undismissable. Only a DRAFT
      // record is actually resubmittable.
      .eq("status", "DRAFT");

  if (recordError) {
    throw new Error(
      `guidance: rejected emission_data fetch failed (${recordError.message}).`,
    );
  }

  const rows =
    (recordRows ?? []) as RejectedEmissionDataRow[];

  if (rows.length === 0) {
    return [];
  }

  const installationIds =
    Array.from(
      new Set(
        rows.map((row) => row.installation_id),
      ),
    );

  const { data: installationRows, error: installationError } =
    await supabase
      .from("installations")
      .select(
        "id, name, provenance",
      )
      .in("id", installationIds);

  if (installationError) {
    throw new Error(
      `guidance: installations fetch failed (${installationError.message}).`,
    );
  }

  const installationById =
    new Map<string, InstallationNameRow>(
      ((installationRows ?? []) as InstallationNameRow[]).map(
        (row) => [row.id, row],
      ),
    );

  return rows.map(
    (row) => (
      {
        id: row.id as never,
        installation_id: row.installation_id as never,
        installation_name: installationById.get(row.installation_id)?.name ?? "Unknown installation",
        // 2026-09-06 (S5 review remediation, finding D2/EF-B1). Defaults
        // to OPERATOR_PROVIDED (the pre-existing, narrower route) only
        // if the installation itself could not be resolved -- should
        // not happen given the FK, but never claim the wider
        // IMPORTER_ENTERED route on missing data.
        installation_provenance:
          (installationById.get(row.installation_id)?.provenance as never) ?? "OPERATOR_PROVIDED",
        rejection_reason: row.rejection_reason,
      }
    ),
  );
}

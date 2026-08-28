import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  EmissionDataMethodology,
} from "../../domain/emissions/types";

import type {
  ReportingPeriod,
} from "../../domain/shared/reporting-period";

import type {
  DecimalString,
} from "../../domain/shared/decimal";

import type {
  CountryCode,
} from "../../domain/shared/country";

import type {
  EmissionDataId,
  InstallationId,
  OrganizationId,
} from "../../domain/shared/ids";

import {
  EMISSION_DATA_COLUMNS,
  toEmissionData,
  type EmissionDataRow,
} from "./emission-data-mapper";

export type ActualDataProvenance =
  | "OWN"
  | "SHARED";

/**
 * One ACTIVE+VERIFIED emission_data row an importer's active org may pick
 * to determine a shipment line from -- either the org's own data, or data
 * shared to it via an ACTIVE sharing grant (see listAvailableActualEmissionData's
 * own doc comment for the exact visibility rule).
 */
export interface AvailableActualEmissionDataOption {
  emission_data_id: EmissionDataId;
  installation_id: InstallationId;
  installation_name: string;
  installation_country: CountryCode;
  direct_specific: DecimalString;
  indirect_specific: DecimalString;
  emission_unit: string;
  methodology: EmissionDataMethodology;
  reporting_period: ReportingPeriod;
  provenance: ActualDataProvenance;
}

interface InstallationLookupRow {
  id: string;
  name: string;
  country: string;
}

interface SharingGrantLookupRow {
  installation_id: string;
  expires_at: string | null;
}

/**
 * Lists every ACTIVE+VERIFIED emission_data row genuinely available to
 * `orgId` (the caller's *active* org) to determine a line from -- the
 * active org's own rows, plus any ACTIVE+VERIFIED row for an installation
 * the active org itself holds an ACTIVE, unexpired sharing grant for.
 *
 * Deliberately does NOT rely on emission_data_select_own_org's RLS
 * (20260829260000) as the only thing scoping this result, the way an
 * earlier version of this function did. RLS's own visibility is
 * MEMBERSHIP-based (app.user_org_ids() returns every org the
 * authenticated user is a member of), not ACTIVE-org-based -- so for a
 * user who belongs to more than one organization (master plan §14
 * explicitly designs for exactly this: "a user may belong to an importer
 * org and a producer org"), RLS alone would also return that user's
 * OTHER org's own emission_data here, with nothing in this function
 * telling those two cases apart. That row would then be labeled
 * "SHARED" (the only other branch `provenance` has) despite no sharing
 * grant connecting the active org to it at all -- a real cross-tenant
 * data leak into the active org's own shipment screen, and a false
 * provenance claim, both found live in P7's mandatory cross-organization-
 * sharing review (a dual-membership user, active in org S with zero
 * grants, was shown org P's installation name/country/emission values
 * labeled "shared" purely because the same person also happened to be a
 * member of org P). determine-from-actual-data.ts's own
 * fetchAuthorizedEmissionData already fails safe against this shape (its
 * cross-org branch requires a real matching grant row before building a
 * snapshot) -- this function is what actually RENDERS the leak, so it
 * needs the same discipline independently, not by inheriting
 * fetchAuthorizedEmissionData's safety after the fact.
 *
 * Fetches the active org's own ACTIVE sharing grants as grantee once,
 * builds the set of installation_ids genuinely (and currently -- expiry
 * re-checked here too, same `expires_at is null or expires_at > now()`
 * boundary as app.user_shared_installation_ids(), 20260829260000)
 * granted to it, and filters every returned row to
 * `entered_by_org_id === orgId OR installation_id in that set` before
 * anything is labeled or rendered. A row that fails both is silently
 * excluded, not merely mislabeled -- matching this codebase's posture of
 * failing closed rather than exposing data through an inaccurate label.
 *
 * The .eq("status","ACTIVE").eq("verification_status","VERIFIED")
 * clauses on the emission_data query remain Wall 1 defense in depth on
 * top of RLS's own filtering, per this codebase's established
 * discipline (fetchAuthorizedEmissionData; verifyInstallationOwnership
 * in manage-installations.ts) of never depending on RLS alone -- the org
 * -scoping filter added here is the same discipline applied to the
 * ACTIVE-org boundary specifically, which RLS was never positioned to
 * enforce in the first place (RLS enforces "which orgs can this
 * AUTHENTICATED USER see", not "which org is currently ACTIVE").
 *
 * Two separate queries for the installation join (emission_data, then
 * installations for the distinct installation_ids the first query
 * returned) rather than a PostgREST embedded-resource select -- see this
 * function's own git history / prior version of this comment for the
 * full reasoning (no precedent for embedded-resource syntax anywhere in
 * src/application/**, and it keeps this function testable against the
 * established per-table mock-Supabase-client pattern). The sharing_grants
 * lookup is a third such query, same reasoning.
 *
 * Deliberate scope boundaries for this increment (see the task that
 * introduced this function, and its caller,
 * app/(importer)/shipments/[id]/page.tsx):
 *   - Does NOT filter by cn_scope against any particular shipment line's
 *     declared CN code -- every visible ACTIVE+VERIFIED option is
 *     returned regardless of cn_scope, and the picker leaves matching
 *     the right one to the user (a compliance professional who
 *     understands their own data). CN-scope-aware filtering is a later
 *     increment.
 *   - Does NOT resolve or display the grantor organization's *name* for
 *     a SHARED row -- that would need an additional cross-org
 *     organizations lookup this increment doesn't build.
 *     `provenance: "SHARED"` alone is enough to tell the user this is
 *     someone else's data; which someone is a later increment.
 */
export async function listAvailableActualEmissionData(
  supabase: SupabaseClient,
  orgId: OrganizationId,
): Promise<AvailableActualEmissionDataOption[]> {
  const { data, error } =
    await supabase
      .from("emission_data")
      .select(
        EMISSION_DATA_COLUMNS,
      )
      .eq("status", "ACTIVE")
      .eq("verification_status", "VERIFIED")
      .order("created_at", { ascending: false });

  if (error || !data) {
    return [];
  }

  const records =
    (data as EmissionDataRow[]).map(
      toEmissionData,
    );

  if (records.length === 0) {
    return [];
  }

  const { data: grantRows, error: grantError } =
    await supabase
      .from("sharing_grants")
      .select(
        "installation_id, expires_at",
      )
      .eq("grantee_org_id", orgId)
      .eq("status", "ACTIVE");

  if (grantError) {
    return [];
  }

  const now =
    new Date();

  const grantedInstallationIds =
    new Set(
      ((grantRows ?? []) as SharingGrantLookupRow[])
        .filter(
          (grant) => grant.expires_at === null || new Date(grant.expires_at) > now,
        )
        .map(
          (grant) => grant.installation_id,
        ),
    );

  const scopedRecords =
    records.filter(
      (record) => record.entered_by_org_id === orgId || grantedInstallationIds.has(record.installation_id),
    );

  if (scopedRecords.length === 0) {
    return [];
  }

  const installationIds =
    Array.from(
      new Set(
        scopedRecords.map((record) => record.installation_id),
      ),
    );

  const { data: installationRows, error: installationError } =
    await supabase
      .from("installations")
      .select(
        "id, name, country",
      )
      .in("id", installationIds);

  if (installationError || !installationRows) {
    return [];
  }

  const installationById =
    new Map<string, InstallationLookupRow>(
      (installationRows as InstallationLookupRow[]).map(
        (row) => [row.id, row],
      ),
    );

  const options: AvailableActualEmissionDataOption[] =
    [];

  for (const record of scopedRecords) {
    const installation =
      installationById.get(
        record.installation_id,
      );

    if (!installation) {
      // Shouldn't happen in practice -- RLS already proved this same
      // caller can see the emission_data row, and
      // installations_select_own_org (widened by the same P7-D
      // migration) grants identical visibility for its parent
      // installation (own org, or the same sharing grant). Skipping
      // rather than throwing or rendering a broken/partial option keeps
      // this function's established "never crash the picker" contract
      // even if that invariant is ever violated.
      continue;
    }

    options.push(
      {
        emission_data_id: record.id,
        installation_id: record.installation_id,
        installation_name: installation.name,
        installation_country: installation.country as CountryCode,
        direct_specific: record.direct_specific,
        indirect_specific: record.indirect_specific,
        emission_unit: record.emission_unit,
        methodology: record.methodology,
        reporting_period: record.period,
        provenance: record.entered_by_org_id === orgId ? "OWN" : "SHARED",
      },
    );
  }

  return options;
}

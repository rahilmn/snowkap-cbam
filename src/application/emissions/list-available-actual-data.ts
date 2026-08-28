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

/**
 * Lists every ACTIVE+VERIFIED emission_data row visible to `orgId` through
 * the ordinary RLS-scoped `supabase` client -- the caller's own org's
 * rows, plus any ACTIVE+VERIFIED row for an installation `orgId` holds an
 * ACTIVE, unexpired sharing grant for. The explicit
 * .eq("status","ACTIVE").eq("verification_status","VERIFIED") clauses
 * below are Wall 1 (application) defense in depth, not the only thing
 * doing the filtering -- emission_data_select_own_org
 * (20260829260000_p7d_sharing_grants_schema.sql's header comment) already
 * guarantees Wall 2 (RLS) never returns a DRAFT/SUPERSEDED/DISCARDED or
 * UNVERIFIED/VERIFICATION_PENDING/REJECTED row to a grantee, and never
 * returns any other org's row at all unless it's shared -- but this
 * codebase's established discipline (fetchAuthorizedEmissionData in
 * determine-from-actual-data.ts; verifyInstallationOwnership in
 * manage-installations.ts) is to never depend on RLS alone.
 *
 * Two separate queries (emission_data, then installations for the
 * distinct installation_ids the first query returned) rather than a
 * PostgREST embedded-resource select (e.g.
 * `.select("*, installations(name, country)")`) -- chosen because (a)
 * there is no existing precedent for embedded-resource syntax anywhere
 * in src/application/**, every other cross-table read in this codebase
 * (e.g. fetchAuthorizedEmissionData's own sharing_grants lookup just
 * above this module) already uses a second explicit query instead, and
 * (b) it keeps this function trivially testable against the same
 * per-table mock-Supabase-client pattern
 * (manage-emission-data.test.ts's makeMockSupabase) the rest of this
 * codebase's application-layer tests already use, without having to fake
 * PostgREST's embedded-resource response shape.
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

  const installationIds =
    Array.from(
      new Set(
        records.map((record) => record.installation_id),
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

  for (const record of records) {
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

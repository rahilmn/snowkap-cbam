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
  cnScopeCoversCnCode,
} from "../../domain/emissions/cn-scope-covers-code";

import {
  EMISSION_DATA_COLUMNS,
  toEmissionData,
  type EmissionDataRow,
} from "./emission-data-mapper";

export type ActualDataProvenance =
  | "OWN"
  | "SHARED";

// Exported for reuse by any other caller that resolves a grantor org's
// name and needs the exact same "lookup worked but didn't cover this row"
// placeholder text -- see list-actual-determined-lines.ts, which resolves
// grantor names via a different join path (sharing_grants, not
// emission_data.entered_by_org_id) but must render the identical fallback
// so the two "shared-in data" surfaces (the picker here, the emissions
// overview screen there) never visibly disagree on wording.
export const UNKNOWN_GRANTOR_ORGANIZATION_NAME =
  "Unknown organization";

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

  // The grantor org's name for a SHARED row (the row's own
  // entered_by_org_id -- the producer org, not the caller's org); always
  // null for an OWN row, where the concept doesn't apply. See this
  // function's own doc comment for how a lookup failure is distinguished
  // from a genuinely-unresolvable name.
  grantor_organization_name: string | null;
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

interface OrganizationNameLookupRow {
  id: string;
  name: string;
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
 * lookup is a third such query, and the organizations (grantor name)
 * lookup below is a fourth, same reasoning.
 *
 * `cnCode` scopes the result to one shipment line's own declared CN/TARIC
 * code (ShipmentLine.cn_code, src/domain/shipments/types.ts) -- a row is
 * only offered when its cn_scope genuinely covers that code, per
 * cnScopeCoversCnCode's own doc comment (src/domain/emissions/
 * cn-scope-covers-code.ts), which mirrors the same CN8/TARIC10
 * specificity relationship the regulatory resolver's own codeLevelPriority
 * encodes rather than inventing a second convention. A caller building a
 * whole shipment's picker data calls this once per distinct cn_code among
 * the shipment's lines, the same way app/(importer)/shipments/[id]/page.tsx
 * already does for every other per-line lookup on that page.
 *
 * `cnCode === null` skips the cn_scope filter entirely and returns every
 * row the org-visibility/grant scoping above already admits, regardless
 * of what goods it covers -- the unscoped "browse everything available"
 * case app/(importer)/emissions/page.tsx (§27 screen 15's "shared-in
 * producer data" section) needs, which has no single line to scope
 * against. This was added as an optional third state on the existing
 * parameter rather than as a second, sibling function: the org-
 * visibility/grant-scoping logic above (the security-critical half of
 * this function, per its own extensive doc comment) is exactly the part
 * a sibling function would have had to duplicate byte-for-byte to stay
 * correct, and a second independently-maintained copy of that logic is a
 * live risk of the two drifting apart under a future fix -- one applied
 * to only one of them -- in a way a passing test suite for the untouched
 * copy would never catch. Narrowing cnCode to `null` only ever WIDENS
 * which goods a row is offered for, never who is allowed to see the row
 * at all -- the org-scoping/grant-visibility filtering above still runs
 * unconditionally, in the same order, before this optional narrowing --
 * so this parameter can never become a second, weaker path to the same
 * data.
 *
 * Also resolves the grantor organization's *name* for each SHARED row
 * (the row's own entered_by_org_id -- the producer org, not the caller's)
 * via a follow-up `organizations` lookup, using the exact two-follow-up-
 * queries-after-the-main-query convention listMyPendingSharingGrantInvitations
 * (src/application/sharing/manage-sharing-grants.ts) already established
 * for this: if the lookup query itself errors, the WHOLE result is
 * dropped to [] (a transport failure must never be indistinguishable from
 * a fabricated "Unknown organization" placeholder shown for every row);
 * if the query succeeds but a specific grantor org id simply isn't
 * returned, that one row degrades to the UNKNOWN_GRANTOR_ORGANIZATION_NAME
 * placeholder rather than being silently dropped, since the lookup itself
 * is now known to have worked.
 */
export async function listAvailableActualEmissionData(
  supabase: SupabaseClient,
  orgId: OrganizationId,
  cnCode: string | null,
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

  // CN-scope filter: only offer a record whose declared cn_scope actually
  // covers this line's own cn_code -- see this function's own doc comment
  // and cnScopeCoversCnCode's for the matching convention. Applied AFTER
  // the org-visibility filter above (never before it), so this can never
  // widen visibility -- it only ever narrows an already-authorized set.
  // cnCode === null (see this function's own doc comment) skips this
  // narrowing step entirely rather than calling cnScopeCoversCnCode with
  // some sentinel -- every org-visible record passes through unfiltered.
  const cnScopedRecords =
    cnCode === null
      ? scopedRecords
      : scopedRecords.filter(
          (record) => cnScopeCoversCnCode(record.cn_scope, cnCode),
        );

  if (cnScopedRecords.length === 0) {
    return [];
  }

  const installationIds =
    Array.from(
      new Set(
        cnScopedRecords.map((record) => record.installation_id),
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

  // Grantor org name lookup, SHARED rows only -- an OWN row's provenance
  // is already self-evident, so its entered_by_org_id (== orgId) never
  // needs a name resolved for it.
  const grantorOrgIds =
    Array.from(
      new Set(
        cnScopedRecords
          .filter((record) => record.entered_by_org_id !== orgId)
          .map((record) => record.entered_by_org_id),
      ),
    );

  const grantorOrgNameById =
    new Map<string, string>();

  if (grantorOrgIds.length > 0) {
    // 2026-08-31: reads through app.sharing_counterparty_org_names()
    // rather than `organizations` directly. A grantee has no membership
    // in the grantor org, so a direct RLS-scoped read returns NO ROW and
    // every SHARED row silently degraded to the "Unknown organization"
    // placeholder below -- reproduced against the live production
    // deployment, where an importer could not see which producer
    // supplied the figures they were about to declare. The RPC returns
    // ONLY (id, name), and only for a currently-ACTIVE, unexpired grant
    // relationship, so revocation and expiry close it off automatically
    // without disclosing the counterparty's full organizations row.
    // See supabase/migrations/20260831100000_....sql.
    const { data: organizationRows, error: organizationError } =
      await supabase
        .rpc(
          "sharing_counterparty_org_names",
        );

    // A transport/PostgREST failure on this follow-up lookup must never
    // be indistinguishable from a fabricated placeholder name shown for
    // every SHARED row -- same discipline
    // listMyPendingSharingGrantInvitations applies to its own two
    // follow-up lookups (manage-sharing-grants.ts). Dropping the whole
    // result here (rather than only the SHARED rows) also matches this
    // function's own established posture elsewhere in this same
    // function: every other follow-up query failure above (sharing_grants,
    // installations) fails the entire picker closed, not just the rows
    // that specific query would have enriched.
    if (organizationError) {
      return [];
    }

    for (const row of (organizationRows ?? []) as OrganizationNameLookupRow[]) {
      grantorOrgNameById.set(
        row.id,
        row.name,
      );
    }
  }

  const options: AvailableActualEmissionDataOption[] =
    [];

  for (const record of cnScopedRecords) {
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

    const isOwn =
      record.entered_by_org_id === orgId;

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
        provenance: isOwn ? "OWN" : "SHARED",
        grantor_organization_name:
          isOwn
            ? null
            : grantorOrgNameById.get(record.entered_by_org_id) ?? UNKNOWN_GRANTOR_ORGANIZATION_NAME,
      },
    );
  }

  return options;
}

import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  SharingGrant,
} from "../../domain/sharing/types";

import type {
  OrganizationId,
} from "../../domain/shared/ids";

import {
  SHARING_GRANT_COLUMNS,
  toSharingGrant,
  type SharingGrantRow,
} from "./sharing-grant-mapper";

/**
 * One 'sharing_grant.data_consumed' audit_events row (P7-D3,
 * 20260829310000), reshaped for display. `actorUserId` is kept (it is
 * already visible to the grantor via audit_events_select_own_org --
 * this adds no new disclosure) but deliberately NOT resolved to a name
 * anywhere in this module or the screen that renders it: the master
 * plan's own design intent for screen 32 (§27, §9) is org-level
 * transparency -- "who [which org] sees what, and that it's actually
 * being used" -- not identifying which individual employee at the
 * grantee org performed a given determination. Nothing in this
 * codebase exposes a cross-org user-name lookup (list_org_members is
 * scoped to the caller's OWN org, 20260828120000), and building one
 * for this purpose would be a real, unreviewed widening of a different
 * boundary than the one this task scoped.
 */
export interface SharedDataConsumptionEvent {
  id: string;
  occurredAt: string;
  actorUserId: string | null;
  determinationKind: string | null;
  shipmentLineId: string | null;
  emissionDataId: string | null;
  emissionDataVersion: number | null;
}

export interface SharedDataStatusRow {
  grant: SharingGrant;
  installationName: string;
  // Honest by construction -- see resolveGranteeLabel below. Never a
  // fabricated lookup: a grant whose grantee_org_id cannot be resolved
  // (RLS gap, deleted org, transport error) renders "Unknown
  // organization" rather than guessing.
  granteeLabel: string;
  // Most recent first. Scoped to events whose aggregate_id matches THIS
  // grant's own id -- see the aggregate_id filter below for why a
  // shared org_id-only audit_events query is not enough on its own.
  consumptionEvents: SharedDataConsumptionEvent[];
  // 2026-09-06 (S5 review remediation round 2, finding S5R2-B-01). true
  // when the audit_events lookup itself failed -- distinct from a
  // genuinely empty consumptionEvents array. Previously a failed lookup
  // was indistinguishable from "the grantee has not used this", an
  // affirmative claim about the grantee's behaviour the app has no
  // actual basis for. The caller must render this as "couldn't check",
  // never as "not yet used".
  consumptionEventsUnavailable: boolean;
}

interface InstallationNameRow {
  id: string;
  name: string;
}

interface OrgNameRow {
  id: string;
  name: string;
}

interface AuditEventRow {
  id: string;
  occurred_at: string;
  actor_user_id: string | null;
  aggregate_id: string;
  payload: Record<string, unknown> | null;
}

/**
 * 2026-09-03 (P14). The name map now comes from
 * public.sharing_counterparty_org_names(), whose result set spans EVERY
 * org the authenticated USER has a grant relationship with, in BOTH
 * directions -- not the orgs this ACTIVE org granted to. It must
 * therefore never be treated as a bare id -> name map by an org-scoped
 * screen.
 *
 * Concretely, without the per-grant gate below: a user who belongs to
 * producer org A and importer org B, where B is a grantee of org V,
 * would see A's /sharing/status name V on an INVITED, never-accepted
 * DIRECT grant that A itself issued naming V -- because V is in the
 * user's map for an entirely unrelated reason. That is the sham-grant
 * disclosure shape 20260829320000 exists to close, re-opened at the
 * application layer.
 *
 * So the name is admitted only when THIS grant independently justifies
 * it: a live ACTIVE grant, or one provably accepted through the
 * bootstrap path (invited_email set AND grantee_org_id resolved, which
 * only accept_sharing_grant_invitation() can produce -- see
 * 20260902150000). The predicate deliberately mirrors direction 2 of
 * that function, so the SQL and the TypeScript cannot drift into
 * disagreeing about what a grantor may see.
 */
function granteeNameIsDisclosable(
  grant: SharingGrant,
  now: Date,
): boolean {
  if (grant.grantee_org_id === null) {
    return false;
  }

  const unexpired =
    grant.expires_at === null ||
    new Date(grant.expires_at) > now;

  if (grant.status === "ACTIVE" && unexpired) {
    return true;
  }

  return (
    grant.invited_email !== null &&
    (
      grant.status === "ACTIVE" ||
      grant.status === "REVOKED" ||
      grant.status === "EXPIRED"
    )
  );
}

function resolveGranteeLabel(
  grant: SharingGrant,
  orgNameById: Map<string, string>,
  now: Date,
): string {
  const resolvedName =
    grant.grantee_org_id && granteeNameIsDisclosable(grant, now)
      ? orgNameById.get(grant.grantee_org_id)
      : undefined;

  if (resolvedName && grant.invited_email) {
    return `${resolvedName} (accepted via invite to ${grant.invited_email})`;
  }

  if (resolvedName) {
    return resolvedName;
  }

  if (grant.invited_email) {
    return `Pending invite: ${grant.invited_email}`;
  }

  return "Unknown organization";
}

function toConsumptionEvent(
  row: AuditEventRow,
): SharedDataConsumptionEvent {
  const payload =
    row.payload ?? {};

  return {
    id: row.id,
    occurredAt: row.occurred_at,
    actorUserId: row.actor_user_id,
    determinationKind:
      typeof payload.determination_kind === "string"
        ? payload.determination_kind
        : null,
    shipmentLineId:
      typeof payload.shipment_line_id === "string"
        ? payload.shipment_line_id
        : null,
    emissionDataId:
      typeof payload.emission_data_id === "string"
        ? payload.emission_data_id
        : null,
    emissionDataVersion:
      typeof payload.emission_data_version === "number"
        ? payload.emission_data_version
        : null,
  };
}

// 2026-09-06/2026-09-07 (supabase/config.toml `max_rows = 1000`; S5
// review round 3, findings S5R3-SES-01/S5R3-VOCAB-B2/S5R3-SHARE-B1 --
// the identical bug found independently by three reviewers across two
// dimension-scopes). An un-paged PostgREST query returns HTTP 200 with
// `error: null` and silently caps at 1000 rows -- indistinguishable
// from a genuinely small result set. A grantor org with many issued
// grants and/or a long consumption history can exceed 1000
// 'sharing_grant.data_consumed' events combined across all of them; the
// un-paged query below previously kept only the 1000 most-recent-
// overall events (occurred_at DESC), silently dropping the older tail
// -- disproportionately emptying a low-activity grant's own history
// when a handful of high-volume grants dominate the top 1000, with no
// signal anywhere that anything was dropped. This is the same defect
// class already fixed in list-period-shipment-lines.ts,
// compute-declaration-draft-facts.ts's shipments loop, and
// fetchMemberShipments's batching -- paged here the same way.
const AUDIT_EVENTS_PAGE_SIZE = 1000;

async function fetchAllConsumptionAuditEvents(
  supabase: SupabaseClient,
  orgId: string,
  grantIds: string[],
): Promise<{ data: AuditEventRow[] | null; error: { message: string } | null }> {
  if (grantIds.length === 0) {
    return { data: [], error: null };
  }

  const allRows: AuditEventRow[] =
    [];

  let offset =
    0;

  for (;;) {
    const { data, error } =
      await supabase
        .from("audit_events")
        .select("id, occurred_at, actor_user_id, aggregate_id, payload")
        .eq("org_id", orgId)
        .eq("event_type", "sharing_grant.data_consumed")
        .eq("aggregate_type", "SHARING_GRANT")
        .in("aggregate_id", grantIds)
        // `id` is a second, deterministic sort key purely to make
        // `.range()` pagination stable across pages when two events
        // share an occurred_at -- audit_events.id is a random UUID
        // (20260828070000), not sequential, so its own ordering carries
        // no meaning beyond breaking ties consistently.
        .order("occurred_at", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + AUDIT_EVENTS_PAGE_SIZE - 1);

    if (error) {
      return { data: null, error };
    }

    const page =
      (data as AuditEventRow[] | null) ?? [];

    allRows.push(
      ...page,
    );

    if (page.length < AUDIT_EVENTS_PAGE_SIZE) {
      break;
    }

    offset +=
      AUDIT_EVENTS_PAGE_SIZE;
  }

  return { data: allRows, error: null };
}

/**
 * Read model for master plan §27 screen 32 ("Shared-data status" --
 * "who sees what, consumption events"). Per grant issued BY orgId
 * (as grantor): the installation name, an honestly-resolved grantee
 * label (see resolveGranteeLabel), and the full consumption-event
 * history (P7-D3's 'sharing_grant.data_consumed' audit_events rows)
 * for that specific grant.
 *
 * Grantee-org name resolution goes through
 * public.sharing_counterparty_org_names() (20260831100000, widened by
 * 20260902150000), NOT through a direct `organizations` read: a grantor
 * has no membership in its grantee's org. The RPC returns only
 * (id, name), spans both grant directions and every org the USER
 * belongs to, and is therefore re-gated per grant by
 * granteeNameIsDisclosable -- see its doc comment for the cross-org
 * disclosure that gate prevents. A never-accepted grant still shows
 * "Pending invite: {email}", same as issued-grants-list.tsx's own
 * pre-existing placeholder documents. Consumption events depend on nothing new --
 * audit_events_select_own_org (20260828070000) already lets the
 * grantor read their own org's audit_events rows; confirmed live via
 * the grantor's own authenticated client (not just service-role) in
 * tests/integration/shared-data-status-visibility.test.ts, per this
 * task's own "confirm this, don't assume it" instruction.
 *
 * Three lookups after the primary grants fetch (installations,
 * organizations, audit_events), same "fetch the list, then batch-
 * resolve names via separate .in() queries" shape
 * listMyPendingSharingGrantInvitations already uses (manage-sharing-
 * grants.ts) for the symmetric grantee-side screen -- sharing_grants
 * has two FKs into organizations (grantor_org_id, grantee_org_id),
 * which makes a single embedded PostgREST select ambiguous, so this
 * mirrors that file's own choice of explicit `.in()` queries over
 * embedded joins.
 *
 * Failure posture deliberately differs between the two kinds of
 * lookup: a sharing_grants, installations, or organizations lookup
 * failure now THROWS (2026-09-06, S5 review remediation round 2,
 * finding S5R2-B-01 -- matching the throw-is-for-infrastructure-
 * failures fix already applied to eight sibling read services this same
 * S5 phase; a name this screen cannot even attempt to resolve makes
 * every row suspect, and hiding a genuinely-fetched grants list behind
 * a false "no grants issued yet" is exactly the anti-pattern that
 * remediation closed elsewhere). An audit_events lookup failure still
 * does NOT blank the whole grants/status list -- the core "who
 * currently holds access" transparency this screen exists for should
 * not go dark just because the secondary "and here's their usage
 * history" data failed to load -- but it now marks each affected row's
 * consumptionEventsUnavailable: true instead of silently defaulting to
 * an empty array, so the caller can render "couldn't check" rather than
 * the affirmative "not yet used".
 */
// 2026-09-07 (supabase/config.toml `max_rows = 1000`; S5 review round
// 4, finding S5R4-SHARE-02). sharing_grants rows are NEVER deleted
// anywhere in this codebase -- revoking only flips `status` to
// REVOKED, by explicit design (history survives revocation, master
// plan SS31) -- so a long-lived grantor's row count only ever grows
// with every issue/revoke/re-issue cycle, and will eventually cross
// 1000 for any sufficiently active producer. See fetchAllConsumptionAuditEvents
// just below for the same paging convention already applied to this
// function's own audit_events sub-query (round 3, commit 7e579a2) --
// this is the PRIMARY query three lines above the one that fix left
// unpaged.
const SHARING_GRANTS_PAGE_SIZE =
  1000;

export async function listSharedDataStatus(
  supabase: SupabaseClient,
  orgId: OrganizationId,
): Promise<SharedDataStatusRow[]> {
  const grantRows: SharingGrantRow[] =
    [];

  let grantOffset =
    0;

  for (;;) {
    const { data, error: grantError } =
      await supabase
        .from("sharing_grants")
        .select(
          SHARING_GRANT_COLUMNS,
        )
        .eq("grantor_org_id", orgId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(grantOffset, grantOffset + SHARING_GRANTS_PAGE_SIZE - 1);

    // 2026-09-06 (S5 review remediation round 2, finding S5R2-B-01).
    // THROWS on a genuine query error, matching the throw-is-for-
    // infrastructure-failures fix already applied to eight sibling read
    // services this same S5 phase (b23e500, 662d843, a062226).
    // Previously degraded to [], which the caller (app/(producer)/
    // sharing/status/page.tsx, no try/catch of its own) rendered as the
    // affirmative "No data-sharing grants issued yet -- issue one from
    // the Sharing screen to see who holds access here" -- a false
    // all-clear on the exact privacy/access-transparency boundary this
    // screen exists to make visible.
    if (grantError || !data) {
      throw new Error(
        `sharing: sharing_grants fetch failed (${grantError?.message ?? "no rows"}).`,
      );
    }

    const page =
      data as SharingGrantRow[];

    grantRows.push(
      ...page,
    );

    if (page.length < SHARING_GRANTS_PAGE_SIZE) {
      break;
    }

    grantOffset +=
      SHARING_GRANTS_PAGE_SIZE;
  }

  const grants =
    grantRows.map(
      toSharingGrant,
    );

  if (grants.length === 0) {
    return [];
  }

  const installationIds =
    Array.from(
      new Set(
        grants.map((grant) => grant.installation_id),
      ),
    );

  const granteeOrgIds =
    Array.from(
      new Set(
        grants
          .map((grant) => grant.grantee_org_id)
          .filter(
            (id): id is NonNullable<typeof id> => id !== null,
          ),
      ),
    );

  const grantIds =
    grants.map((grant) => grant.id);

  const [
    { data: installationRows, error: installationError },
    { data: orgRows, error: orgError },
    { data: auditRows, error: auditError },
  ] =
    await Promise.all(
      [
        supabase
          .from("installations")
          .select("id, name")
          .in("id", installationIds),

        // 2026-09-03 (P14): resolved through the counterparty RPC rather
        // than a direct `organizations` read. A grantor has no
        // membership in its grantee's org, so the direct read depended
        // entirely on organizations_select_via_own_issued_sharing_grant
        // -- which is gated to status = 'ACTIVE', so the moment a grant
        // was revoked the producer's own transparency screen stopped
        // being able to name the organization it had shared with. That
        // RLS policy is deliberately left exactly as it is (it governs
        // the FULL row -- eori_number, cbam_declarant_status, slug); the
        // NAME alone now comes from the SECURITY DEFINER function, which
        // returns only (id, name) and carries its own acceptance proof.
        // resolveGranteeLabel re-gates every row per grant.
        granteeOrgIds.length > 0
          ? supabase.rpc("sharing_counterparty_org_names")
          : Promise.resolve({ data: [] as OrgNameRow[], error: null }),

        fetchAllConsumptionAuditEvents(
          supabase,
          orgId,
          grantIds,
        ),
      ],
    );

  // 2026-09-06 (S5 review remediation round 2, finding S5R2-B-01).
  // THROWS -- previously blanked genuinely-fetched grants to [],
  // producing the identical false all-clear as the grantError branch
  // above.
  if (installationError || orgError) {
    throw new Error(
      `sharing: installation/organization name lookup failed (${(installationError ?? orgError)?.message ?? "unknown"}).`,
    );
  }

  const installationNameById =
    new Map(
      ((installationRows as InstallationNameRow[] | null) ?? []).map(
        (row) => [row.id, row.name] as const,
      ),
    );

  const orgNameById =
    new Map(
      ((orgRows as OrgNameRow[] | null) ?? []).map(
        (row) => [row.id, row.name] as const,
      ),
    );

  // See this function's own doc comment for why an audit_events error
  // degrades each row's own consumptionEvents/consumptionEventsUnavailable
  // rather than blanking the whole result the way an installation/
  // organization lookup error does.
  const eventsByGrantId =
    new Map<string, SharedDataConsumptionEvent[]>();

  if (!auditError) {
    for (
      const row of (auditRows as AuditEventRow[] | null) ?? []
    ) {
      const existing =
        eventsByGrantId.get(row.aggregate_id) ?? [];

      existing.push(
        toConsumptionEvent(
          row,
        ),
      );

      eventsByGrantId.set(
        row.aggregate_id,
        existing,
      );
    }
  }

  const consumptionEventsUnavailable =
    auditError !== null;

  // One clock reading for the whole page, so two grants that lapse
  // either side of an evaluation cannot render inconsistently within a
  // single render.
  const now =
    new Date();

  return grants.map(
    (grant) => (
      {
        grant,
        installationName:
          installationNameById.get(grant.installation_id) ?? "Unknown installation",
        granteeLabel:
          resolveGranteeLabel(
            grant,
            orgNameById,
            now,
          ),
        consumptionEvents:
          eventsByGrantId.get(grant.id) ?? [],
        consumptionEventsUnavailable,
      }
    ),
  );
}

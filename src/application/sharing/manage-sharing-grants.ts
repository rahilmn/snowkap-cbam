import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import {
  transitionSharingGrant,
  type SharingGrantTransitionRejectionReason,
} from "../../domain/sharing/grant-lifecycle";

import type {
  SharingGrant,
} from "../../domain/sharing/types";

import type {
  IsoTimestamp,
} from "../../domain/shared/reporting-period";

import type {
  InstallationId,
  OrganizationId,
  SharingGrantId,
} from "../../domain/shared/ids";

import {
  hasAdminAccess,
  hasCapability,
  type OrgContext,
} from "../organizations/org-context";

import {
  recordAuditEvent,
} from "../audit/record-audit-event";

import {
  SHARING_GRANT_COLUMNS,
  toSharingGrant,
  type SharingGrantRow,
} from "./sharing-grant-mapper";

export async function listSharingGrantsIssued(
  supabase: SupabaseClient,
  orgId: OrganizationId,
): Promise<SharingGrant[]> {
  const { data, error } =
    await supabase
      .from("sharing_grants")
      .select(
        SHARING_GRANT_COLUMNS,
      )
      .eq("grantor_org_id", orgId)
      .order("created_at", { ascending: false });

  if (error || !data) {
    return [];
  }

  return (data as SharingGrantRow[]).map(
    toSharingGrant,
  );
}

export async function listSharingGrantsReceived(
  supabase: SupabaseClient,
  orgId: OrganizationId,
): Promise<SharingGrant[]> {
  const { data, error } =
    await supabase
      .from("sharing_grants")
      .select(
        SHARING_GRANT_COLUMNS,
      )
      .eq("grantee_org_id", orgId)
      .order("created_at", { ascending: false });

  if (error || !data) {
    return [];
  }

  return (data as SharingGrantRow[]).map(
    toSharingGrant,
  );
}

/**
 * Exactly one of granteeOrgId/invitedEmail must be provided --
 * granteeOrgId for the direct-grant case (both orgs already Snowkap
 * customers), invitedEmail for the bootstrap case (P7-D2, 20260829300000:
 * the importer org isn't known yet, so the grant is addressed to an
 * email address and accept_sharing_grant_invitation() resolves
 * grantee_org_id the first time it's accepted). issueSharingGrant is
 * extended to accept either shape rather than adding a parallel
 * issueSharingGrantByEmail function, since every other check (ADMIN+,
 * installation ownership, persistence, audit event) is identical between
 * the two paths -- only the inserted row's shape differs.
 */
export interface IssueSharingGrantInput {
  installationId: InstallationId;
  granteeOrgId?: OrganizationId;
  invitedEmail?: string;
  expiresAt?: IsoTimestamp;
}

export type IssueSharingGrantResult =
  | { status: "OK"; grant: SharingGrant }
  | {
      status: "REJECTED";
      reason:
        | "PERMISSION_DENIED"
        // The caller's org doesn't hold PRODUCER_OPERATOR -- issuing a
        // sharing grant over one of the org's own installations is a
        // producer-only workflow (master plan §6/§14). Checked alongside
        // the ADMIN+ role check, before any database read (P10/P11
        // capability-matrix hardening pass -- see
        // docs/architecture/AUTHORIZATION_MATRIX.md's "Capability
        // enforcement" section).
        | "CAPABILITY_NOT_HELD"
        | "SELF_GRANT_NOT_ALLOWED"
        | "INVALID_INPUT"
        | "INSTALLATION_NOT_FOUND"
        | "PERSIST_FAILED";
    };

const EMAIL_SHAPE_PATTERN =
  /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const BOOTSTRAP_INVITATION_DEFAULT_LIFETIME_MS =
  7 * 24 * 60 * 60 * 1000;

interface InstallationOwnershipRow {
  org_id: string;
}

/**
 * Same "verify a referenced parent belongs to my org" shape as
 * verifyInstallationOwnership in manage-emission-data.ts -- Wall 1
 * (application) should not depend on Wall 2 (RLS,
 * sharing_grants_insert_own_org's own EXISTS clause,
 * 20260829260000) alone catching a caller whose active org doesn't
 * actually own installationId.
 */
async function verifyInstallationOwnership(
  supabase: SupabaseClient,
  orgId: OrganizationId,
  installationId: InstallationId,
): Promise<
  | { status: "OK" }
  | { status: "REJECTED"; reason: "INSTALLATION_NOT_FOUND" | "PERSIST_FAILED" }
> {
  const { data, error } =
    await supabase
      .from("installations")
      .select(
        "org_id",
      )
      .eq("id", installationId)
      .maybeSingle();

  if (error) {
    return {
      status: "REJECTED",
      reason: "PERSIST_FAILED",
    };
  }

  if (!data || (data as InstallationOwnershipRow).org_id !== orgId) {
    return {
      status: "REJECTED",
      reason: "INSTALLATION_NOT_FOUND",
    };
  }

  return {
    status: "OK",
  };
}

/**
 * ADMIN+ only, per docs/plans/MASTER_PLAN.md §27 screen 31
 * ("Sharing" -- issue/revoke are ADMIN+-only actions) -- checked here,
 * in the application layer, BEFORE any database read, mirroring
 * verifyEmissionData's PERMISSION_DENIED gate in
 * manage-emission-data.ts. Input shape (exactly one of granteeOrgId/
 * invitedEmail, and a well-formed email when the latter is used) is
 * validated next, also before any database read -- INVALID_INPUT. A
 * direct grant to yourself is nonsensical (SELF_GRANT_NOT_ALLOWED),
 * checked next for the granteeOrgId branch only: the bootstrap
 * (invitedEmail) branch cannot make this check at issue time, since the
 * whole point of that path is that the invitee's eventual org isn't
 * known yet -- accept_sharing_grant_invitation() (20260829300000) makes
 * the equivalent check at accept time instead, once the org is known.
 * The DB-level backstop for every one of these checks (including
 * installation ownership) is sharing_grants_insert_own_org's own WITH
 * CHECK (20260829260000, widened by 20260829300000 for the bootstrap
 * branch), which additionally verifies grantee_org_id is a real
 * organization on the direct-grant branch.
 */
export async function issueSharingGrant(
  supabase: SupabaseClient,
  context: OrgContext,
  input: IssueSharingGrantInput,
): Promise<IssueSharingGrantResult> {
  if (!hasAdminAccess(context)) {
    return {
      status: "REJECTED",
      reason: "PERMISSION_DENIED",
    };
  }

  if (!hasCapability(context, "PRODUCER_OPERATOR")) {
    return {
      status: "REJECTED",
      reason: "CAPABILITY_NOT_HELD",
    };
  }

  const hasGranteeOrgId =
    input.granteeOrgId !== undefined && input.granteeOrgId !== null;

  const rawInvitedEmail =
    input.invitedEmail?.trim();

  const hasInvitedEmail =
    !!rawInvitedEmail;

  if (hasGranteeOrgId === hasInvitedEmail) {
    // Both provided, or neither -- exactly one is required.
    return {
      status: "REJECTED",
      reason: "INVALID_INPUT",
    };
  }

  const normalizedInvitedEmail =
    hasInvitedEmail
      ? rawInvitedEmail!.toLowerCase()
      : null;

  if (
    normalizedInvitedEmail !== null &&
    !EMAIL_SHAPE_PATTERN.test(normalizedInvitedEmail)
  ) {
    return {
      status: "REJECTED",
      reason: "INVALID_INPUT",
    };
  }

  if (hasGranteeOrgId && input.granteeOrgId === context.org_id) {
    return {
      status: "REJECTED",
      reason: "SELF_GRANT_NOT_ALLOWED",
    };
  }

  const ownership =
    await verifyInstallationOwnership(
      supabase,
      context.org_id,
      input.installationId,
    );

  if (ownership.status === "REJECTED") {
    return ownership;
  }

  // 2026-08-29 (mandatory review, should-fix, independently confirmed):
  // a bootstrap invitation defaults to a 7-day lifetime when the caller
  // doesn't supply one -- unlike a direct grant (between two orgs already
  // vetted as Snowkap customers), a bootstrap invite is addressed to a
  // bare email address with no mailbox-control verification (see
  // docs/regulatory -- this is a product/config-level gap, not fixable
  // in SQL alone -- tracked separately, not blocking this fix). An
  // unbounded-lifetime pending invite is a standing credential: mailboxes
  // get reassigned, employees leave, domains lapse. Matches
  // organization_invitations' own `default (now() + interval '7 days')`
  // (20260828130000) -- applied here at the application layer rather
  // than a column DEFAULT, since (unlike the invitations table) this
  // column is shared with the direct-grant path, which should NOT
  // default to a 7-day expiry (an ongoing relationship between two
  // already-known orgs is a different risk profile).
  const defaultExpiresAt =
    hasInvitedEmail
      ? (
          new Date(
            Date.now() + BOOTSTRAP_INVITATION_DEFAULT_LIFETIME_MS,
          ).toISOString() as IsoTimestamp
        )
      : null;

  const { data, error } =
    await supabase
      .from("sharing_grants")
      .insert(
        {
          grantor_org_id: context.org_id,
          grantee_org_id: hasGranteeOrgId ? input.granteeOrgId : null,
          invited_email: normalizedInvitedEmail,
          installation_id: input.installationId,
          created_by_user_id: context.user_id,
          expires_at: input.expiresAt ?? defaultExpiresAt,
        },
      )
      .select(
        SHARING_GRANT_COLUMNS,
      )
      .single();

  if (error || !data) {
    return {
      status: "REJECTED",
      reason: "PERSIST_FAILED",
    };
  }

  const grant =
    toSharingGrant(
      data as SharingGrantRow,
    );

  await recordAuditEvent(
    supabase,
    {
      orgId: context.org_id,
      actorUserId: context.user_id,
      eventType: "sharing_grant.issued",
      aggregateType: "SHARING_GRANT",
      aggregateId: grant.id,
      payload: {
        installation_id: grant.installation_id,
        grantee_org_id: grant.grantee_org_id,
        invited_email: grant.invited_email,
      },
    },
  );

  return {
    status: "OK",
    grant,
  };
}

/**
 * Fetches a sharing_grants row by id with no org-ownership filter of
 * its own -- acceptSharingGrant/revokeSharingGrant each apply their own
 * ownership check against the SIDE of the grant relevant to that
 * action (grantee_org_id for accept, grantor_org_id for revoke), since
 * unlike emission_data's single entered_by_org_id, a sharing_grants row
 * has two distinct organization sides.
 */
async function fetchSharingGrant(
  supabase: SupabaseClient,
  grantId: SharingGrantId,
): Promise<
  | { status: "OK"; grant: SharingGrant }
  | { status: "REJECTED"; reason: "NOT_FOUND" | "FETCH_FAILED" }
> {
  const { data, error } =
    await supabase
      .from("sharing_grants")
      .select(
        SHARING_GRANT_COLUMNS,
      )
      .eq("id", grantId)
      .maybeSingle();

  if (error) {
    return {
      status: "REJECTED",
      reason: "FETCH_FAILED",
    };
  }

  if (!data) {
    return {
      status: "REJECTED",
      reason: "NOT_FOUND",
    };
  }

  return {
    status: "OK",
    grant: toSharingGrant(
      data as SharingGrantRow,
    ),
  };
}

export type SharingGrantActionResult =
  | { status: "OK"; grant: SharingGrant }
  | {
      status: "REJECTED";
      reason:
        | SharingGrantTransitionRejectionReason
        | "NOT_FOUND"
        | "FETCH_FAILED"
        | "PERSIST_FAILED"
        | "PERMISSION_DENIED";
    };

/**
 * `context.org_id` must be the grant's OWN grantee_org_id -- verified
 * before applying the transition. Rejecting as NOT_FOUND (not a more
 * specific reason) matches fetchOwnedEmissionData's own posture in
 * manage-emission-data.ts: a caller must never learn "a grant with this
 * id exists but belongs to a different org" from the rejection reason.
 * Not ADMIN+-gated -- per docs/plans/MASTER_PLAN.md §27 screen 31,
 * accepting is not itself a privileged escalation the way issuing/
 * revoking a producer's own data access is, so any MEMBER of the
 * grantee org may accept (matches
 * sharing_grants_update_grantee_accept's own RLS posture,
 * 20260829260000).
 */
export async function acceptSharingGrant(
  supabase: SupabaseClient,
  context: OrgContext,
  grantId: SharingGrantId,
): Promise<SharingGrantActionResult> {
  const fetched =
    await fetchSharingGrant(
      supabase,
      grantId,
    );

  if (fetched.status === "REJECTED") {
    return fetched;
  }

  if (fetched.grant.grantee_org_id !== context.org_id) {
    return {
      status: "REJECTED",
      reason: "NOT_FOUND",
    };
  }

  const transition =
    transitionSharingGrant(
      fetched.grant,
      {
        action: "ACCEPT",
        granteeOrgId: context.org_id,
        // 2026-08-29 (P11 finding #5): the real wall-clock instant,
        // not a stale value cached anywhere -- transitionSharingGrant
        // now refuses (GRANT_EXPIRED) a grant whose expires_at has
        // already lapsed, closing the gap where this bare CAS UPDATE
        // used to accept a grant expired 400 days ago, silently.
        now: new Date().toISOString() as IsoTimestamp,
      },
    );

  if (transition.status === "REJECTED") {
    return transition;
  }

  // .eq("status", "INVITED") makes this a compare-and-swap the database
  // enforces: without it, if the grant is concurrently revoked between
  // the fetch above and this UPDATE, sharing_grants_update_grantee_accept's
  // own USING clause (20260829260000) silently excludes the now-REVOKED
  // row -- supabase-js returns {error: null, data: null} for a zero-row
  // UPDATE, not an error, so this function would otherwise report OK and
  // record a sharing_grant.accepted audit event for an accept that never
  // actually happened (found in P7's mandatory review; same CAS shape
  // determine-from-actual-data.ts's performDetermination already uses).
  //
  // 2026-08-29 (P11 finding #5, second layer -- defense in depth
  // alongside the domain-level check above): sharing_grants_update_grantee_accept's
  // own USING clause (this migration) now ALSO requires
  // `expires_at is null or expires_at > now()`, so even a caller
  // bypassing this application function entirely (a raw
  // supabase.from("sharing_grants").update() call) cannot accept an
  // expired grant -- the CAS below would simply match zero rows.
  const { data, error } =
    await supabase
      .from("sharing_grants")
      .update(
        {
          status: transition.grant.status,
        },
      )
      .eq("id", grantId)
      .eq("status", "INVITED")
      .select(
        SHARING_GRANT_COLUMNS,
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
      reason: "GRANT_NOT_INVITED",
    };
  }

  await recordAuditEvent(
    supabase,
    {
      orgId: context.org_id,
      actorUserId: context.user_id,
      eventType: "sharing_grant.accepted",
      aggregateType: "SHARING_GRANT",
      aggregateId: grantId,
      payload: {
        grantor_org_id: fetched.grant.grantor_org_id,
        installation_id: fetched.grant.installation_id,
      },
    },
  );

  return {
    status: "OK",
    grant: toSharingGrant(
      data as SharingGrantRow,
    ),
  };
}

/**
 * ADMIN+ only, per docs/plans/MASTER_PLAN.md §27 screen 31 -- checked
 * before any database read, same posture as issueSharingGrant.
 * `context.org_id` must be the grant's OWN grantor_org_id -- verified
 * before applying the transition, same NOT_FOUND-not-a-more-specific-
 * reason posture as acceptSharingGrant.
 */
export async function revokeSharingGrant(
  supabase: SupabaseClient,
  context: OrgContext,
  grantId: SharingGrantId,
): Promise<SharingGrantActionResult> {
  if (!hasAdminAccess(context)) {
    return {
      status: "REJECTED",
      reason: "PERMISSION_DENIED",
    };
  }

  const fetched =
    await fetchSharingGrant(
      supabase,
      grantId,
    );

  if (fetched.status === "REJECTED") {
    return fetched;
  }

  if (fetched.grant.grantor_org_id !== context.org_id) {
    return {
      status: "REJECTED",
      reason: "NOT_FOUND",
    };
  }

  const transition =
    transitionSharingGrant(
      fetched.grant,
      { action: "REVOKE" },
    );

  if (transition.status === "REJECTED") {
    return transition;
  }

  // Same CAS reasoning as acceptSharingGrant's own comment: without
  // .eq("status", fetched.grant.status), a concurrent transition on this
  // grant (e.g. it expires, or -- once an EXPIRE job exists -- races
  // against it) between the fetch above and this UPDATE would have
  // sharing_grants_update_grantor_revoke's USING clause silently exclude
  // an already-terminal row, and this function would otherwise report OK
  // and audit a revoke that never happened.
  const { data, error } =
    await supabase
      .from("sharing_grants")
      .update(
        {
          status: transition.grant.status,
        },
      )
      .eq("id", grantId)
      .eq("status", fetched.grant.status)
      .select(
        SHARING_GRANT_COLUMNS,
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
      reason: "ALREADY_TERMINAL",
    };
  }

  await recordAuditEvent(
    supabase,
    {
      orgId: context.org_id,
      actorUserId: context.user_id,
      eventType: "sharing_grant.revoked",
      aggregateType: "SHARING_GRANT",
      aggregateId: grantId,
      payload: {
        grantee_org_id: fetched.grant.grantee_org_id,
        installation_id: fetched.grant.installation_id,
      },
    },
  );

  return {
    status: "OK",
    grant: toSharingGrant(
      data as SharingGrantRow,
    ),
  };
}

export type AcceptSharingGrantInvitationResult =
  | { status: "OK"; orgId: OrganizationId }
  | { status: "EXPIRED" }
  | { status: "EMAIL_MISMATCH" }
  | { status: "NOT_PENDING" }
  | { status: "SELF_GRANT_NOT_ALLOWED" }
  | { status: "NOT_A_MEMBER" }
  | { status: "ALREADY_GRANTED" }
  | { status: "NOT_FOUND" };

interface AcceptSharingGrantInvitationRpcRow {
  result_status: string;
  result_org_id: string | null;
}

/**
 * Accepts a bootstrap (invited-by-email) sharing_grants row via the
 * accept_sharing_grant_invitation() SECURITY DEFINER RPC
 * (20260829300000_p7d2_sharing_grant_email_bootstrap.sql) -- the only way
 * such a row's grantee_org_id resolves for the first time. Unlike
 * acceptSharingGrant above (a bare CAS UPDATE against
 * sharing_grants_update_grantee_accept), no bare RLS UPDATE policy can
 * cover this case: that policy's USING clause requires grantee_org_id to
 * already be in the caller's own orgs, which is never true while
 * grantee_org_id is still null. `context.org_id` becomes the grant's
 * grantee_org_id on success -- the RPC independently re-verifies the
 * caller actually belongs to it (NOT_A_MEMBER) rather than trusting this
 * parameter, since the RPC is directly callable via supabase.rpc() with
 * any org id, not only through this OrgContext-resolving call site (see
 * the migration's own header comment).
 *
 * The audit event (sharing_grant.accepted -- the SAME event type
 * acceptSharingGrant's direct-accept path already uses, not a new one)
 * is recorded here, client-side, after the RPC reports OK -- mirroring
 * acceptSharingGrant's own posture and recordAuditEvent's doc comment,
 * rather than embedding the audit insert inside the RPC itself.
 */
export async function acceptSharingGrantInvitation(
  supabase: SupabaseClient,
  context: OrgContext,
  grantId: SharingGrantId,
): Promise<AcceptSharingGrantInvitationResult> {
  const { data, error } =
    await supabase.rpc(
      "accept_sharing_grant_invitation",
      {
        p_grant_id: grantId,
        p_org_id: context.org_id,
      },
    );

  const row =
    (data as AcceptSharingGrantInvitationRpcRow[] | null)?.[0];

  if (error || !row) {
    return {
      status: "NOT_FOUND",
    };
  }

  switch (row.result_status) {
    case "OK": {
      await recordAuditEvent(
        supabase,
        {
          orgId: row.result_org_id as OrganizationId,
          actorUserId: context.user_id,
          eventType: "sharing_grant.accepted",
          aggregateType: "SHARING_GRANT",
          aggregateId: grantId,
          payload: {
            via: "email_invitation",
          },
        },
      );

      return {
        status: "OK",
        orgId: row.result_org_id as OrganizationId,
      };
    }

    case "EXPIRED":
      return { status: "EXPIRED" };

    case "EMAIL_MISMATCH":
      return { status: "EMAIL_MISMATCH" };

    case "ALREADY_ACTIVE":
    case "NOT_PENDING":
      return { status: "NOT_PENDING" };

    case "SELF_GRANT_NOT_ALLOWED":
      return { status: "SELF_GRANT_NOT_ALLOWED" };

    case "NOT_A_MEMBER":
      return { status: "NOT_A_MEMBER" };

    case "ALREADY_GRANTED":
      return { status: "ALREADY_GRANTED" };

    default:
      return { status: "NOT_FOUND" };
  }
}

export interface MyPendingSharingGrantInvitation {
  grant: SharingGrant;
  grantorOrganizationName: string;
  installationName: string;
}

interface OrgNameRow {
  id: string;
  name: string;
}

interface InstallationNameRow {
  id: string;
  name: string;
}

/**
 * Pending (INVITED, invited_email not null) sharing_grants rows addressed
 * to the caller's own authenticated email. RLS
 * (sharing_grants_select_via_pending_invitation, 20260829300000) admits
 * these rows, but it is NOT the only SELECT policy on this table --
 * sharing_grants_select_grantor_or_grantee (20260829260000) ALSO admits
 * every row where the caller is a member of grantor_org_id, with no email
 * predicate at all, and Postgres OR-combines both. Left to RLS alone
 * (2026-08-29 mandatory review, should-fix, independently confirmed by
 * two reviewers) a producer-org member calling this function would see
 * their OWN org's outgoing bootstrap invitations rendered as if addressed
 * to them, with a live but always-EMAIL_MISMATCH-failing Accept button.
 * `callerEmail` (the caller's own authenticated email, already resolved
 * by the caller via supabase.auth.getUser() -- this function does not
 * re-fetch it) is therefore an explicit, redundant-with-RLS filter that
 * narrows the query to exactly "addressed to me", matching
 * issueSharingGrant's own lower-casing of invited_email at write time.
 *
 * Two follow-up lookups (not a single embedded PostgREST select) resolve
 * the grantor org's name and the installation's name -- sharing_grants
 * has TWO foreign keys to organizations (grantor_org_id, grantee_org_id),
 * which makes a plain embedded `organizations(name)` select ambiguous;
 * two explicit `.in()` queries sidestep that instead of depending on
 * PostgREST's constraint-name disambiguation syntax. Each lookup is
 * covered by its own new pending-invitation RLS policy
 * (organizations_select_via_pending_sharing_grant_invitation,
 * installations_select_via_pending_sharing_grant_invitation) -- without
 * those, both queries would come back empty even though the sharing_grants
 * row itself is visible. Both lookups' errors are checked explicitly
 * (2026-08-29 mandatory review, worth-tracking, fixed alongside the
 * should-fix items above): a transport/PostgREST failure on either
 * lookup now degrades that entry's name to "Unknown organization"/
 * "Unknown installation" explicitly (still shown, since accept-time
 * validation is fully server-side regardless of what this listing
 * renders) rather than being silently indistinguishable from a
 * genuinely-empty, successful lookup.
 */
export async function listMyPendingSharingGrantInvitations(
  supabase: SupabaseClient,
  callerEmail: string,
): Promise<MyPendingSharingGrantInvitation[]> {
  const { data, error } =
    await supabase
      .from("sharing_grants")
      .select(
        SHARING_GRANT_COLUMNS,
      )
      .eq("status", "INVITED")
      .eq("invited_email", callerEmail.trim().toLowerCase())
      .order("created_at", { ascending: false });

  if (error || !data) {
    return [];
  }

  const grants =
    (data as SharingGrantRow[]).map(
      toSharingGrant,
    );

  if (grants.length === 0) {
    return [];
  }

  const grantorOrgIds =
    Array.from(
      new Set(
        grants.map((grant) => grant.grantor_org_id),
      ),
    );

  const installationIds =
    Array.from(
      new Set(
        grants.map((grant) => grant.installation_id),
      ),
    );

  const [
    { data: orgRows, error: orgError },
    { data: installationRows, error: installationError },
  ] =
    await Promise.all(
      [
        supabase
          .from("organizations")
          .select("id, name")
          .in("id", grantorOrgIds),

        supabase
          .from("installations")
          .select("id, name")
          .in("id", installationIds),
      ],
    );

  if (orgError || installationError) {
    return [];
  }

  const orgNameById =
    new Map(
      ((orgRows as OrgNameRow[] | null) ?? []).map(
        (row) => [row.id, row.name] as const,
      ),
    );

  const installationNameById =
    new Map(
      ((installationRows as InstallationNameRow[] | null) ?? []).map(
        (row) => [row.id, row.name] as const,
      ),
    );

  return grants.map(
    (grant) => (
      {
        grant,
        grantorOrganizationName:
          orgNameById.get(grant.grantor_org_id) ?? "Unknown organization",
        installationName:
          installationNameById.get(grant.installation_id) ?? "Unknown installation",
      }
    ),
  );
}

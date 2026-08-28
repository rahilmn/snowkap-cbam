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

export interface IssueSharingGrantInput {
  installationId: InstallationId;
  granteeOrgId: OrganizationId;
  expiresAt?: IsoTimestamp;
}

export type IssueSharingGrantResult =
  | { status: "OK"; grant: SharingGrant }
  | {
      status: "REJECTED";
      reason:
        | "PERMISSION_DENIED"
        | "SELF_GRANT_NOT_ALLOWED"
        | "INSTALLATION_NOT_FOUND"
        | "PERSIST_FAILED";
    };

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
 * manage-emission-data.ts. A grant to yourself is nonsensical
 * (SELF_GRANT_NOT_ALLOWED), checked next, also before any database
 * read -- the DB-level backstop for both this and the installation-
 * ownership check is sharing_grants_insert_own_org's own WITH CHECK
 * (20260829260000), which additionally verifies grantee_org_id is a
 * real organization.
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

  if (input.granteeOrgId === context.org_id) {
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

  const { data, error } =
    await supabase
      .from("sharing_grants")
      .insert(
        {
          grantor_org_id: context.org_id,
          grantee_org_id: input.granteeOrgId,
          installation_id: input.installationId,
          created_by_user_id: context.user_id,
          expires_at: input.expiresAt ?? null,
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
      { action: "ACCEPT", granteeOrgId: context.org_id },
    );

  if (transition.status === "REJECTED") {
    return transition;
  }

  const { error } =
    await supabase
      .from("sharing_grants")
      .update(
        {
          status: transition.grant.status,
        },
      )
      .eq("id", grantId);

  if (error) {
    return {
      status: "REJECTED",
      reason: "PERSIST_FAILED",
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
    grant: transition.grant,
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

  const { error } =
    await supabase
      .from("sharing_grants")
      .update(
        {
          status: transition.grant.status,
        },
      )
      .eq("id", grantId);

  if (error) {
    return {
      status: "REJECTED",
      reason: "PERSIST_FAILED",
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
    grant: transition.grant,
  };
}

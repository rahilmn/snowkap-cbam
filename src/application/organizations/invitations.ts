import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  Invitation,
  InvitableRole,
  InvitationStatus,
} from "../../domain/organizations/types";

import type {
  InvitationId,
  OrganizationId,
} from "../../domain/shared/ids";

export type InviteMemberResult =
  | { status: "OK"; invitationId: InvitationId }
  | { status: "OK_EMAIL_NOT_SENT"; invitationId: InvitationId }
  | { status: "ALREADY_PENDING" }
  | { status: "INSERT_FAILED" };

/**
 * Creates a PENDING invitation row (RLS-enforced: the calling user must
 * already be ADMIN/OWNER of orgId -- see
 * organization_invitations_insert_admin_or_owner in
 * 20260828130000_organization_invitations.sql), then attempts to send
 * the actual invite email via the Auth admin API.
 *
 * The email send uses a *separate* client (adminSupabase) because
 * inviteUserByEmail requires the service-role key -- see
 * src/infrastructure/supabase/admin-client.ts for why that client is
 * narrowly scoped and constructed by the caller (a Server Action),
 * not by this function.
 *
 * A failed send (most commonly: the email already belongs to an
 * existing Snowkap user -- inviteUserByEmail is for provisioning new
 * accounts) is deliberately not distinguished from other send failures
 * in the returned status, to avoid an account-enumeration side channel
 * ("this email already has an account" vs "the mail server hiccuped").
 * Either way the invitation row still exists: once that person signs
 * in with any account matching the invited email, RLS
 * (organization_invitations_select_own_email) lets them see and accept
 * it from /accept-invitation regardless of how they got there.
 */
export async function inviteMember(
  userScopedSupabase: SupabaseClient,
  adminSupabase: SupabaseClient,
  params: {
    orgId: OrganizationId;
    email: string;
    role: InvitableRole;
    redirectTo: string;
  },
): Promise<InviteMemberResult> {
  const normalizedEmail =
    params.email.trim().toLowerCase();

  const {
    data: { user },
  } = await userScopedSupabase.auth.getUser();

  if (!user) {
    return {
      status: "INSERT_FAILED",
    };
  }

  const { data: inserted, error: insertError } =
    await userScopedSupabase
      .from("organization_invitations")
      .insert(
        {
          org_id: params.orgId,
          email: normalizedEmail,
          role: params.role,
          // RLS's with check (invited_by = auth.uid()) requires this to
          // be set explicitly -- there is no column default, since the
          // value must be attributable to whoever actually made the
          // request, not inferred server-side.
          invited_by: user.id,
        },
      )
      .select(
        "id",
      )
      .single();

  if (insertError || !inserted) {
    if (insertError?.code === "23505") {
      return {
        status: "ALREADY_PENDING",
      };
    }

    return {
      status: "INSERT_FAILED",
    };
  }

  const invitationId =
    inserted.id as InvitationId;

  const { error: sendError } =
    await adminSupabase.auth.admin.inviteUserByEmail(
      normalizedEmail,
      {
        redirectTo: params.redirectTo,
      },
    );

  if (sendError) {
    return {
      status: "OK_EMAIL_NOT_SENT",
      invitationId,
    };
  }

  return {
    status: "OK",
    invitationId,
  };
}

export type RevokeInvitationResult =
  | { status: "OK" }
  | { status: "PERSIST_FAILED" };

/**
 * Revokes a PENDING invitation. RLS
 * (organization_invitations_update_admin_or_owner) requires the caller
 * to be ADMIN/OWNER of the invitation's org and only permits the
 * transition to REVOKED -- this filters to status=PENDING app-side too
 * so revoking an already-ACCEPTED/EXPIRED row is a clean no-op rather
 * than a surprising status flip.
 */
export async function revokeInvitation(
  supabase: SupabaseClient,
  invitationId: InvitationId,
): Promise<RevokeInvitationResult> {
  const { error } =
    await supabase
      .from("organization_invitations")
      .update(
        { status: "REVOKED" },
      )
      .eq(
        "id",
        invitationId,
      )
      .eq(
        "status",
        "PENDING",
      );

  if (error) {
    return {
      status: "PERSIST_FAILED",
    };
  }

  return {
    status: "OK",
  };
}

export type AcceptInvitationResult =
  | { status: "OK"; orgId: OrganizationId }
  | { status: "ALREADY_MEMBER"; orgId: OrganizationId }
  | { status: "EXPIRED" }
  | { status: "EMAIL_MISMATCH" }
  | { status: "NOT_PENDING" }
  | { status: "NOT_FOUND" };

interface AcceptInvitationRpcRow {
  result_status: string;
  result_org_id: string | null;
}

/**
 * Accepts one invitation via the accept_organization_invitation()
 * SECURITY DEFINER RPC (20260828130000_organization_invitations.sql) --
 * the only way an invitation becomes a membership; see that migration
 * for why this can't be a plain client-side insert.
 */
export async function acceptInvitation(
  supabase: SupabaseClient,
  invitationId: InvitationId,
): Promise<AcceptInvitationResult> {
  const { data, error } =
    await supabase.rpc(
      "accept_organization_invitation",
      { p_invitation_id: invitationId },
    );

  const row =
    (data as AcceptInvitationRpcRow[] | null)?.[0];

  if (error || !row) {
    return {
      status: "NOT_FOUND",
    };
  }

  switch (row.result_status) {
    case "OK":
    case "ALREADY_MEMBER":
      return {
        status: row.result_status,
        orgId: row.result_org_id as OrganizationId,
      };

    case "EXPIRED":
      return { status: "EXPIRED" };

    case "EMAIL_MISMATCH":
      return { status: "EMAIL_MISMATCH" };

    case "ALREADY_ACCEPTED":
    case "NOT_PENDING":
      return { status: "NOT_PENDING" };

    default:
      return { status: "NOT_FOUND" };
  }
}

interface InvitationRow {
  id: string;
  org_id: string;
  email: string;
  role: InvitableRole;
  status: InvitationStatus;
  invited_by: string;
  created_at: string;
  expires_at: string;
}

function toInvitation(
  row: InvitationRow,
): Invitation {
  return {
    id: row.id as Invitation["id"],
    org_id: row.org_id as Invitation["org_id"],
    email: row.email,
    role: row.role,
    status: row.status,
    invited_by: row.invited_by as Invitation["invited_by"],
    created_at: row.created_at as Invitation["created_at"],
    expires_at: row.expires_at as Invitation["expires_at"],
  };
}

/**
 * PENDING invitations for one org -- RLS
 * (organization_invitations_select_admin_or_owner) requires the caller
 * to be ADMIN/OWNER, matching who the Team screen shows this list to.
 */
export async function listPendingInvitationsForOrg(
  supabase: SupabaseClient,
  orgId: OrganizationId,
): Promise<Invitation[]> {
  const { data, error } =
    await supabase
      .from("organization_invitations")
      .select(
        "id, org_id, email, role, status, invited_by, created_at, expires_at",
      )
      .eq(
        "org_id",
        orgId,
      )
      .eq(
        "status",
        "PENDING",
      )
      .order(
        "created_at",
        { ascending: false },
      );

  if (error || !data) {
    return [];
  }

  return data.map(
    toInvitation,
  );
}

export interface MyPendingInvitation {
  invitation: Invitation;
  organizationName: string;
}

interface MyInvitationRow
  extends InvitationRow {
  organizations: { name: string } | { name: string }[] | null;
}

/**
 * PENDING invitations addressed to the *caller's own* authenticated
 * email, across every organization -- RLS
 * (organization_invitations_select_own_email) is what actually scopes
 * this; the caller need not be a member of any of these orgs yet
 * (that's the whole point of /accept-invitation).
 */
export async function listMyPendingInvitations(
  supabase: SupabaseClient,
): Promise<MyPendingInvitation[]> {
  const { data, error } =
    await supabase
      .from("organization_invitations")
      .select(
        "id, org_id, email, role, status, invited_by, created_at, expires_at, organizations(name)",
      )
      .eq(
        "status",
        "PENDING",
      )
      .order(
        "created_at",
        { ascending: false },
      );

  if (error || !data) {
    return [];
  }

  return (data as MyInvitationRow[]).map(
    (row) => {
      const orgRelation =
        Array.isArray(row.organizations)
          ? row.organizations[0]
          : row.organizations;

      return {
        invitation: toInvitation(row),
        organizationName: orgRelation?.name ?? "Unknown organization",
      };
    },
  );
}

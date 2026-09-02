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
  | { status: "OK_MAGIC_LINK_SENT"; invitationId: InvitationId }
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
 * When the address already belongs to a confirmed Snowkap user,
 * inviteUserByEmail refuses with email_exists and a magic link is sent
 * instead -- see the comment at that branch. The two outcomes are
 * reported to the caller as distinct statuses but rendered identically
 * to the admin ("sent"), which is BETTER for account enumeration than
 * the previous behaviour: the old code surfaced a message that
 * volunteered "this can happen if the person already has a Snowkap
 * account", which is exactly the disclosure the distinction was
 * supposed to avoid.
 *
 * Either way the invitation row still exists: once that person signs in
 * with any account matching the invited email, RLS
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

  if (!sendError) {
    return {
      status: "OK",
      invitationId,
    };
  }

  // 2026-09-03 (P14). inviteUserByEmail refuses an address that already
  // has a confirmed account (422 email_exists) -- it exists to PROVISION
  // accounts. Until now that meant the invitation row was created and
  // the invitee was told nothing at all: no mail was sent, and the only
  // way they would ever learn of the invitation was if somebody told
  // them out of band to go and look at a URL.
  //
  // A magic link closes that. It is emailed by the same project, lands
  // on the same /auth/confirm screen, and carries the invitee to
  // /accept-invitation once they press Continue.
  //
  // Deliberately narrow, because this mails a genuine sign-in credential
  // to an address an admin typed:
  //   - reached only through inviteMemberAction, which is ADMIN/OWNER
  //     only (RLS on the insert above) and IP rate limited;
  //   - shouldCreateUser: false, so it can never provision an account;
  //   - only on email_exists, never as a general fallback for a mail
  //     outage;
  //   - and the invitation row must already exist, which the unique
  //     PENDING index means requires revoking any previous one first.
  //
  // The residual risk is recorded rather than waved away: an org admin
  // can cause repeated sign-in links to be mailed to any address they
  // are willing to type, bounded by the limiter and the project's own
  // hourly email budget. See the release report's high-risk register.
  if (sendError.code === "email_exists") {
    const { error: magicLinkError } =
      await adminSupabase.auth.signInWithOtp(
        {
          email: normalizedEmail,
          options: {
            emailRedirectTo: params.redirectTo,
            shouldCreateUser: false,
          },
        },
      );

    if (!magicLinkError) {
      return {
        status: "OK_MAGIC_LINK_SENT",
        invitationId,
      };
    }
  }

  return {
    status: "OK_EMAIL_NOT_SENT",
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
 *
 * .select("id") + the zero-rows check (P10 review, NIT #7, 2026-08-29):
 * PostgREST reports no error for an UPDATE that RLS, or the
 * .eq("status", "PENDING") filter above, silently matches to zero rows
 * -- so without reading the affected row back, a plain MEMBER (or a
 * revoke of an already-non-PENDING row) got {status:"OK"} for a write
 * that never happened. This function writes no audit event either way,
 * so the prior gap was a misleading UI only, not a false log entry like
 * manage-membership.ts's siblings -- but the fix is the same shape, for
 * the same reason, and worth keeping consistent.
 */
export async function revokeInvitation(
  supabase: SupabaseClient,
  invitationId: InvitationId,
): Promise<RevokeInvitationResult> {
  const { data: updated, error } =
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
      )
      .select("id");

  if (error || !updated || updated.length === 0) {
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
  | { status: "MEMBERSHIP_DEACTIVATED"; orgId: OrganizationId }
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
 *
 * MEMBERSHIP_DEACTIVATED is distinct from ALREADY_MEMBER on purpose
 * (20260829360000): both mean a memberships row already exists for this
 * person in this org, but a deactivated one confers no access at all,
 * so treating it as ALREADY_MEMBER would consume the invitation and
 * drop them back into a Snowkap they still cannot see anything in.
 * Reactivation is an explicit admin action (reactivateMember,
 * manage-membership.ts), not something accepting an invite may perform
 * on itself -- the invite carries a role and the dormant row carries
 * another, and silently picking either one is a privilege change nobody
 * requested.
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
    case "MEMBERSHIP_DEACTIVATED":
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
 * email, across every organization. The caller need not be a member of
 * any of these orgs yet -- that is the whole point of
 * /accept-invitation.
 *
 * 2026-09-03 (P14): the caller's email is now filtered EXPLICITLY rather
 * than left to RLS, and the caller must supply it.
 *
 * RLS alone is the wrong tool here, because Postgres OR-combines
 * permissive SELECT policies and this table has two:
 * organization_invitations_select_own_email (addressed to me) and
 * organization_invitations_select_admin_or_owner (issued by an org I
 * administer). An ADMIN or OWNER therefore reads every PENDING
 * invitation their own organization has sent to *other people* -- and
 * this function rendered them on /accept-invitation as though they were
 * addressed to the caller, with a live Accept button that can only ever
 * fail EMAIL_MISMATCH.
 *
 * Verified against real RLS on 2026-09-03 (rolled-back probe): an org
 * OWNER querying status = 'PENDING' saw both an invitation addressed to
 * someone-else@example.com and one addressed to the invitee. Observable
 * in production: ABC's owner sees a phantom "ABC / MEMBER / Accept" row
 * for the invitation addressed to rahil.naik@powerweave.com.
 *
 * manage-sharing-grants.ts's listMyPendingSharingGrantInvitations
 * already documents and fixes this exact class for its own table; this
 * is the same fix, and the two should be read together.
 */
export async function listMyPendingInvitations(
  supabase: SupabaseClient,
  callerConfirmedEmail: string,
): Promise<MyPendingInvitation[]> {
  const normalizedEmail =
    callerConfirmedEmail.trim().toLowerCase();

  if (normalizedEmail.length === 0) {
    return [];
  }

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
      .eq(
        // The RLS policy compares lower(email) to the caller's confirmed
        // email; invitations are stored already-normalized by
        // inviteMember, so an equality filter here matches it exactly.
        "email",
        normalizedEmail,
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

/**
 * How many PENDING invitations are addressed to the caller. Used by the
 * application shell to surface a "Pending invitations" entry, so an
 * invited user who lands anywhere other than /accept-invitation still
 * has a way to find it.
 *
 * Carries the same explicit caller-email filter as
 * listMyPendingInvitations, and for the same reason: without it an
 * ADMIN would carry a permanent, wrong badge counting invitations their
 * own organization had sent to other people.
 *
 * head + count rather than fetching rows: the shell needs a number, and
 * this runs on every authenticated render.
 */
export async function countMyPendingInvitations(
  supabase: SupabaseClient,
  callerConfirmedEmail: string,
): Promise<number> {
  const normalizedEmail =
    callerConfirmedEmail.trim().toLowerCase();

  if (normalizedEmail.length === 0) {
    return 0;
  }

  const { count, error } =
    await supabase
      .from("organization_invitations")
      .select(
        "id",
        { count: "exact", head: true },
      )
      .eq(
        "status",
        "PENDING",
      )
      .eq(
        "email",
        normalizedEmail,
      );

  if (error) {
    return 0;
  }

  return count ?? 0;
}

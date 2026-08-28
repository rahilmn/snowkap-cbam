-- ============================================================
-- Snowkap CBAM
-- P3: let an invited (not-yet-member) user see the org they're
-- invited to
--
-- Purpose:
--   /accept-invitation (app/accept-invitation/page.tsx) shows the
--   organization name for each of the caller's pending invitations,
--   via listMyPendingInvitations()'s embedded
--   `organizations(name)` select. Live browser verification (real
--   invite email -> real GoTrue link -> real session) found this
--   rendering "Unknown organization" -- organizations_select_own_org
--   (20260828070000) only allows a caller who is ALREADY a member to
--   read a row, which is exactly not true for someone who hasn't
--   accepted yet.
--
-- Scope of THIS migration:
--   - organizations_select_via_pending_invitation: an additional
--     SELECT policy admitting a row when the caller has a PENDING
--     invitation to it (matched by their authenticated email, same
--     pattern as organization_invitations_select_own_email). Policies
--     are additive (OR'd together by Postgres RLS), so this only
--     WIDENS visibility for the specific invited-org case -- it does
--     not touch the existing member-visibility policy.
-- ============================================================

create policy organizations_select_via_pending_invitation
    on public.organizations
    for select
    to authenticated
    using (
        exists (
            select 1
            from public.organization_invitations oi
            where oi.org_id = organizations.id
              and oi.status = 'PENDING'
              and lower(oi.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        )
    );

comment on policy organizations_select_via_pending_invitation on public.organizations is
    'Lets an invited user see the name of an org they are not yet a '
    'member of, so /accept-invitation can render it -- see this '
    'migration''s header comment.';


-- ============================================================
-- END OF MIGRATION
-- ============================================================

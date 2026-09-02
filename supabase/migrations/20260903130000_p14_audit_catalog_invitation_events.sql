-- ============================================================
-- Snowkap CBAM
-- P14 (2026-09-03): inviting someone into an organization, and
-- revoking that invitation, leave no audit trail at all.
--
-- THE GAP. audit_events records membership.deactivated,
-- membership.reactivated, membership.removed and
-- membership.role_changed -- every change to a membership that already
-- exists. It records nothing about how one came to exist, or about an
-- attempt that was withdrawn.
--
-- So the audit trail for "who let this person in" begins at
-- membership.invitation_accepted, and the two acts that actually
-- decided it -- an administrator naming an email address, and an
-- administrator taking that back -- are invisible. A revoked invitation
-- leaves no trace whatsoever: the row's status changes and nothing
-- says who changed it or when.
--
-- That matters more than it sounds. Inviting is the only way into an
-- organization, and an invitation carries a ROLE -- an ADMIN invitation
-- is a grant of administrative access to everything the organization
-- can see, including producers' shared emissions data. An audit trail
-- that records role_changed but not the role someone was invited AT can
-- be read end to end without ever showing how an administrator became
-- one.
--
-- THE FIX. Two new event types in the insert policy's catalog.
--
-- Reusing aggregate_type 'MEMBERSHIP' with the INVITATION's id as
-- aggregate_id, exactly as accept_organization_invitation already does
-- (20260828130000) -- so no aggregate_type CHECK changes, and the whole
-- invite -> accept -> role-change -> remove story stays queryable as one
-- aggregate type rather than being split across two namespaces a reader
-- has to know to join.
--
-- The catalog is an allowlist, so this policy has to be re-created
-- whole to add to it. Every existing value is carried across verbatim
-- from the live policy; the two additions are marked.
-- ============================================================

drop policy if exists audit_events_insert_own_org_as_self on public.audit_events;

create policy audit_events_insert_own_org_as_self
    on public.audit_events
    for insert
    to authenticated
    with check (
        actor_type = 'USER'
        and actor_user_id = auth.uid()
        and org_id in (select app.user_org_ids())
        and event_type = any(array[
            'calculation.computed',
            'declaration.amendment_created',
            'declaration.draft_generated',
            'declaration.draft_refreshed',
            'declaration.marked_ready',
            'emission_data.activated',
            'emission_data.discarded',
            'emission_data.recorded',
            'emission_data.rejected',
            'emission_data.submitted',
            'emission_data.superseded',
            'emission_data.verified',
            'emission_determination.redetermined',
            'emission_determination.set',
            'evidence.removed',
            'evidence.uploaded',
            'installation.created',
            'installation.removed',
            'membership.deactivated',
            -- NEW (P14): an administrator invited an address, at a role.
            'membership.invitation_created',
            -- NEW (P14): an administrator withdrew that invitation.
            'membership.invitation_revoked',
            'membership.reactivated',
            'membership.removed',
            'membership.role_changed',
            'operator.created',
            'operator.removed',
            'sharing_grant.accepted',
            'sharing_grant.issued',
            'sharing_grant.revoked',
            'shipment.created',
            'shipment.locked',
            'shipment.marked_ready',
            'shipment.reopened',
            'shipment.voided',
            'shipment_line.added',
            'shipment_line.removed',
            'shipment_line.updated',
            'supplier.created',
            'supplier.removed'
        ])
    );

comment on policy audit_events_insert_own_org_as_self on public.audit_events is
    '2026-09-03 (P14, adds the two invitation events to the 2026-08-29 '
    'catalog). An authenticated caller may write an audit event only for '
    'an organization they belong to, only attributed to themselves, and '
    'only with an event_type this catalog names. The catalog is an '
    'allowlist rather than a CHECK on shape: an event type nobody writes '
    'is a typo, and a typo that silently persists is a hole in a record '
    'whose whole value is that it is complete.';

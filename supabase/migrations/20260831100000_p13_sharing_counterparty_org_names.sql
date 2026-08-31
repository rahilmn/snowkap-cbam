-- ============================================================
-- Snowkap CBAM
-- P13 live-production UI review (2026-08-31): the grantee of an ACTIVE
-- sharing grant could not resolve the GRANTOR organization's name.
--
-- Symptom, reproduced against the live Railway deployment: after
-- accepting a data-sharing grant, the importer's /emissions "Shared-in
-- producer data" table and the shipment line's actual-data picker both
-- rendered "Unknown organization" as the source of the emissions figures
-- they were about to declare.
--
-- Root cause (NOT an application bug): src/application/emissions/
-- list-available-actual-data.ts already performs a follow-up
-- `organizations` lookup and deliberately degrades to the
-- UNKNOWN_GRANTOR_ORGANIZATION_NAME placeholder only when the query
-- SUCCEEDS but a given org id is absent. That is exactly what happens
-- here: the query succeeds, and RLS returns no row, because the grantee
-- has no membership in the grantor org. `organization_visible_via_pending_invitation`
-- (20260828140000) covers only the PENDING-invitation window -- which is
-- why the name resolves correctly on /accept-invitation and then
-- disappears the moment the grant becomes ACTIVE.
--
-- Why this is worth fixing rather than documenting: this platform's whole
-- value proposition is provenance. An importer who cannot see which
-- producer supplied the emissions figure they are about to put in a CBAM
-- declaration has lost the one fact the "Why this number?" chain exists
-- to establish.
--
-- Deliberately NOT fixed by widening `organizations` SELECT RLS. That
-- would disclose the grantor's ENTIRE row -- eori_number,
-- cbam_declarant_status, capabilities, slug -- to every grantee, which is
-- far more than the name being asked for, and is the same over-disclosure
-- shape the P13 audit already flagged elsewhere ("an expired sharing
-- grant still discloses the grantee org's full row"). Instead this adds a
-- SECURITY DEFINER function returning ONLY (id, name), and only for orgs
-- the caller has a genuine, currently-ACTIVE, unexpired grant
-- relationship with -- in either direction, since both the grantee (who
-- shared this with me?) and the grantor (who am I sharing with?) have a
-- legitimate need for the counterparty's name.
-- ============================================================

-- Lives in `public`, not `app`: PostgREST only exposes the `public`
-- schema, so a client-callable RPC has to be there. This matches the
-- existing convention for every other client-callable function in this
-- schema (public.accept_organization_invitation,
-- public.accept_sharing_grant_invitation, public.list_org_members,
-- public.record_declaration_filed) -- the `app` schema is for helpers
-- reached from RLS policies and triggers, never directly by a client.
create or replace function public.sharing_counterparty_org_names()
returns table (
    id uuid,
    name text
)
language sql
stable
security definer
set search_path = public
as $$
    select distinct o.id, o.name
    from public.organizations o
    where o.id in (
        -- Orgs that have granted the caller access (the grantor whose
        -- data the caller can see).
        select sg.grantor_org_id
        from public.sharing_grants sg
        where sg.grantee_org_id in (select app.user_org_ids())
          and sg.status = 'ACTIVE'
          and (sg.expires_at is null or sg.expires_at > now())

        union

        -- Orgs the caller has granted access to (the grantee the caller
        -- is sharing with) -- already surfaced on the producer's own
        -- shared-data status screen, and subject to the identical
        -- ACTIVE/unexpired test.
        select sg.grantee_org_id
        from public.sharing_grants sg
        where sg.grantor_org_id in (select app.user_org_ids())
          and sg.status = 'ACTIVE'
          and sg.grantee_org_id is not null
          and (sg.expires_at is null or sg.expires_at > now())
    );
$$;

comment on function public.sharing_counterparty_org_names() is
    '2026-08-31 (P13 live production UI review): returns ONLY the id and '
    'name of organizations the caller currently has an ACTIVE, unexpired '
    'sharing-grant relationship with, in either direction. Exists so a '
    'grantee can attribute shared emissions data to its real source '
    'without widening organizations SELECT RLS to disclose the '
    'counterparty''s full row (eori_number, cbam_declarant_status, etc.). '
    'Revocation and expiry close this off automatically, since both are '
    'tested here on every call.';

revoke all on function public.sharing_counterparty_org_names() from public;
grant execute on function public.sharing_counterparty_org_names() to authenticated;
grant execute on function public.sharing_counterparty_org_names() to service_role;

-- Drop the initial app-schema placement from this same migration's first
-- application (see the schema note above) so no unreachable duplicate is
-- left behind.
drop function if exists app.sharing_counterparty_org_names();

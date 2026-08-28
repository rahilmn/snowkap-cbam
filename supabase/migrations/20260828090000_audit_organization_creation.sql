-- ============================================================
-- Snowkap CBAM
-- P3: record an audit event when create_organization_with_owner runs
--
-- Purpose:
--   audit_events (20260828070000_create_organizations_foundation.sql)
--   has existed with RLS since the base P3 migration, but nothing
--   actually writes to it -- docs/plans/MASTER_PLAN.md §21/§38 (P3
--   contract) calls for "audit events on every mutation from here on".
--   This is the first write. A CREATE OR REPLACE FUNCTION migration,
--   not an edit to 20260828080000's file -- migrations are forward-
--   only, one concern each; that file stays exactly as committed.
--
-- Scope of THIS migration:
--   - Redefines public.create_organization_with_owner() to also
--     insert one audit_events row (organization.created) in the same
--     transaction as the org + membership insert -- atomic: if the
--     audit insert fails, the whole RPC call fails and nothing is
--     half-recorded. No new RLS policy needed: the function already
--     runs SECURITY DEFINER (see the base migration for why), so it
--     can write audit_events without an authenticated-role INSERT
--     policy existing.
--
-- Deliberately NOT in scope here:
--   - Audit events for membership role changes/removal -- those
--     mutations don't exist yet (deferred, see
--     20260828080000_organization_onboarding_rpc.sql's header
--     comment); they'll get their own audit-event inserts when built.
--   - A general-purpose "record an audit event" RPC or a direct
--     authenticated INSERT policy on audit_events. Every future
--     mutation that needs to write one either goes through its own
--     SECURITY DEFINER RPC (this pattern) or, once real application-
--     layer services exist, through the service-role adapter -- never
--     a bare client-side insert, which would let a caller forge an
--     arbitrary actor_user_id/event_type.
-- ============================================================

create or replace function public.create_organization_with_owner(
    p_name text,
    p_slug text,
    p_capabilities text[]
)
returns public.organizations
language plpgsql
security definer
set search_path = public
as $$
declare
    v_org public.organizations;
begin
    if auth.uid() is null then
        raise exception
            'create_organization_with_owner requires an authenticated caller.';
    end if;

    insert into public.organizations (
        name,
        slug,
        capabilities
    )
    values (
        p_name,
        p_slug,
        p_capabilities
    )
    returning * into v_org;

    insert into public.memberships (
        org_id,
        user_id,
        role
    )
    values (
        v_org.id,
        auth.uid(),
        'OWNER'
    );

    insert into public.audit_events (
        org_id,
        actor_type,
        actor_user_id,
        event_type,
        aggregate_type,
        aggregate_id,
        payload
    )
    values (
        v_org.id,
        'USER',
        auth.uid(),
        'organization.created',
        'ORGANIZATION',
        v_org.id::text,
        jsonb_build_object(
            'name', v_org.name,
            'slug', v_org.slug,
            'capabilities', v_org.capabilities
        )
    );

    return v_org;
end;
$$;

comment on function public.create_organization_with_owner(text, text, text[]) is
    'The only sanctioned way to create an organization: atomically '
    'inserts the org row, a matching OWNER membership row for the '
    'calling user, and an organization.created audit event, all in one '
    'transaction. SECURITY DEFINER because no bare INSERT policy can '
    'express "and also insert exactly one membership row for me" -- '
    'there is no membership yet to authorize a plain table-policy '
    'insert against.';


-- ============================================================
-- END OF MIGRATION
-- ============================================================

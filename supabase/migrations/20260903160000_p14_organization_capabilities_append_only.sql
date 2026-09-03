-- ============================================================
-- Snowkap CBAM
-- P14 (2026-09-03): organizations.capabilities is freely rewritable, so
-- a premise this project has been stating in migration headers and code
-- comments is not actually true.
--
-- FOUND BY the P14 adversarial security re-check, reproduced live as an
-- ordinary authenticated OWNER inside a rolled-back transaction:
--
--     update public.organizations
--     set capabilities = array['PRODUCER_OPERATOR','IMPORTER_DECLARANT']
--     where id = '<own org>';
--     -- UPDATE 1
--
-- WHAT THIS DOES AND DOES NOT MEAN. Adding a capability to your own
-- organisation is not privilege escalation across a tenancy boundary --
-- capabilities describe what an organisation DOES, they are chosen by
-- that organisation at onboarding, and an org that holds both genuinely
-- may act as both (a case the D2 provenance walls deliberately allow).
-- Nothing here reaches another tenant's data; a grant or an invitation
-- is still required for that, and both are separately gated.
--
-- What was wrong is narrower and real: REMOVAL. 20260903120000's header
-- justified using the capability as the wall on the grounds that
-- "capabilities are append-only, so an org that holds
-- IMPORTER_DECLARANT today cannot lose it and strand an existing
-- grant." The application is indeed append-only --
-- organization-profile.ts only ever offers `addCapability`, and
-- computes `[...context.capabilities, update.addCapability]` -- but the
-- database never enforced it. So an organisation could accept a
-- producer's data into itself and then drop IMPORTER_DECLARANT,
-- stranding a grant whose binding is immutable, and leaving the
-- acceptance gate's own stated safety argument false.
--
-- This makes the database agree with the claim. Capabilities may be
-- added; none may be removed.
--
-- Deliberately NOT attempting to stop an organisation granting itself a
-- capability. That is the onboarding model working as designed, and
-- forbidding it here would break the legitimate dual-capability case
-- without closing any boundary -- the honest statement, now recorded in
-- the release audit, is that the capability gate is a SCOPING control
-- rather than a security boundary.
-- ============================================================

create or replace function app.enforce_organization_capabilities_append_only()
returns trigger
language plpgsql
as $$
begin
    if exists (
        select 1
        from unnest(coalesce(old.capabilities, array[]::text[])) as previous_capability
        where previous_capability <> all (coalesce(new.capabilities, array[]::text[]))
    ) then
        raise exception
            'organizations.capabilities is append-only. Removing a capability would strand grants, memberships and frozen determinations that were authorized by it -- including sharing grants whose binding cannot be moved.'
            using errcode = '42501';
    end if;

    return new;
end;
$$;

comment on function app.enforce_organization_capabilities_append_only() is
    '2026-09-03 (P14). Makes true, in the database, the append-only '
    'premise that 20260903120000''s capability wall and the '
    'accept_sharing_grant_invitation capability gate both argue from. '
    'The application was already append-only (organization-profile.ts '
    'offers addCapability and nothing else); nothing enforced it, so an '
    'organization could accept a producer''s data and then drop the '
    'capability that authorized the acceptance, stranding a grant whose '
    'binding is immutable.';

drop trigger if exists organizations_capabilities_append_only on public.organizations;

create trigger organizations_capabilities_append_only
    before update on public.organizations
    for each row execute function app.enforce_organization_capabilities_append_only();

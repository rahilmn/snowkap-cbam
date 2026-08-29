-- ============================================================
-- Snowkap CBAM
-- P13 release-blocker remediation: organizations UPDATE (RLS finding
-- S5) -- organizations_update_admin_or_owner (20260828070000, last
-- redefined by 20260829360000 to route through
-- app.user_is_admin_or_owner_of()) permits ADMIN as well as OWNER.
--
-- The master plan's own role matrix (docs/plans/MASTER_PLAN.md
-- section 14) is explicit: "OWNER -- org profile/danger zone, roles,
-- everything below; ADMIN -- members, shipment LOCK/declare
-- (importer), verification approval + grant issue/revoke (producer)"
-- -- org profile is not among ADMIN's listed powers anywhere in the
-- matrix. src/application/organizations/organization-profile.ts's own
-- updateOrganizationProfile already enforces this at the application
-- layer (`if (context.role !== "OWNER") return
-- {status:"PERMISSION_DENIED"}`), added as a P13 audit follow-up per
-- that function's own doc comment -- but the RLS policy governing the
-- same table was never tightened to match, leaving Wall 2 permissive
-- where Wall 1 already isn't. Confirmed via grep: no other application
-- code writes to public.organizations at all, so there is no other
-- legitimate ADMIN-level write this could be breaking.
--
-- tests/integration/organizations-isolation.test.ts's own P10-era
-- "deactivated ADMIN" test asserted an ACTIVE ADMIN CAN rename the org
-- as correct baseline -- that assertion predates the P13 application-
-- layer tightening above and is updated in the same commit as this
-- migration to assert the opposite, plus a new dedicated test proving
-- OWNER-only holds at the RLS level independent of deactivation.
-- ============================================================

drop policy organizations_update_admin_or_owner on public.organizations;

create policy organizations_update_owner
    on public.organizations
    for update
    to authenticated
    using (
        app.user_is_owner_of(id)
    )
    with check (
        app.user_is_owner_of(id)
    );

comment on policy organizations_update_owner on public.organizations is
    '2026-08-30 (P13 review): replaces organizations_update_admin_or_owner '
    '-- org profile (name, EORI, declarant status, capabilities) is '
    'OWNER-only per master plan section 14, already enforced at the '
    'application layer by updateOrganizationProfile; this closes the '
    'matching RLS gap so a direct write can never do what that '
    'function''s own guard already refuses. app.user_is_owner_of() '
    '(20260829450000) also excludes a deactivated OWNER, so this '
    'inherits that hardening for free.';

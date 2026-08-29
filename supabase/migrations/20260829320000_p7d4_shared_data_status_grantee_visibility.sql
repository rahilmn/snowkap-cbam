-- ============================================================
-- Snowkap CBAM
-- P7-D4: let a grantor resolve the name of an org they've granted
-- data to -- master plan §27 screen 32 ("Shared-data status --
-- transparency; who sees what, consumption events")
--
-- Purpose:
--   Screen 32 needs to show, per issued grant, WHICH organization
--   currently holds (or has held) read access to the grantor's data --
--   not just a bare grantee_org_id uuid. issued-grants-list.tsx's own
--   doc comment (app/(producer)/sharing/issued-grants-list.tsx, written
--   for the earlier "issue a grant" screen, P7-D/P7-D2) already states
--   this precisely: "the grantor has no RLS visibility into the
--   grantee org's own organizations row (organizations_select_own_org
--   scopes to the caller's own memberships, and the grantee org is --
--   by definition -- not one of them)". Confirmed again here by reading
--   the actual applied policies (organizations_select_own_org,
--   20260828070000; organizations_select_via_pending_invitation,
--   20260828140000; organizations_select_via_pending_sharing_grant_invitation,
--   20260829300000) -- none of the three admits a grantor reading a
--   grantee's organizations row for a DIRECT grant (grantee_org_id
--   already resolved). That gap is real, not assumed, and this
--   migration closes exactly it -- nothing broader.
--
-- Design -- a bare additive RLS policy, NOT a SECURITY DEFINER RPC:
--   The symmetric case (an INVITED-by-email grantee resolving the
--   GRANTOR's org name before they've accepted) was already solved this
--   same way, by
--   organizations_select_via_pending_sharing_grant_invitation
--   (20260829300000) -- a plain `exists (select 1 from
--   public.sharing_grants sg where ...)` subquery directly on the
--   `organizations` policy, no SECURITY DEFINER function involved. That
--   migration's own header comment explains why installations (not
--   organizations) needed a SECURITY DEFINER helper
--   (app.installation_has_pending_sharing_grant_invitation) instead of a
--   raw subquery: sharing_grants_insert_own_org's own WITH CHECK
--   (20260829260000) reads `installations` directly, so a policy ON
--   installations that ALSO reads sharing_grants directly creates a
--   real cross-table RLS-evaluation cycle during a sharing_grants
--   INSERT (reproduced live as "infinite recursion detected in policy
--   for relation sharing_grants", 42P17). `organizations` has no such
--   hazard: nothing in sharing_grants' own INSERT/UPDATE policies reads
--   `organizations` directly (the INSERT policy's grantee-is-a-real-org
--   check goes through app.organization_exists(), a SECURITY DEFINER
--   function that bypasses organizations' RLS entirely rather than
--   re-triggering it) -- confirmed by grepping this migration's own
--   sibling files, not assumed. This migration's new policy is
--   therefore exactly the same shape as
--   organizations_select_via_pending_sharing_grant_invitation, just
--   keyed on "I am the grantor of a grant naming this org as grantee"
--   instead of "I am invited by email to a grant this org issued" --
--   no new SECURITY DEFINER function is needed or added here.
--
--   SECURITY FIX (2026-08-29, mandatory adversarial review of this
--   migration, BLOCKING, live-reproduced): the first version of this
--   policy was deliberately NOT status-scoped -- reasoning at the time
--   was that screen 32 wants a producer to keep recognizing a REVOKED
--   grant's grantee ("Acme Steel GmbH", not a bare id). That reasoning
--   missed that issuing a sharing_grants row requires ZERO consent from
--   the named grantee: sharing_grants_insert_own_org (20260829260000)
--   only checks the CALLER's own ADMIN+ status and installation
--   ownership, plus app.organization_exists(grantee_org_id) -- which
--   accepts ANY real org id, since it is a SECURITY DEFINER helper that
--   deliberately bypasses organizations' own RLS. So any authenticated
--   org owner could mint a throwaway installation, issue a sharing_grants
--   row naming an arbitrary victim org's real uuid as grantee_org_id
--   (status defaults to INVITED, no action from the victim required),
--   and this policy's un-scoped EXISTS clause would immediately admit
--   reading that victim's FULL organizations row -- name, eori_number
--   (a real EU regulated trader identifier), cbam_declarant_status, and
--   every other column, since RLS is row-level, not column-level.
--   Reproduced live end to end against real local Postgres, including
--   confirming the leak survived the attacker revoking their own sham
--   grant afterward (this policy was never status-scoped, so REVOKED
--   still satisfied it) -- not a theoretical concern.
--
--   Fixed by requiring sg.status = 'ACTIVE': a sharing_grants row can
--   only ever reach ACTIVE via sharing_grants_update_grantee_accept
--   (20260829260000), whose own USING/WITH CHECK independently requires
--   the CALLER to already be a member of grantee_org_id -- i.e. someone
--   from the genuinely named org must themselves accept it. An
--   attacker naming a victim org they have no membership in can never
--   satisfy that on the victim's behalf, so a sham grant can never
--   leave INVITED, and this policy can never admit it. This closes the
--   vulnerability completely, at the cost of the original "keep
--   resolving the name after REVOKE" goal -- REVOKED-status history
--   correctly falls back to the existing "Unknown organization"
--   placeholder in list-shared-data-status.ts rather than a name, an
--   explicit, disclosed regression versus the migration's original
--   intent, not a silent one. Restoring post-revoke name visibility
--   needs a different mechanism entirely (e.g. snapshotting the
--   grantee's name onto the sharing_grants row at the moment it first
--   becomes ACTIVE, immune to this exact attack since it could only
--   ever be populated by the same accept-time gate) -- not attempted
--   here; tracked as a follow-up, not silently dropped.
--
-- audit_events for consumption-event history -- NO new policy needed:
--   record_shared_data_consumption() (20260829310000) already inserts
--   its 'sharing_grant.data_consumed' row with org_id =
--   v_grant.grantor_org_id, and audit_events_select_own_org
--   (20260828070000: `org_id in (select app.user_org_ids())`) already
--   admits the grantor reading their own org's audit_events rows --
--   confirmed by an explicit assertion using the real grantor's own
--   authenticated client (not the service-role client) in
--   tests/integration/shared-data-status-visibility.test.ts, per this
--   task's own "confirm this, don't assume it" instruction. Nothing in
--   this migration touches audit_events.
-- ============================================================


create policy organizations_select_via_own_issued_sharing_grant
    on public.organizations
    for select
    to authenticated
    using (
        exists (
            select 1
            from public.sharing_grants sg
            where sg.grantee_org_id = organizations.id
              and sg.grantor_org_id in (select app.user_org_ids())
              and sg.status = 'ACTIVE'
        )
    );

comment on policy organizations_select_via_own_issued_sharing_grant on public.organizations is
    'Lets a grantor resolve the name of an org their own org has issued '
    'an ACTIVE sharing_grants row to. 2026-08-29 security fix: scoped to '
    'status = ''ACTIVE'' only (not every status as originally written) -- '
    'see this migration''s header comment for the live-reproduced leak '
    '(a grantor could read an arbitrary victim org''s full row, including '
    'eori_number, via a self-issued, never-accepted sham grant) this '
    'closes and why only an ACTIVE row is safe to trust: reaching ACTIVE '
    'requires the named grantee org to have genuinely accepted it '
    'themselves (sharing_grants_update_grantee_accept, 20260829260000), '
    'which an attacker naming a victim they have no membership in can '
    'never do on the victim''s behalf.';


-- ============================================================
-- END OF MIGRATION
-- ============================================================

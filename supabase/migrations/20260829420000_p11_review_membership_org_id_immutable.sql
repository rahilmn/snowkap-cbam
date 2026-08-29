-- ============================================================
-- Snowkap CBAM
-- P11 mandatory security review response: memberships.org_id was
-- mutable -- a dual-org admin could silently relocate a colleague's
-- membership into a different org via a bare UPDATE
--
-- Purpose:
--   Finding #7 (SHOULD-FIX, confirmed live): 20260829090000 (P4
--   tenancy hardening) attached app.prevent_org_id_change() to
--   shipments/shipment_lines/suppliers, and 20260829370000 pinned
--   memberships.user_id immutable for the identical class of reason
--   (memberships_update_admin_or_owner's WITH CHECK can only ever see
--   the proposed NEW row, never the row's pre-update value, so it
--   cannot express "org_id must equal what it already was") -- but
--   memberships.org_id itself was never given the same guard.
--
--   Live reproduction: a user who is OWNER of both org A and org C
--   issues `update memberships set org_id = '<org C>' where id =
--   '<a colleague''s membership row in org A>'` and it succeeds --
--   silently moving that colleague out of org A (they lose all access
--   there with no notice) and into org C (they gain access there with
--   no invitation, no consent, and no audit event). A stranger cannot
--   do this (memberships_update_admin_or_owner's USING clause already
--   requires admin/owner of the row's CURRENT org_id), and self-
--   escalation into a foreign org is already blocked (the WITH CHECK
--   re-tests admin/owner status against the row's NEW org_id too) --
--   so this is bounded to the dual-admin case (e.g. a consultant who
--   administers two client orgs), but nothing sanctioned in the
--   application layer ever does this, and RLS alone should not permit
--   it either.
--
--   app.prevent_org_id_change() (20260829090000) is already a
--   TABLE-GENERIC trigger function (its RAISE message uses
--   `tg_table_name`, not a hardcoded table name), built specifically
--   so it could be attached to any future table needing the same
--   guard without redefining it -- this migration is exactly that:
--   attaching the EXISTING function to a new table, not adding a new
--   one. Not classified as a "material security-boundary change"
--   requiring ADR-0013 escalation, for the same reason
--   20260829090000/20260829370000 both gave for their own org_id/
--   user_id triggers: this restores the isolation
--   memberships_update_admin_or_owner's own WITH CHECK already
--   evidently intended (re-testing admin/owner status against BOTH
--   the old and new org_id only makes sense if org_id was meant to be
--   stable), not a capability anyone was ever meant to have.
-- ============================================================


create trigger memberships_prevent_org_id_change_trg
    before update on public.memberships
    for each row
    execute function app.prevent_org_id_change();

comment on trigger memberships_prevent_org_id_change_trg on public.memberships is
    '2026-08-29 (P11 mandatory review, finding #7): closes the one '
    'gap left after 20260829090000 (shipments/shipment_lines/'
    'suppliers) and 20260829370000 (memberships.user_id) -- see this '
    'migration''s header comment for the live-reproduced dual-org-'
    'admin exploit this closes. Reuses app.prevent_org_id_change() '
    '(20260829090000) verbatim -- that function was already written '
    'table-generic (its exception message uses tg_table_name) for '
    'exactly this kind of reuse, so no new trigger function was '
    'needed.';


-- ============================================================
-- END OF MIGRATION
-- ============================================================

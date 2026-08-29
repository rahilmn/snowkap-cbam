-- ============================================================
-- Snowkap CBAM
-- P10 review response: pin memberships.user_id immutable
--
-- Purpose:
--   P10's mandatory authorization review (2026-08-29, finding #5) found
--   live that memberships_update_admin_or_owner's WITH CHECK does not
--   actually pin user_id unchanged, contrary to its own migration
--   header's claim (20260828110000: "A caller cannot use UPDATE to...
--   reassign a membership to a different user)... additionally pins
--   user_id unchanged" -- the policy's own inline comment, lines 95-102
--   of that file, admits this and defers to the application layer,
--   which in fact never enforces it either: every application-layer
--   caller in src/application/organizations/manage-membership.ts
--   (changeMemberRole, removeMember, deactivateMember, reactivateMember)
--   already never includes user_id in its UPDATE payload, so nothing
--   there was ever pinning it -- there was simply no code path that
--   tried to change it, which is a different thing from the column
--   being protected.
--
--   Reproduced live: an ADMIN issuing
--     update memberships set user_id = '<a different auth.users id>'
--     where id = '<some membership row in their own org>'
--   succeeds -- reassigning an existing membership row to an entirely
--   different identity, with no invitation, no email match, no consent
--   from either party, and no audit event. The previous holder silently
--   loses access and the new holder gains org membership they never
--   requested or accepted. Cross-org movement is already blocked
--   (WITH CHECK re-tests app.user_is_admin_or_owner_of() against the
--   row's NEW org_id, so moving a row to an org the caller doesn't
--   administer fails), but same-org user_id reassignment is not.
--
--   Per 20260828110000's own comment (lines 95-102): a bare RLS
--   WITH CHECK cannot compare a row's post-update value against its own
--   pre-update value, so this cannot be closed by editing the policy --
--   the same limitation, and the same fix, as
--   20260829090000_p4_shipment_tenancy_hardening.sql's
--   app.prevent_org_id_change() / app.prevent_shipment_line_reparent()
--   triggers, which that migration's own header explicitly reasoned
--   through under the identical heading ("Postgres RLS's WITH CHECK
--   only ever sees the proposed NEW row -- it has no way to express
--   'must equal what this column was before this UPDATE' without a
--   trigger"). This migration follows that precedent exactly, including
--   its non-SECURITY-DEFINER choice (this function needs to read
--   nothing RLS would otherwise block) and its escalation reasoning:
--
--   Not classified as a "material security-boundary change" requiring
--   ADR-0013 escalation, for the same reason 20260829090000 gave for
--   its own org_id triggers: this restores the isolation the existing
--   RLS policy already claimed to provide (20260828110000's own header
--   asserts user_id pinning as already-intended behavior; this fixes
--   the implementation to match the stated intent, it does not grant or
--   revoke a capability anyone was ever meant to have). It is also
--   explicitly NOT the last-ACTIVE-OWNER counting invariant that
--   20260828110000 and 20260829360000 both deliberately keep out of SQL
--   (documented at length in both of those migrations' headers, and
--   left untouched here, on purpose -- see this phase's review response
--   notes for why that finding is tracked separately rather than fixed
--   in this migration). Pinning one column to its own previous value is
--   a single-fact immutability constraint with exactly one correct
--   definition and nothing to count or drift from -- not a business
--   rule with a TypeScript twin the way the owner invariant is.
-- ============================================================


create or replace function app.prevent_membership_user_id_change()
returns trigger
language plpgsql
as $$
begin
    if new.user_id is distinct from old.user_id then
        raise exception
            'memberships.user_id is immutable -- remove and re-invite instead of reassigning a membership row.';
    end if;

    return new;
end;
$$;

comment on function app.prevent_membership_user_id_change() is
    'BEFORE UPDATE guard closing the gap this migration''s header '
    'describes: memberships_update_admin_or_owner''s WITH CHECK '
    '(20260828110000) cannot reference a row''s pre-update value, so '
    'nothing previously stopped an ADMIN/OWNER from reassigning an '
    'existing membership row to a different auth.users id via a bare '
    'UPDATE. Not SECURITY DEFINER -- same reasoning as '
    'app.prevent_org_id_change() (20260829090000): triggers run with '
    'the privileges of the role performing the UPDATE regardless, and '
    'this function does not need to read anything RLS would otherwise '
    'block.';

create trigger memberships_prevent_user_id_change_trg
    before update on public.memberships
    for each row
    execute function app.prevent_membership_user_id_change();

comment on trigger memberships_prevent_user_id_change_trg on public.memberships is
    'Enforces that user_id cannot change on UPDATE -- see '
    'app.prevent_membership_user_id_change()''s comment and this '
    'migration''s header for why this is a trigger, not a WITH CHECK '
    'clause, and why it does not reopen 20260828110000 / '
    '20260829360000''s deliberate rejection of DB-level last-ACTIVE-'
    'OWNER enforcement (a different, uncounted invariant).';


-- ============================================================
-- END OF MIGRATION
-- ============================================================

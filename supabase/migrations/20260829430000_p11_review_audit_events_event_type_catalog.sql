-- ============================================================
-- Snowkap CBAM
-- P11 mandatory security review response: audit_events_insert_own_org_as_self
-- pinned WHO (actor_user_id = auth.uid()) but never WHAT -- any MEMBER
-- could forge an arbitrary event_type/aggregate_type/payload in their
-- own org
--
-- Purpose:
--   Finding #10 (SHOULD-FIX, confirmed live -- narrower than first
--   reported once independently re-verified): 20260828090000's own
--   header comment states the rule this policy was meant to enforce --
--   "never a bare client-side insert, which would let a caller forge
--   an arbitrary actor_user_id/event_type" -- but
--   audit_events_insert_own_org_as_self (20260828150000) only ever
--   pinned actor_user_id and org_id; event_type, aggregate_type,
--   aggregate_id, and payload stayed entirely caller-controlled. The
--   mandatory reviewer confirmed actor_type = 'SYSTEM' IS already
--   refused (a plain MEMBER cannot impersonate the platform itself),
--   narrowing the residual to: a member can forge event_type/
--   aggregate_type/payload AS THEMSELVES, in their own org. Live
--   reproduction: a plain MEMBER inserts a row with
--   event_type = 'declaration.filed' and a forged
--   payload {"filed_reference": "FORGED"} -- a §21 compliance event
--   that never actually happened, and audit_events carries no UPDATE/
--   DELETE policy by design, so it can never be retracted.
--
--   The fix narrows the WITH CHECK to a catalog of the event_type
--   values any LEGITIMATE bare client insert (i.e. every real
--   recordAuditEvent() call site under src/application, since app/
--   itself never calls recordAuditEvent directly -- confirmed by
--   grep) can ever actually produce. Deliberately EXCLUDES every
--   event_type this schema only ever writes from inside a SECURITY
--   DEFINER RPC or trigger, which bypasses this policy entirely and
--   therefore never needed to be in this list in the first place --
--   'organization.created' (create_organization_with_owner, RPC),
--   'membership.invitation_accepted' (accept_organization_invitation,
--   RPC), 'sharing_grant.data_consumed' (record_shared_data_consumption,
--   RPC), and 'declaration.filed' (record_declaration_filed, RPC --
--   this is the exact forgery reproduced live above). A plain client
--   INSERT can now never claim one of THOSE event types, closing the
--   live reproduction directly, while every genuine application-layer
--   audit write continues to work unchanged.
--
--   Residual, stated plainly rather than silently assumed away (same
--   posture record_shared_data_consumption's own known-gap comment
--   already uses in this schema): a member can still forge a
--   CATALOG event type as a false narrative for a real action they
--   did not actually perform (e.g. a real "shipment.marked_ready" row
--   with no matching status transition having occurred) -- this
--   migration closes "an entirely fabricated event/aggregate no
--   legitimate flow ever produces," not "a true event type paired
--   with a false claim about what happened," which would require
--   re-deriving every action's own invariants inside this policy (a
--   real architecture change, not an in-scope P11 hardening fix).
-- ============================================================


drop policy audit_events_insert_own_org_as_self on public.audit_events;

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
    '2026-08-29 (P11 mandatory review, finding #10): now additionally '
    'requires event_type to be one of the catalog values a real '
    'application-layer recordAuditEvent() call site (src/application/**, '
    'the only place any bare client insert into this table ever '
    'originates -- app/** never calls it directly) can actually '
    'produce -- see this migration''s header comment for the exact '
    'live-reproduced forgery this closes '
    '(event_type = ''declaration.filed'' with a forged '
    'filed_reference, inserted by a plain MEMBER) and the RPC-only '
    'event types deliberately excluded from this catalog because they '
    'bypass this policy entirely via SECURITY DEFINER. actor_type = '
    '''USER''/actor_user_id = auth.uid()/org_id in own orgs are '
    'unchanged from 20260828150000. Residual: a member can still '
    'forge a CATALOG event type as a false narrative for an action '
    'that did not really happen -- stated explicitly in this '
    'migration''s header comment, not silently assumed away.';


-- ============================================================
-- END OF MIGRATION
-- ============================================================

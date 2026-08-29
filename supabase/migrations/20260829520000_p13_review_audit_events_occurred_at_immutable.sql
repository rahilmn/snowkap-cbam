-- ============================================================
-- Snowkap CBAM
-- P13 final adversarial audit finding, high severity:
-- audit_events.occurred_at was entirely client-supplied and
-- unconstrained -- any authenticated member could backdate/future-date
-- events, and 200 forged far-future rows permanently push every real
-- event off the org's only Audit screen (no pagination, no
-- UPDATE/DELETE policy to ever remove them)
--
-- Purpose:
--   audit_events_insert_own_org_as_self (most recently redefined by
--   20260829430000) pins WHO (actor_user_id = auth.uid()), WHERE
--   (org_id), and WHAT (the event_type catalog) -- but never WHEN.
--   occurred_at is `timestamptz not null default now()` with no CHECK
--   constraint and no RLS predicate, so a caller supplying an explicit
--   value in their INSERT payload gets exactly that value, not the
--   column default. Confirmed live-reproduced by the audit: a plain
--   MEMBER inserting occurred_at = '2999-01-01' succeeds, and
--   listAuditEvents' own `order occurred_at desc, id desc limit 200`
--   query then returns 200 forged rows and zero real ones once enough
--   are inserted.
--
--   No application code path ever sets occurred_at explicitly
--   (confirmed: record-audit-event.ts's INSERT payload has no
--   occurred_at key at all, relying entirely on the column's own
--   `default now()`), so force-overwriting it unconditionally is safe
--   for every legitimate caller -- the same "force-overwrite, don't
--   merely validate" posture this codebase already applies to
--   emission_data.verifier_user_id
--   (app.enforce_emission_data_verification_gate, 20260829480000).
-- ============================================================

create or replace function app.pin_audit_event_occurred_at()
returns trigger
language plpgsql
as $$
begin
    new.occurred_at := now();
    return new;
end;
$$;

comment on function app.pin_audit_event_occurred_at() is
    '2026-08-29 (P13 audit follow-up): unconditionally overwrites any '
    'client-supplied occurred_at with now() on every INSERT -- no '
    'application code path ever sets this column explicitly, so this '
    'is safe for every legitimate caller. Closes a live-reproduced '
    'backdating/future-dating forgery that could permanently push real '
    'events off the org''s only Audit screen (200-row limit, no '
    'pagination, no UPDATE/DELETE policy to ever remove a forged row).';

create trigger audit_events_pin_occurred_at_trg
    before insert on public.audit_events
    for each row
    execute function app.pin_audit_event_occurred_at();

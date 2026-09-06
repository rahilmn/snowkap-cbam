-- ============================================================
-- Snowkap CBAM
-- S5 review remediation (2026-09-06), findings AUTHZ-B1 / S5R-B1
-- (fresh independent Opus 5 certification review). The dossier lock
-- trigger (app.enforce_dossier_lock, 20260906200000, predicate widened
-- 20260906230000) was created as `BEFORE UPDATE OR DELETE` -- the
-- earlier same-day migration widened its PREDICATE (which states now
-- count as locked) but never widened its EVENT LIST, so the lock has
-- never fired on INSERT at all. The two INSERT RLS policies
-- (emission_data_declaration_context_insert_own_org,
-- emission_data_precursors_insert_own_org, both 20260906180000) gate
-- only on org ownership, with no status/verification_status condition
-- -- so an ordinary MEMBER of the owning producer org (no admin
-- privilege) could INSERT a brand-new declaration_context row (with a
-- fabricated verifier_report_declared = true and free-text description)
-- or a brand-new precursor row directly onto an already ACTIVE+VERIFIED,
-- cross-org-shared emission_data record, with UPDATE and DELETE on that
-- same row correctly refused in the same session.
--
-- LIVE-REPRODUCED (S5 review, adversarial verify round): an ordinary
-- MEMBER (no ADMIN/OWNER) of the owning producer org successfully
-- INSERTed both a declaration_context row (verifier_report_declared =
-- true, a fabricated free-text description naming a fake verification
-- body) and a precursor row onto a record already ACTIVE+VERIFIED and
-- actively shared to a second org via an ACTIVE sharing_grants row --
-- confirmed visible to the grantee org in the same transaction. The
-- same session's UPDATE/DELETE against the same rows were correctly
-- refused by the existing (UPDATE OR DELETE) trigger.
--
-- Impact: get-buyer-view.ts reads declaration context and precursors
-- LIVE (never a frozen snapshot until determination time), so an
-- injected row reaches a cross-org buyer's "Buyer view & readiness"
-- screen for a record whose badges read Published / internally
-- reviewed -- content the producer's own completed internal review
-- never covered. This is the un-closed half of exactly the defect
-- 20260906230000 itself set out to close.
--
-- Fix: widen both triggers' event list to `BEFORE INSERT OR UPDATE OR
-- DELETE`. The function body already handles tg_op = 'INSERT' correctly
-- (the v_emission_data_id case statement's `else new.emission_data_id`
-- branch, and the final `return new` for any non-DELETE op) -- this
-- migration touches only the two `create trigger` statements, not
-- app.enforce_dossier_lock() itself. The predicate is already false for
-- a plain DRAFT+UNVERIFIED record, so the normal producer capture flow
-- (INSERT while DRAFT) is unaffected -- verified live: a fresh DRAFT
-- record's INSERT succeeded before and after this change. This also
-- brings the child tables in line with the established pattern one
-- level up: the parent table's own lock
-- (app.enforce_emission_data_lineage_lock, 20260903210000) has always
-- been `BEFORE INSERT OR UPDATE` -- the child tables were the outlier,
-- not the parent.
-- ============================================================

drop trigger if exists emission_data_declaration_context_lock_trg
    on public.emission_data_declaration_context;

create trigger emission_data_declaration_context_lock_trg
    before insert or update or delete on public.emission_data_declaration_context
    for each row
    execute function app.enforce_dossier_lock();

drop trigger if exists emission_data_precursors_lock_trg
    on public.emission_data_precursors;

create trigger emission_data_precursors_lock_trg
    before insert or update or delete on public.emission_data_precursors
    for each row
    execute function app.enforce_dossier_lock();

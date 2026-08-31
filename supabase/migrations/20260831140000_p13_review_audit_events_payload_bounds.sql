-- ============================================================
-- Snowkap CBAM
-- P13 remaining-findings review -- audit_events had no bound on the
-- size or shape of attacker-supplied columns.
--
-- WHAT WAS ACTUALLY UNCONSTRAINED
--
-- audit_events (20260828070000) declares:
--     event_type      text not null,
--     aggregate_id    text not null,
--     payload         jsonb not null default '{}'::jsonb,
--     correlation_id  text,
--
-- and carries exactly six constraints -- pkey, two FKs,
-- actor_type_check, aggregate_type_check, actor_consistency_ck. None of
-- them mentions payload, aggregate_id or correlation_id. A repo-wide
-- grep for octet_length / pg_column_size / any payload length guard in
-- src/, app/ and supabase/migrations/ returns nothing either, so
-- neither wall bounded these.
--
-- `event_type` is NOT part of this: it was already closed by
-- 20260829430000, whose INSERT policy pins it to a catalog. That half of
-- the finding was verified as already-fixed and is deliberately left
-- alone here.
--
-- REACHABILITY, stated honestly. audit_events is INSERT-able by an
-- authenticated member (that is the point -- the application records its
-- own events under the caller's identity), and the insert policy
-- constrains org, actor and event_type but says nothing about size. So
-- an ordinary member, posting directly to PostgREST with a valid
-- catalog event_type, could write a multi-megabyte payload per row and
-- repeat. Because audit_events is deliberately append-only -- no UPDATE
-- and no DELETE policy exists, by design (§21: immutable history) --
-- nothing in the product can clean that up afterward. That is the real
-- shape of this issue: not a cross-tenant read, but unbounded,
-- irreversible growth in the one table the schema forbids itself from
-- pruning.
--
-- WHY octet_length(payload::text) AND NOT pg_column_size(payload)
--
-- pg_column_size reports the TOAST-compressed size. Highly compressible
-- filler (a megabyte of one repeated character) would slip under any
-- such bound while still costing real storage once decompressed, so it
-- is not a bound an attacker cannot game. octet_length on the text
-- rendering measures what was actually supplied.
--
-- BOUNDS VALIDATED AGAINST REAL PRODUCTION DATA, not guessed. Measured
-- on the hosted project immediately before writing this migration:
--     rows                              27
--     max octet_length(payload::text)  390 bytes
--     max length(aggregate_id)          36
--     max length(correlation_id)        36
--     rows whose payload is not object   0
-- 8192 bytes is ~21x the largest payload this application has ever
-- actually written, so every existing row validates and no NOT VALID /
-- backfill dance is required. aggregate_id and correlation_id are UUIDs
-- in practice (36 chars); 200 leaves room for a non-UUID aggregate key
-- without permitting a text blob smuggled through a column nobody
-- thought to bound.
--
-- These are FORM and SIZE bounds only. They encode no regulatory
-- judgement of any kind and no regulatory number enters here.
-- ============================================================

alter table public.audit_events
    add constraint audit_events_payload_is_object_ck
        check (jsonb_typeof(payload) = 'object');

comment on constraint audit_events_payload_is_object_ck on public.audit_events is
    '2026-08-31 (P13 remaining-findings review): payload must be a JSON '
    'OBJECT. jsonb accepts a bare scalar or array too (''"x"''::jsonb and '
    '''[1,2]''::jsonb are both valid jsonb), and every reader in this '
    'codebase -- the audit UI, the CSV export, the explanation chain -- '
    'assumes an object with named keys. A scalar payload would not be '
    'rejected anywhere; it would simply render as nothing.';

alter table public.audit_events
    add constraint audit_events_payload_size_ck
        check (octet_length(payload::text) <= 8192);

comment on constraint audit_events_payload_size_ck on public.audit_events is
    '2026-08-31 (P13 remaining-findings review): bounds an authenticated '
    'member''s direct PostgREST insert. audit_events has no UPDATE and no '
    'DELETE policy by deliberate design (append-only immutable history), '
    'so unbounded writes here are also unremovable -- the reason a size '
    'bound matters more on this table than on one that can be pruned. '
    '8192 is ~21x the largest payload the application has ever written '
    '(390 bytes, measured across 27 production rows, 2026-08-31). '
    'octet_length(payload::text) deliberately, NOT pg_column_size, which '
    'reports the TOAST-COMPRESSED size and would let highly compressible '
    'filler past the bound.';

alter table public.audit_events
    add constraint audit_events_aggregate_id_length_ck
        check (length(aggregate_id) <= 200);

comment on constraint audit_events_aggregate_id_length_ck on public.audit_events is
    '2026-08-31 (P13 remaining-findings review): aggregate_id is a UUID '
    'in every real write (max observed 36). 200 allows a non-UUID '
    'aggregate key without permitting a text blob through an unbounded '
    'text column.';

alter table public.audit_events
    add constraint audit_events_correlation_id_length_ck
        check (correlation_id is null or length(correlation_id) <= 200);

comment on constraint audit_events_correlation_id_length_ck on public.audit_events is
    '2026-08-31 (P13 remaining-findings review): same bound and reasoning '
    'as aggregate_id, plus an explicit null allowance -- correlation_id '
    'is nullable and a null must stay legal.';

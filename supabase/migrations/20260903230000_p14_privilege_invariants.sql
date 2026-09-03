-- ============================================================
-- Snowkap CBAM
-- P14 remediation (2026-09-03): a deliberate REVOKE can be silently
-- undone by any later blanket GRANT, and nothing notices.
--
-- ------------------------------------------------------------
-- THE PATTERN, WHICH HAS NOW HAPPENED TWICE
--
-- 20260903190000 closed the calculation-result forgery by revoking
-- INSERT/UPDATE/DELETE on public.calculation_results from anon and
-- authenticated, and granting EXECUTE on record_calculation_result to
-- service_role only. Correct, and provably effective in the database it
-- was applied to.
--
-- supabase/seed.sql then ran `grant all on all tables in schema public`
-- and `grant all on all functions in schema public` to anon,
-- authenticated and service_role -- because it exists to replicate the
-- base-table privileges the hosted platform provisions and local
-- Postgres does not. Every one of those revokes was handed straight
-- back. CI caught it, and the fix was to re-assert the three revokes at
-- the end of seed.sql, by hand.
--
-- The P14 review then found the same class again, still open: seven
-- SECURITY DEFINER functions in `public` are EXECUTE-able by `anon` in
-- every freshly built environment, because only one of eight
-- deliberate revokes is re-asserted. They each guard themselves on
-- auth.uid() internally, so nothing is presently exploitable -- but the
-- release audit's claim that seed.sql "states the final intended
-- posture" was false, and the hand-maintained list is exactly the kind
-- of thing that is right on the day it is written and wrong three
-- migrations later.
--
-- The general rule, worth stating once: ANY blanket grant that runs
-- after a narrow revoke undoes it. That is true of seed.sql, of a
-- fresh Supabase project's own bootstrap, and of a pg_restore -- a dump
-- records the grants that exist and never their absence. There is no
-- environment where "we revoked it once" is a durable statement.
--
-- ------------------------------------------------------------
-- WHY NOT JUST MAINTAIN THE LIST MORE CAREFULLY
--
-- Because the failure is silent, and silence is the whole problem. A
-- forgotten re-assertion produces a working application with a reopened
-- privilege; nothing fails, no test turns red, and the environment that
-- has the hole is a freshly built one -- which is to say, the next
-- production restore.
--
-- ------------------------------------------------------------
-- WHAT THIS MIGRATION ADDS
--
-- A declarative registry of privileges that MUST NOT be held, and one
-- function that checks it. The invariant travels with the migration
-- that created it: a future migration that revokes something registers
-- a row here in the same commit, and from that moment every
-- environment can be asked, mechanically, whether the revoke survived.
--
-- Three callers, so a reopened privilege is loud in every place it
-- could appear:
--
--   * supabase/seed.sql runs it after its blanket grants and RAISES on
--     any violation -- so a fresh local or CI build fails at seed time
--     rather than coming up quietly wrong;
--   * scripts/ops/compare-database-posture.mjs --check runs it, so a
--     restored database is checked during recovery, which is when this
--     matters most and when nobody has time to audit ACLs by hand;
--   * CI invokes the comparator, so the check is actually executed
--     rather than merely available. (The P14 review found ci.yml never
--     invoked that script at all, while the runbooks named it as the
--     acceptance test.)
--
-- This does not replace the re-assertions in seed.sql. Those still do
-- the work of restoring the intended posture; this makes their absence
-- impossible to miss.
-- ============================================================

create table if not exists app.privilege_invariants (
    id uuid primary key default gen_random_uuid(),

    -- TABLE                 -- object_identity is 'schema.table'
    -- FUNCTION              -- object_identity is a full signature
    -- ALL_TABLES_IN_SCHEMA  -- object_identity is the schema name
    object_kind text not null
        check (
            object_kind in ('TABLE', 'FUNCTION', 'ALL_TABLES_IN_SCHEMA')
        ),

    object_identity text not null,

    role_name text not null,

    -- SELECT / INSERT / UPDATE / DELETE / TRUNCATE / REFERENCES /
    -- TRIGGER for tables; EXECUTE for functions.
    privilege text not null,

    -- The migration that revoked it. Not decoration: when this check
    -- fires during a restore, the operator needs to know which change
    -- is being undone, not merely that something is.
    source_migration text not null,

    rationale text not null,

    created_at timestamptz not null default now(),

    constraint privilege_invariants_unique
        unique (object_kind, object_identity, role_name, privilege)
);

comment on table app.privilege_invariants is
    '2026-09-03 (P14). Privileges that MUST NOT be held, registered by '
    'the migration that revoked them. Exists because a revoke is not a '
    'durable statement: any later blanket grant undoes it, and a dump '
    'records the grants that exist and never their absence -- so '
    'seed.sql, a fresh project bootstrap and a pg_restore all silently '
    'reopen what a migration deliberately closed. Checked by '
    'app.assert_privilege_invariants().';

alter table app.privilege_invariants enable row level security;

-- No policy is created deliberately: RLS with no policy default-denies,
-- and nothing outside the trusted paths below has any business reading
-- or writing this table. app.assert_privilege_invariants() is SECURITY
-- DEFINER and reads it as the owner.

create or replace function app.assert_privilege_invariants()
returns table (
    violation text,
    object_kind text,
    object_identity text,
    role_name text,
    privilege text,
    source_migration text
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_row record;
    v_table record;
begin
    for v_row in
        select pi.object_kind,
               pi.object_identity,
               pi.role_name,
               pi.privilege,
               pi.source_migration,
               pi.rationale
        from app.privilege_invariants pi
        order by pi.object_kind, pi.object_identity, pi.role_name, pi.privilege
    loop
        -- A role that does not exist in this database cannot hold a
        -- privilege. Skipped rather than reported: an environment
        -- without `anon` is a bare Postgres, not a reopened boundary,
        -- and reporting it would train the reader to ignore output.
        if not exists (
            select 1 from pg_roles where rolname = v_row.role_name
        ) then
            continue;
        end if;

        if v_row.object_kind = 'TABLE' then
            if to_regclass(v_row.object_identity) is not null
               and has_table_privilege(
                       v_row.role_name, v_row.object_identity, v_row.privilege)
            then
                violation := format(
                    '%s holds %s on %s -- revoked by %s (%s)',
                    v_row.role_name, v_row.privilege, v_row.object_identity,
                    v_row.source_migration, v_row.rationale);
                object_kind := v_row.object_kind;
                object_identity := v_row.object_identity;
                role_name := v_row.role_name;
                privilege := v_row.privilege;
                source_migration := v_row.source_migration;
                return next;
            end if;

        elsif v_row.object_kind = 'FUNCTION' then
            if to_regprocedure(v_row.object_identity) is not null
               and has_function_privilege(
                       v_row.role_name, v_row.object_identity, v_row.privilege)
            then
                violation := format(
                    '%s holds %s on function %s -- revoked by %s (%s)',
                    v_row.role_name, v_row.privilege, v_row.object_identity,
                    v_row.source_migration, v_row.rationale);
                object_kind := v_row.object_kind;
                object_identity := v_row.object_identity;
                role_name := v_row.role_name;
                privilege := v_row.privilege;
                source_migration := v_row.source_migration;
                return next;
            end if;

        elsif v_row.object_kind = 'ALL_TABLES_IN_SCHEMA' then
            -- Checked per table, and reported per table, so the output
            -- names what is actually wrong rather than saying "the
            -- schema". A future table created after the revoke is the
            -- likeliest way this one breaks.
            for v_table in
                select c.oid::regclass::text as identity
                from pg_class c
                join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = v_row.object_identity
                  and c.relkind in ('r', 'p')
                order by 1
            loop
                if has_table_privilege(
                       v_row.role_name, v_table.identity, v_row.privilege)
                then
                    violation := format(
                        '%s holds %s on %s -- revoked schema-wide by %s (%s)',
                        v_row.role_name, v_row.privilege, v_table.identity,
                        v_row.source_migration, v_row.rationale);
                    object_kind := v_row.object_kind;
                    object_identity := v_table.identity;
                    role_name := v_row.role_name;
                    privilege := v_row.privilege;
                    source_migration := v_row.source_migration;
                    return next;
                end if;
            end loop;
        end if;
    end loop;

    return;
end;
$$;

comment on function app.assert_privilege_invariants() is
    '2026-09-03 (P14). Returns one row per privilege that is held but '
    'registered in app.privilege_invariants as revoked -- empty means '
    'every deliberate revoke in this database''s history has survived. '
    'Returns rather than raises, so seed.sql can fail the build while '
    'compare-database-posture.mjs can list every violation at once '
    'during a restore. A role that does not exist is skipped, not '
    'reported: a bare Postgres without `anon` is not a reopened '
    'boundary.';

revoke all on function app.assert_privilege_invariants() from public;
grant execute on function app.assert_privilege_invariants()
    to service_role;

-- ------------------------------------------------------------
-- The invariants that exist today, each naming the migration that
-- created it. Written as inserts rather than as a hardcoded list inside
-- the function, so the next revoke-migration adds a row in its own
-- commit and nothing here has to be edited.
-- ------------------------------------------------------------
insert into app.privilege_invariants (
    object_kind, object_identity, role_name, privilege,
    source_migration, rationale)
values
    -- 20260903190000: calculation_results is written only by the
    -- trusted server path, through record_calculation_result.
    ('TABLE', 'public.calculation_results', 'anon', 'INSERT',
     '20260903190000',
     'a persisted emissions figure must come from the engine, not from a client'),
    ('TABLE', 'public.calculation_results', 'anon', 'UPDATE',
     '20260903190000', 'calculation_results is append-only'),
    ('TABLE', 'public.calculation_results', 'anon', 'DELETE',
     '20260903190000', 'calculation_results is append-only'),
    ('TABLE', 'public.calculation_results', 'authenticated', 'INSERT',
     '20260903190000',
     'a persisted emissions figure must come from the engine, not from a client'),
    ('TABLE', 'public.calculation_results', 'authenticated', 'UPDATE',
     '20260903190000', 'calculation_results is append-only'),
    ('TABLE', 'public.calculation_results', 'authenticated', 'DELETE',
     '20260903190000', 'calculation_results is append-only'),

    -- 20260903190000: the trusted write RPC is service_role only. A
    -- SECURITY DEFINER function granted to authenticated would hand
    -- every member the exact capability the revoke above removed.
    ('FUNCTION',
     'public.record_calculation_result(uuid,uuid,uuid,text,jsonb,text,text,jsonb,jsonb,text,uuid)',
     'anon', 'EXECUTE',
     '20260903190000', 'the trusted calculation-write channel is service_role only'),
    ('FUNCTION',
     'public.record_calculation_result(uuid,uuid,uuid,text,jsonb,text,text,jsonb,jsonb,text,uuid)',
     'authenticated', 'EXECUTE',
     '20260903190000', 'the trusted calculation-write channel is service_role only'),

    -- 20260903170000: TRUNCATE bypasses RLS entirely, so no API role
    -- may hold it on any table in public -- including tables that do
    -- not exist yet.
    ('ALL_TABLES_IN_SCHEMA', 'public', 'anon', 'TRUNCATE',
     '20260903170000', 'TRUNCATE bypasses row-level security entirely'),
    ('ALL_TABLES_IN_SCHEMA', 'public', 'authenticated', 'TRUNCATE',
     '20260903170000', 'TRUNCATE bypasses row-level security entirely')
on conflict (object_kind, object_identity, role_name, privilege)
do nothing;

-- ------------------------------------------------------------
-- The seven-RPC finding, registered.
--
-- Every SECURITY DEFINER function in `public` is created with the same
-- two lines: `revoke all ... from public` then
-- `grant execute ... to authenticated`. The intended grantee is
-- therefore `authenticated`, and `anon` was never meant to hold
-- EXECUTE on any of them.
--
-- It does, in every freshly built environment, because seed.sql's
-- `grant all on all functions in schema public to anon, ...` runs
-- afterwards. Verified live: six of these return true for
-- has_function_privilege('anon', ..., 'EXECUTE').
--
-- Not presently exploitable -- each function's first act is to check
-- auth.uid(), which is null for anon, so every one of them refuses.
-- Registered anyway, for two reasons. The claim in the release audit
-- that seed.sql "states the final intended posture" was false and
-- should be measurably false rather than argued about. And an
-- unexploitable gap in a defence-in-depth layer is exactly the kind of
-- thing that becomes exploitable when a future function forgets its
-- auth.uid() check.
-- ------------------------------------------------------------
insert into app.privilege_invariants (
    object_kind, object_identity, role_name, privilege,
    source_migration, rationale)
select 'FUNCTION', signature, 'anon', 'EXECUTE', migration,
       'SECURITY DEFINER RPC granted to authenticated only; anon EXECUTE comes from a blanket grant, never from a migration'
from (values
    ('public.accept_organization_invitation(uuid)', '20260828130000'),
    ('public.accept_sharing_grant_invitation(uuid,uuid)', '20260829300000'),
    ('public.create_organization_with_owner(text,text,text[])', '20260828080000'),
    ('public.list_org_members(uuid)', '20260828120000'),
    ('public.record_declaration_filed(uuid,text)', '20260829330000'),
    ('public.record_shared_data_consumption(uuid,uuid,uuid,integer,uuid,text)', '20260829310000'),
    ('public.sharing_counterparty_org_names()', '20260831100000')
) as rpc(signature, migration)
on conflict (object_kind, object_identity, role_name, privilege)
do nothing;

-- And close them here, so this migration leaves the database in the
-- posture it just declared rather than only describing it.
revoke all on function public.accept_organization_invitation(uuid) from anon;
revoke all on function public.accept_sharing_grant_invitation(uuid, uuid) from anon;
revoke all on function public.create_organization_with_owner(text, text, text[]) from anon;
revoke all on function public.list_org_members(uuid) from anon;
revoke all on function public.record_declaration_filed(uuid, text) from anon;
revoke all on function public.record_shared_data_consumption(uuid, uuid, uuid, integer, uuid, text) from anon;
revoke all on function public.sharing_counterparty_org_names() from anon;

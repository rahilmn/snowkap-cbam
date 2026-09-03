-- ============================================================
-- Snowkap CBAM
-- P14 remediation (2026-09-03): a cross-tenant denial of service. Any
-- organisation can permanently prevent another from ever correcting one
-- of its verified emission records.
--
-- REPRODUCED LIVE, one rolled-back transaction, two unrelated
-- organisations with no sharing relationship of any kind:
--
--   -- as a plain MEMBER of the ATTACKER org
--   insert into public.emission_data (
--       installation_id,      -- the attacker's OWN installation
--       entered_by_org_id,    -- the attacker's OWN org
--       ...,
--       version, predecessor_id)
--   values (..., 2, '<the VICTIM org's record id>');
--   -- INSERT 0 1        <- admitted
--
--   -- then, as an ADMIN of the VICTIM org, recording an ordinary
--   -- correction to its own record:
--   insert into public.emission_data (..., version, predecessor_id)
--   values (..., 2, '<its own record id>');
--   -- ERROR: duplicate key value violates unique constraint
--   --        "emission_data_predecessor_id_uq"
--
-- The victim is now permanently unable to supersede that record. There
-- is no product action that clears the squatting row -- it belongs to
-- another organisation, is invisible to the victim, and the victim has
-- no read access to discover why their correction fails. They see a
-- constraint violation naming an index, forever.
--
-- ------------------------------------------------------------
-- WHY IT WAS OPEN
--
-- emission_data_predecessor_id_uq (20260829290000) is GLOBAL:
--
--   create unique index emission_data_predecessor_id_uq
--     on public.emission_data (predecessor_id)
--     where predecessor_id is not null;
--
-- It exists for a real reason -- it stops one record being superseded
-- twice, forking a version lineage into two same-numbered rows, which
-- P7's review found happening. That reason is sound and the index
-- stays.
--
-- What was missing is any constraint on WHOSE record predecessor_id may
-- name. emission_data_insert_own_org checks two things: that
-- entered_by_org_id is one of the caller's orgs, and that the
-- installation belongs to that org. Both correct. Neither looks at
-- predecessor_id, so a globally-unique column was writable with a value
-- belonging to somebody else -- and a global uniqueness constraint on a
-- cross-tenant-writable column is a denial of service by construction.
--
-- Uniqueness constraints are worth a second look generally, for exactly
-- this reason: they are the one kind of constraint where writing YOUR
-- OWN row can make SOMEBODY ELSE'S write fail.
--
-- ------------------------------------------------------------
-- THE FIX
--
-- predecessor_id must name a record in the same organisation as the row
-- claiming it. Added to both the INSERT and UPDATE policies -- UPDATE
-- too, because otherwise the squat is one UPDATE away from being
-- reintroduced on a row that was created legitimately.
--
-- Deliberately org-scoped rather than installation-scoped. A version
-- lineage is per (installation, period) and the application already
-- derives predecessor_id from a query filtered on both
-- (manage-emission-data.ts), so a tighter rule would be redundant with
-- the application's own logic while risking a legitimate refusal in a
-- case nobody has thought of. The security property that matters -- one
-- tenant cannot consume another tenant's slot -- is entirely captured
-- by the org check.
--
-- Null is allowed, as before: a v1 record has no predecessor.
-- ============================================================

-- ------------------------------------------------------------
-- The check has to go through a SECURITY DEFINER helper, not a bare
-- EXISTS.
--
-- The first version of this migration wrote the subquery inline, and
-- every INSERT into emission_data then failed with
-- "infinite recursion detected in policy for relation emission_data"
-- (42P17) -- a policy ON emission_data that reads emission_data
-- re-enters its own policy. Reproduced immediately by this migration's
-- own probe.
--
-- 20260829340000 hit exactly this and solved it exactly this way for
-- declarations_insert_own_org (app.declaration_predecessor_matches).
-- Same shape, same fix, same reasoning about disclosure: this function
-- returns a boolean about a row the caller NAMED, and it answers "is
-- this record in the organisation you are writing as?" -- which the
-- caller either already knows, or learns nothing from, since a false
-- answer is indistinguishable from "no such record". It is not an
-- existence oracle for other tenants' data: the org id it compares
-- against is the caller's own, checked separately by the same policy.
-- ------------------------------------------------------------
create or replace function app.emission_data_predecessor_in_org(
    p_predecessor_id uuid,
    p_org_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.emission_data predecessor
        where predecessor.id = p_predecessor_id
          and predecessor.entered_by_org_id = p_org_id
    );
$$;

comment on function app.emission_data_predecessor_in_org(uuid, uuid) is
    'Does p_predecessor_id name an emission_data record in organisation '
    'p_org_id? SECURITY DEFINER so emission_data''s own INSERT/UPDATE '
    'policies can ask without re-triggering emission_data''s RLS -- a '
    'bare EXISTS there causes real infinite recursion (42P17) on every '
    'write, exactly as 20260829340000 found for declarations. Exists '
    'because emission_data_predecessor_id_uq is a GLOBAL unique index '
    'on a column that was cross-tenant writable, which let any '
    'organisation permanently block another from correcting a verified '
    'record (P14 remediation).';

revoke all on function app.emission_data_predecessor_in_org(uuid, uuid) from public;
grant execute on function app.emission_data_predecessor_in_org(uuid, uuid)
    to authenticated, service_role;

drop policy if exists emission_data_insert_own_org
    on public.emission_data;

create policy emission_data_insert_own_org
    on public.emission_data
    for insert
    to authenticated
    with check (
        entered_by_org_id in (select app.user_org_ids())
        and exists (
            select 1
            from public.installations i
            where i.id = emission_data.installation_id
              and i.org_id = emission_data.entered_by_org_id
        )
        -- 2026-09-03 (P14 remediation): the new clause.
        and (
            predecessor_id is null
            or app.emission_data_predecessor_in_org(
                   predecessor_id, entered_by_org_id)
        )
    );

drop policy if exists emission_data_update_own_org
    on public.emission_data;

create policy emission_data_update_own_org
    on public.emission_data
    for update
    to authenticated
    using (
        entered_by_org_id in (select app.user_org_ids())
    )
    with check (
        entered_by_org_id in (select app.user_org_ids())
        -- Unchanged: every claimed evidence id must resolve to a real
        -- evidence_files row belonging to this record and this org
        -- (20260829480000). Reproduced verbatim.
        and not exists (
            select 1
            from unnest(emission_data.evidence_file_ids) as claimed(evidence_file_id)
            where not exists (
                select 1
                from public.evidence_files ef
                where ef.id = app.try_cast_uuid(claimed.evidence_file_id)
                  and ef.emission_data_id = emission_data.id
                  and ef.org_id = emission_data.entered_by_org_id
            )
        )
        -- 2026-09-03 (P14 remediation): the same predecessor rule as
        -- INSERT, so the squat cannot be reintroduced by an UPDATE.
        and (
            predecessor_id is null
            or app.emission_data_predecessor_in_org(
                   predecessor_id, entered_by_org_id)
        )
    );

comment on index public.emission_data_predecessor_id_uq is
    'One record may be superseded at most once -- prevents a version '
    'lineage forking into two same-numbered rows (P7 review). GLOBAL, '
    'deliberately. Safe only because emission_data_insert_own_org and '
    'emission_data_update_own_org now require predecessor_id to name a '
    'record in the writer''s OWN organisation (20260903240000): before '
    'that, an unrelated org could claim a victim''s record as its own '
    'predecessor and permanently block the victim from ever correcting '
    'it. A globally unique column that any tenant can write is a '
    'cross-tenant denial of service by construction.';

-- ============================================================
-- Snowkap CBAM SME Experience -- S2
-- guidance_dismissals: a per-user, per-org standing preference.
--
-- Guidance items themselves are NEVER persisted (src/domain/guidance/**
-- derives every item fresh, on every read, from authoritative domain
-- state -- shipments, declarations, etc.) -- this table stores only the
-- DISMISSAL FINGERPRINT (item_key, matching GuidanceItem.id exactly),
-- never the item's own content, priority, or reason. "Do not persist
-- unresolved-reason state" (v2.1.1) follows directly from this: nothing
-- here says WHY an item existed, only that a specific user chose not to
-- see a specific item id again while it stays non-REQUIRED.
--
-- No snooze/expiry: v2.1.1 is explicit ("no snooze"). A dismissal is a
-- standing fact until deleted; REQUIRED ignores it unconditionally
-- (src/domain/guidance/dismiss.ts), so "reappearance on priority
-- change" needs no separate mechanism here -- the item is simply
-- re-derived REQUIRED on the next read and the dismissal record,
-- unread by that filter, has no effect.
--
-- Leaf table: no other policy anywhere references guidance_dismissals.
-- ============================================================

create table public.guidance_dismissals (
    id uuid primary key default gen_random_uuid(),

    org_id uuid not null
        references public.organizations(id)
        on delete cascade,

    user_id uuid not null
        references auth.users(id)
        on delete cascade,

    -- Matches GuidanceItem.id exactly (src/domain/guidance/types.ts),
    -- e.g. "I19:<shipment-uuid>" or an aggregate's own
    -- "aggregate:<rule>:<parent-type>:<parent-id>" -- deliberately a
    -- free-text fingerprint, not a foreign key to anything, since the
    -- entity a guidance item is about (a shipment, a declaration...)
    -- is not this table's concern and guidance rules are not
    -- enumerated in the schema.
    item_key text not null
        check (
            length(item_key) > 0
        ),

    dismissed_at timestamptz not null default now(),

    -- Re-dismissing an already-dismissed item is idempotent, not an
    -- error -- the application's own upsert (onConflict) relies on
    -- this constraint rather than a SELECT-then-INSERT race.
    constraint guidance_dismissals_unique_per_user_item
        unique (org_id, user_id, item_key)
);

comment on table public.guidance_dismissals is
    'A user''s standing decision not to see a specific guidance item id '
    'again, while it remains non-REQUIRED. Never the item''s own '
    'content -- only the fingerprint. Snowkap CBAM SME Experience '
    'v2.1.1, S2.';

comment on column public.guidance_dismissals.item_key is
    'Matches GuidanceItem.id exactly (src/domain/guidance/types.ts). '
    'Free text, not a foreign key -- this table has no opinion on what '
    'kind of entity a guidance item is about.';

create index guidance_dismissals_org_user_idx
    on public.guidance_dismissals (org_id, user_id);


-- ------------------------------------------------------------
-- Pin user_id/dismissed_at from every INSERT, never trusted from the
-- client -- same "structurally impossible to forge" posture
-- organization_profiles' own stamp trigger has
-- (20260905150000_sme_organization_profiles.sql).
-- ------------------------------------------------------------

create or replace function app.stamp_guidance_dismissal_actor()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    new.user_id := auth.uid();
    new.dismissed_at := now();

    return new;
end;
$$;

comment on function app.stamp_guidance_dismissal_actor() is
    'BEFORE INSERT: pins user_id/dismissed_at from auth.uid()/the '
    'server clock, never the caller''s claimed value -- '
    '20260905160000_sme_guidance_dismissals.sql.';

create trigger guidance_dismissals_stamp_actor_trg
    before insert
    on public.guidance_dismissals
    for each row
    execute function app.stamp_guidance_dismissal_actor();


-- ------------------------------------------------------------
-- RLS. A dismissal is personal, not org-shared: every policy scopes to
-- BOTH org membership (app.user_org_ids()) AND the caller's own
-- user_id, so even a fellow org member cannot read or clear another
-- member's dismissals. Any member (not just ADMIN+) may dismiss --
-- unlike organization_profiles, this is not a setting with tenant-wide
-- effect, it is one person's own guidance view. DELETE is allowed
-- (un-dismissing is a legitimate "change my mind"); no UPDATE policy
-- -- a dismissal has no mutable field worth updating, and changing
-- item_key would just be a different dismissal (delete + insert).
-- ------------------------------------------------------------

alter table public.guidance_dismissals
    enable row level security;

create policy guidance_dismissals_select_own
    on public.guidance_dismissals
    for select
    to authenticated
    using (
        org_id in (select app.user_org_ids())
        and user_id = auth.uid()
    );

create policy guidance_dismissals_insert_own
    on public.guidance_dismissals
    for insert
    to authenticated
    with check (
        org_id in (select app.user_org_ids())
        and user_id = auth.uid()
    );

create policy guidance_dismissals_delete_own
    on public.guidance_dismissals
    for delete
    to authenticated
    using (
        org_id in (select app.user_org_ids())
        and user_id = auth.uid()
    );

comment on policy guidance_dismissals_select_own on public.guidance_dismissals is
    'Own dismissals only, scoped to orgs the caller belongs to -- '
    'never shared with other org members.';

comment on policy guidance_dismissals_insert_own on public.guidance_dismissals is
    'Any member (not just ADMIN+) may dismiss a guidance item for '
    'themselves -- this is a personal view preference, not a '
    'tenant-wide setting.';

comment on policy guidance_dismissals_delete_own on public.guidance_dismissals is
    'A caller may remove their own dismissal ("un-dismiss"). Cannot '
    'remove another member''s dismissal, even within the same org.';


-- ============================================================
-- END OF MIGRATION
-- ============================================================

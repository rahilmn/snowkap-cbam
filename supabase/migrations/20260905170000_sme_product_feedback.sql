-- ============================================================
-- Snowkap CBAM SME Experience -- S2
-- product_feedback: insert-only, matching audit_events' own
-- "immutability enforced by absence" posture
-- (20260828070000_create_organizations_foundation.sql).
--
-- No UPDATE or DELETE policy exists, or is ever added -- a submitted
-- piece of feedback is a fact about what the submitter saw and felt at
-- that moment; correcting it in place would let it silently drift from
-- what was actually captured.
-- ============================================================

create table public.product_feedback (
    id uuid primary key default gen_random_uuid(),

    org_id uuid not null
        references public.organizations(id)
        on delete cascade,

    user_id uuid not null
        references auth.users(id)
        on delete cascade,

    rating smallint not null
        check (
            rating between 1 and 5
        ),

    comment text,

    -- The route the submitter was on, e.g. "/shipments/<id>" -- plain
    -- text, not validated against a route table, since new routes are
    -- added far more often than this table's schema should need to
    -- change.
    page text not null
        check (
            length(page) > 0
        ),

    -- Optional: which named journey/flow this feedback is about, if
    -- the submitting screen knows one (e.g. "importer-shipment-intake").
    -- Null when the submitting screen has no such concept.
    workflow text,

    -- Free-form structured context the submitting screen chooses to
    -- attach (e.g. {"shipmentId": "...", "declarationStatus": "DRAFT"}).
    -- Never validated against a schema here -- same reasoning as
    -- audit_events.payload: a screen-specific shape that would make
    -- this table a second source of truth for domain state if typed.
    context jsonb not null default '{}'::jsonb,

    -- The deployed commit this feedback was submitted against
    -- (src/application/health/resolve-git-sha.ts's resolveGitSha() --
    -- reused directly by the submitting service, not re-derived here).
    release_sha text not null,

    created_at timestamptz not null default now()
);

comment on table public.product_feedback is
    'Insert-only. A submitter''s rating/comment about a specific page, '
    'captured with enough context (page, workflow, structured context, '
    'release_sha) to reproduce what they saw. Snowkap CBAM SME '
    'Experience v2.1.1, S2.';

comment on column public.product_feedback.release_sha is
    'The deployed commit this feedback was submitted against -- see '
    'src/application/health/resolve-git-sha.ts, reused directly rather '
    'than re-derived.';

create index product_feedback_org_created_idx
    on public.product_feedback (org_id, created_at);


-- ------------------------------------------------------------
-- Pin user_id/created_at from every INSERT, never trusted from the
-- client -- same posture as every other actor/timestamp column in
-- this schema.
-- ------------------------------------------------------------

create or replace function app.stamp_product_feedback_actor()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    new.user_id := auth.uid();
    new.created_at := now();

    return new;
end;
$$;

comment on function app.stamp_product_feedback_actor() is
    'BEFORE INSERT: pins user_id/created_at from auth.uid()/the server '
    'clock, never the caller''s claimed value -- '
    '20260905170000_sme_product_feedback.sql.';

create trigger product_feedback_stamp_actor_trg
    before insert
    on public.product_feedback
    for each row
    execute function app.stamp_product_feedback_actor();


-- ------------------------------------------------------------
-- RLS. INSERT and SELECT, both scoped to org membership AND the
-- caller's own user_id -- a submitter can see their own past
-- submissions (and can confirm what INSERT ... RETURNING actually
-- persisted -- see product-feedback.test.ts's own comment on why this
-- is pinned by a test rather than assumed), but never another org
-- member's. No UPDATE, no DELETE, by design (see this file's own
-- header comment) -- matching audit_events, not organization_profiles.
-- ------------------------------------------------------------

alter table public.product_feedback
    enable row level security;

create policy product_feedback_insert_own_org_as_self
    on public.product_feedback
    for insert
    to authenticated
    with check (
        org_id in (select app.user_org_ids())
        and user_id = auth.uid()
    );

create policy product_feedback_select_own
    on public.product_feedback
    for select
    to authenticated
    using (
        org_id in (select app.user_org_ids())
        and user_id = auth.uid()
    );

comment on policy product_feedback_insert_own_org_as_self on public.product_feedback is
    'Any member may submit feedback for an org they belong to, '
    'attributed to themselves -- never on behalf of another user.';

comment on policy product_feedback_select_own on public.product_feedback is
    'A submitter may read back their own past submissions. Never '
    'another member''s -- product feedback triage is a service-role/ '
    'staff concern, not an in-app feature in this phase.';


-- ============================================================
-- END OF MIGRATION
-- ============================================================

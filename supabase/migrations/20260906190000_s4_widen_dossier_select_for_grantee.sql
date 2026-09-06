-- ============================================================
-- Snowkap CBAM SME Experience -- S4
-- Widen SELECT on emission_data_declaration_context and
-- emission_data_precursors for a sharing-grant grantee.
--
-- Found while wiring context-freezing into determine-from-actual-data.ts
-- (the frozen-at-consumption-time step Slice 1's own migration
-- (20260906180000) anticipated but did not itself enable): the two
-- dossier tables shipped with org-membership-only SELECT policies, so
-- a grantee importer determining a shipment line from a producer's
-- shared emission_data row could never read that record's own declared
-- context or precursors at all -- not a permissions gap in the
-- application layer, a genuine RLS wall with nothing behind this
-- migration's own policies to admit the read.
--
-- Mirrors emission_data_select_own_org's own widened clause exactly
-- (20260829260000): a grantee may read ONLY status=ACTIVE AND
-- verification_status=VERIFIED rows for an installation it holds an
-- ACTIVE sharing_grants row for -- the same fail-closed boundary, for
-- the identical reason (DRAFT/SUPERSEDED/DISCARDED/UNVERIFIED/
-- VERIFICATION_PENDING/REJECTED rows must never be shared).
--
-- ADDED as a new, separate permissive policy per table rather than
-- dropping and redefining emission_data_declaration_context_select_own_org
-- / emission_data_precursors_select_own_org (20260906180000, an
-- already-applied migration, never edited in place per this codebase's
-- convention) -- Postgres ORs multiple permissive policies for the
-- same command together, so this is exactly equivalent to widening the
-- original policy's own USING clause, without touching it.
-- ============================================================

create policy emission_data_declaration_context_select_shared
    on public.emission_data_declaration_context
    for select
    to authenticated
    using (
        exists (
            select 1
            from public.emission_data ed
            where ed.id = emission_data_declaration_context.emission_data_id
              and ed.installation_id in (select app.user_shared_installation_ids())
              and ed.status = 'ACTIVE'
              and ed.verification_status = 'VERIFIED'
        )
    );

comment on policy emission_data_declaration_context_select_shared on public.emission_data_declaration_context is
    'A grantee org''s read of the declared context for a shared '
    'installation''s ACTIVE+VERIFIED emission_data row only -- mirrors '
    'emission_data_select_own_org''s own widened clause (20260829260000). '
    'Read-only: no INSERT/UPDATE/DELETE policy is widened, a grantee '
    'never gains write access to a shared record''s context.';

create policy emission_data_precursors_select_shared
    on public.emission_data_precursors
    for select
    to authenticated
    using (
        exists (
            select 1
            from public.emission_data ed
            where ed.id = emission_data_precursors.emission_data_id
              and ed.installation_id in (select app.user_shared_installation_ids())
              and ed.status = 'ACTIVE'
              and ed.verification_status = 'VERIFIED'
        )
    );

comment on policy emission_data_precursors_select_shared on public.emission_data_precursors is
    'A grantee org''s read of the precursor materials declared on a '
    'shared installation''s ACTIVE+VERIFIED emission_data row only -- '
    'same reasoning as emission_data_declaration_context_select_shared '
    'above. Read-only.';


-- ============================================================
-- END OF MIGRATION
-- ============================================================

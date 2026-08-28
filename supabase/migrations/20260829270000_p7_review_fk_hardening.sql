-- ============================================================
-- Snowkap CBAM
-- P7 mandatory-review fix: FK hardening on installation deletion and
-- emission_data verifier attribution
--
-- Two findings from the mandatory "actual-emissions logic" review
-- required for P7 to close (docs/plans/MASTER_PLAN.md §38's P7
-- contract names this review a Definition-of-Done gate):
--
-- 1. installations_delete_own_org (20260829220000) lets any MEMBER of
--    the owning org hard-DELETE an installation. Both
--    emission_data.installation_id and sharing_grants.installation_id
--    were declared `on delete cascade`, so that single DELETE silently
--    cascaded through to destroy every emission_data row for that
--    installation (VERIFIED or not, ACTIVE or not), every evidence_files
--    row attached to those (via emission_data_id's own cascade,
--    20260829240000), and every sharing_grants row referencing it --
--    directly falsifying two explicit comments elsewhere in this
--    schema: emission_data's "no DELETE policy... never a physical
--    delete" (20260829230000) and sharing_grants' "no DELETE
--    policy... never a delete" (20260829260000). Cascade deletes are
--    an internal referential-integrity action and are NOT subject to
--    the child table's own RLS, so those "no DELETE policy" comments
--    never actually stopped this path -- only a direct DELETE against
--    those tables, which nothing does anyway.
--
--    Fixed by changing both FKs to `on delete restrict`: an
--    installation with any dependent emission_data or sharing_grants
--    row can no longer be deleted at all -- the DELETE now fails with
--    a foreign_key_violation (Postgres error 23503), which
--    removeInstallation (src/application/installations/manage-installations.ts)
--    now surfaces as a real, actionable INSTALLATION_HAS_DEPENDENTS
--    rejection instead of a generic PERSIST_FAILED. Removing an
--    installation that genuinely has no dependents is unaffected.
--
-- 2. emission_data.verifier_user_id (20260829230000) was
--    `on delete set null`. Deleting the verifying user from auth.users
--    (Supabase dashboard, Admin API, or any future account-deletion
--    path) fires an internal UPDATE that nulls verifier_user_id on
--    every row that user ever verified, INCLUDING ACTIVE+VERIFIED
--    ones -- neither BEFORE UPDATE trigger on this table objects
--    (app.prevent_emission_data_fact_change doesn't guard this column
--    by design; app.enforce_emission_data_verification_gate only fires
--    when verification_status itself changes). The row then has no
--    recovery path: it's ACTIVE (so VERIFY/REJECT/SUBMIT_FOR_VERIFICATION
--    are all unreachable per transitionEmissionData's own state
--    machine), it's fact-immutable (so it can't be corrected in
--    place), yet it stays visible in every ACTIVE+VERIFIED listing
--    (listAvailableActualEmissionData never checks verifier_user_id)
--    and keeps being offered in the importer's determination picker,
--    where selecting it always fails
--    (determine-from-actual-data.ts's own DATA_INTEGRITY_ERROR guard,
--    which exists for exactly this state but has no way to fix it).
--    This is also the lone `on delete set null` attribution column
--    added across all of P7 -- created_by_user_id on sharing_grants
--    and uploaded_by_user_id on evidence_files both already use `on
--    delete restrict`, and per master plan §14's account model
--    ("deactivation severs sessions and memberships without deleting
--    audit identity"), restrict is the semantically correct choice for
--    all three, not just two of them.
--
--    Fixed by changing verifier_user_id to `on delete restrict` (a
--    verifying user can no longer be deleted while any row still
--    attributes a verification to them -- deactivation, which is the
--    actual account-lifecycle mechanism per §14, is unaffected since
--    it never touches auth.users itself) and adding a CHECK constraint
--    making "VERIFIED implies a verifier is recorded" a real,
--    permanent database invariant rather than an unenforced assumption
--    three call sites (determine-from-actual-data.ts,
--    ActualEmissionSnapshot's own type, and the application's own
--    verifyEmissionData) all independently relied on.
-- ============================================================


-- ------------------------------------------------------------
-- 1. installations.installation_id FKs: CASCADE -> RESTRICT
-- ------------------------------------------------------------

alter table public.emission_data
    drop constraint emission_data_installation_id_fkey;

alter table public.emission_data
    add constraint emission_data_installation_id_fkey
        foreign key (installation_id)
        references public.installations(id)
        on delete restrict;

alter table public.sharing_grants
    drop constraint sharing_grants_installation_id_fkey;

alter table public.sharing_grants
    add constraint sharing_grants_installation_id_fkey
        foreign key (installation_id)
        references public.installations(id)
        on delete restrict;


-- ------------------------------------------------------------
-- 2. emission_data.verifier_user_id: SET NULL -> RESTRICT, plus a
--    real DB-level "VERIFIED implies a verifier" invariant
-- ------------------------------------------------------------

alter table public.emission_data
    drop constraint emission_data_verifier_user_id_fkey;

alter table public.emission_data
    add constraint emission_data_verifier_user_id_fkey
        foreign key (verifier_user_id)
        references auth.users(id)
        on delete restrict;

alter table public.emission_data
    add constraint emission_data_verified_has_verifier_ck
        check (
            verification_status <> 'VERIFIED'
            or verifier_user_id is not null
        );

comment on constraint emission_data_verified_has_verifier_ck on public.emission_data is
    'A VERIFIED row must always carry a verifier_user_id -- '
    'determine-from-actual-data.ts''s fetchAuthorizedEmissionData relies '
    'on exactly this invariant (a null verifier on a VERIFIED row was '
    'previously reachable via ON DELETE SET NULL on the same column; '
    'see this migration''s header comment). Now enforced at the '
    'database layer, not just assumed by the application.';


-- ============================================================
-- END OF MIGRATION
-- ============================================================

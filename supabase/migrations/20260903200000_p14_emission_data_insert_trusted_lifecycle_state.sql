-- ============================================================
-- Snowkap CBAM
-- P14 (2026-09-03), RELEASE BLOCKER B1: emission_data has no
-- INSERT-time gate, so a plain MEMBER manufactures an
-- operator-attested, verified emissions record in one statement.
--
-- REPRODUCED LIVE against local Postgres as the real `authenticated`
-- role, with a purpose-created MEMBER (memberships.role = 'MEMBER'),
-- inside BEGIN ... ROLLBACK with post-rollback leakage verified 0.
-- Five distinct variants were admitted:
--
--   B1.1  status='ACTIVE', verification_status='VERIFIED',
--         verifier_user_id=<self>,
--         evidence_file_ids='{99999999-...}' naming no evidence_files
--         row at all                                        -> ADMITTED
--   B1.3  the same, but naming ANOTHER user as the verifier -> ADMITTED
--   B1.4  status='ACTIVE' on an unverified record           -> ADMITTED
--   B1.5  phantom evidence ids on a DRAFT                   -> ADMITTED
--   B1.6  rejection_reason pre-set at creation              -> ADMITTED
--
-- B1.3 is worse than the reported case and was found by this probe:
-- the forged row is attributed to a real ADMIN of the organisation who
-- never saw it.
--
-- Two variants were already refused, and are kept in the regression
-- suite so that stays true:
--
--   B1.2  verification_status='VERIFIED' with no verifier
--         -> refused by emission_data_verified_has_verifier_ck
--   B1.7  cross-org entered_by_org_id
--         -> refused by RLS (new row violates row-level security policy)
--
-- ------------------------------------------------------------
-- WHY EVERY EXISTING WALL PASSED IT
--
-- All four triggers on this table are BEFORE UPDATE:
--
--   emission_data_activation_gate_trg      BEFORE UPDATE
--   emission_data_verification_gate_trg    BEFORE UPDATE
--   emission_data_prevent_fact_change_trg  BEFORE UPDATE
--   emission_data_touch_updated_at_trg     BEFORE UPDATE
--
-- Every invariant this table has -- ADMIN+-only verification,
-- verifier_user_id forced to auth.uid(), DRAFT -> ACTIVE requiring
-- VERIFIED plus non-empty evidence, evidence ids having to resolve to
-- real evidence_files rows -- is expressed as a comparison between OLD
-- and NEW. None of them can see an INSERT.
--
-- The INSERT policy (emission_data_insert_own_org, 20260829230000)
-- checks organisation membership and that the installation belongs to
-- that organisation. Both correct, and both about SCOPE. It says
-- nothing about lifecycle state.
--
-- ------------------------------------------------------------
-- WHY THIS IS CROSS-TENANT, NOT JUST AN OWN-ORG PROBLEM
--
-- emission_data_select_own_org admits a shared row on exactly
-- `status = 'ACTIVE' and verification_status = 'VERIFIED'`. That pair
-- IS the trust claim the producer/importer sharing model carries: "an
-- ADMIN of the operating installation verified this against real
-- evidence." A grantee importer reads the forged row as operator-
-- attested verified data, freezes it into an ACTUAL determination, and
-- it flows through record_calculation_result into an immutable
-- filed_snapshot. The P14 review demonstrated exactly that chain
-- reaching FILED.
--
-- ------------------------------------------------------------
-- THE INVARIANT THIS MIGRATION MAKES TRUE
--
--   A record's authority is PRODUCED by the lifecycle. It can never be
--   ASSERTED at creation.
--
-- Every emission_data row created through the API begins where the
-- domain says it begins -- DRAFT, UNVERIFIED, no verifier, no
-- rejection reason, no evidence -- and can only acquire authority by
-- actually walking src/domain/emissions/emission-data-lifecycle.ts's
-- state machine through the gates that already exist:
--
--   SUBMIT_FOR_VERIFICATION -> VERIFY (ADMIN+ only, verifier forced to
--   auth.uid()) -> ACTIVATE (requires VERIFIED and real evidence).
--
-- ------------------------------------------------------------
-- WHY A GATE AND NOT A REVOKE-PLUS-RPC
--
-- 20260903190000 solved the calculation_results forgery by revoking
-- INSERT from the API roles entirely and routing every write through a
-- service_role-only SECURITY DEFINER function. That was right THERE,
-- because a calculation result is machine output: no user should ever
-- write one, so the whole table can move behind a trusted channel.
--
-- It is the wrong shape HERE. A producer's emission data is user
-- input. Members are supposed to create and edit these records; that
-- is the product. Revoking INSERT would mean funnelling ordinary data
-- entry through an RPC that re-implements the create path, for no
-- security gain -- the danger was never that a member creates a
-- record, only that a member creates one already carrying authority
-- it never earned.
--
-- So the boundary is drawn exactly there: members write raw data, the
-- lifecycle confers authority, and the database refuses to let the two
-- be done in one step. This is the same "member can write draft/raw
-- data; the trusted transition confers authority" split, expressed as
-- a gate because the table's legitimate write volume is user input
-- rather than machine output.
--
-- ------------------------------------------------------------
-- SCOPE, STATED HONESTLY
--
-- The gate constrains `anon` and `authenticated` -- the two roles
-- PostgREST can ever run as, and therefore every write a browser or an
-- API key can reach. `service_role` is deliberately NOT constrained,
-- for the same reason 20260903190000 left its direct table grant in
-- place: it is the trusted server path, it never reaches a client
-- bundle (`import "server-only"`, enforced by
-- tests/architecture/layering.test.ts), and integration fixtures need
-- to seed records in terminal states directly. A compromised
-- service-role key is outside this boundary and always was.
--
-- `current_user` is used rather than auth.role(): PostgREST SETs the
-- actual Postgres role from the verified JWT, so current_user is the
-- role the statement really runs as. auth.role() reads a claim.
-- ============================================================

create or replace function app.enforce_emission_data_insert_gate()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
    -- Trusted paths are unconstrained -- see this migration's SCOPE
    -- note. Written as an allowlist of the two API roles rather than a
    -- denylist, so a role added to this database in future is
    -- constrained by default rather than exempt by default.
    if current_user not in ('anon', 'authenticated') then
        return new;
    end if;

    if new.status is distinct from 'DRAFT' then
        raise exception
            'emission_data: a new record is always created as DRAFT. Activation is a lifecycle transition (ACTIVATE), which requires the record to be VERIFIED and to carry real evidence -- it cannot be asserted at creation.'
            using errcode = '42501';
    end if;

    if new.verification_status is distinct from 'UNVERIFIED' then
        raise exception
            'emission_data: a new record is always created UNVERIFIED. Verification is a lifecycle transition (SUBMIT_FOR_VERIFICATION then VERIFY), and VERIFY requires an ADMIN or OWNER of the owning organization -- it cannot be asserted at creation.'
            using errcode = '42501';
    end if;

    -- Both of the above are already implied by the column defaults;
    -- what matters is that supplying a different value is REFUSED
    -- rather than silently rewritten. A silent rewrite would hide a
    -- genuine application bug, and would leave a caller believing they
    -- had created a verified record.

    if new.verifier_user_id is not null then
        raise exception
            'emission_data: verifier_user_id cannot be set at creation. It is written from auth.uid() by the verification gate, in the same statement that transitions verification_status to VERIFIED.'
            using errcode = '42501';
    end if;

    if new.rejection_reason is not null then
        raise exception
            'emission_data: rejection_reason cannot be set at creation. It is only ever written alongside a transition of verification_status to REJECTED.'
            using errcode = '42501';
    end if;

    -- Evidence is attached by uploadEvidenceFile
    -- (src/application/evidence/upload-evidence.ts) AFTER the record
    -- exists, because an evidence_files row has to reference the
    -- emission_data row it belongs to. An INSERT arriving with a
    -- non-empty array is therefore never the application, and the ids
    -- in it cannot have been checked against evidence_files by
    -- anything -- the resolve-the-ids anti-join lives on
    -- emission_data_update_own_org, which an INSERT never touches.
    -- That is exactly what made B1.1's phantom evidence id survive all
    -- the way into a filed declaration.
    if coalesce(array_length(new.evidence_file_ids, 1), 0) <> 0 then
        raise exception
            'emission_data: evidence cannot be attached at creation. Upload the file first (it references this record), then attach it -- that path checks every id against a real evidence_files row.'
            using errcode = '42501';
    end if;

    return new;
end;
$$;

comment on function app.enforce_emission_data_insert_gate() is
    '2026-09-03 (P14, blocker B1). Closes the INSERT side of '
    'emission_data, which had no gate of any kind: all four existing '
    'triggers are BEFORE UPDATE, so every lifecycle invariant this '
    'table has was expressed as an OLD-vs-NEW comparison that an '
    'INSERT simply never reaches. A plain MEMBER could create a row '
    'that was already ACTIVE and VERIFIED, name themselves or any '
    'other user as its verifier, and cite an evidence id naming no '
    'evidence_files row -- and because shared-row visibility keys on '
    'exactly ACTIVE + VERIFIED, a grantee importer then read it as '
    'operator-attested verified data. A record''s authority is now '
    'produced by the lifecycle and can never be asserted at creation. '
    'Constrains anon and authenticated (every role PostgREST can run '
    'as); service_role is the trusted server path and is exempt, '
    'matching 20260903190000.';

-- Idempotent, for the same reason as 20260903210000's trigger: a
-- migration that can be re-applied safely is one fewer way a recovery
-- goes wrong.
drop trigger if exists emission_data_insert_gate_trg on public.emission_data;

create trigger emission_data_insert_gate_trg
    before insert on public.emission_data
    for each row
    execute function app.enforce_emission_data_insert_gate();

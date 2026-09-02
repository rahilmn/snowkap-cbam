-- ============================================================
-- Snowkap CBAM
-- P14 (2026-09-03): "Shared by Unknown organization" after revocation.
--
-- REPRODUCED IN PRODUCTION, not inferred. Sharing grant
-- 942ba281-1033-490f-9bcd-c7bcdfb3c928 (producer org ABC -> importer org
-- SNOWKAP, installation "ABC test plant") was issued 15:11 UTC, accepted
-- 15:18 via the email-bootstrap path, consumed 15:23 to determine
-- shipment line IMP-ACTUAL-001, and revoked 15:28:55 on 2026-09-02. From
-- that moment the importer /emissions "Determinations overview" rendered
--
--     Shared by Unknown organization
--
-- as the attributed source of a frozen ACTUAL determination the importer
-- had already calculated (2 tCO2e) and could file.
--
-- WHY THAT IS A DEFECT AND NOT A PRIVACY FEATURE.
-- src/application/emissions/list-actual-determined-lines.ts resolves the
-- grantor through the SHARING GRANT ROW rather than through emission_data
-- precisely so the label survives revocation -- its own doc comment says
-- so, citing master plan section 31 "history survives revocation". The
-- grant row does survive: sharing_grants_select_grantor_or_grantee admits
-- a grantee own grant rows in any status. What did not survive is the
-- NAME, because 20260831100000 tests status = ACTIVE and an unexpired
-- expires_at on every call. So the intent was implemented in the
-- application and then defeated one step later in SQL. A compliance
-- platform whose entire value proposition is provenance must not print
-- "Unknown organization" as the source of a regulated figure to the very
-- organization that was a party to the grant.
--
-- WHAT THIS MIGRATION CHANGES, AND THE ASYMMETRY IN IT.
--
-- Direction 1 -- the caller is a GRANTEE, asking for the GRANTOR name:
-- ANY status, no expiry test. This is self-disclosure. Only a grantor
-- ADMIN/OWNER can create a grant, only for an installation that grantor
-- owns, and the grantee it names is the org the grantor deliberately
-- chose to share with. Telling that org who shared with it discloses
-- nothing the grantor did not already disclose by sharing, and it is the
-- fact the importer needs to attribute a number it has already frozen.
--
-- Direction 2 -- the caller is a GRANTOR, asking for the GRANTEE name:
-- live-ACTIVE (as before) OR provably accepted. "Provably accepted"
-- means invited_email IS NOT NULL AND grantee_org_id IS NOT NULL: a
-- bootstrap row starts with grantee_org_id NULL, and
-- public.accept_sharing_grant_invitation() is the only path that can
-- populate it (20260829300000 sections 3/3b: the ordinary grantee-accept
-- policy requires grantee_org_id to already be in the caller own orgs,
-- which is never true while it is NULL, and the fact-immutability trigger
-- permits a grantee_org_id change only from NULL). A terminal DIRECT
-- grant is deliberately NOT resolved: INVITED --REVOKE--> REVOKED is
-- indistinguishable from ACTIVE --REVOKE--> REVOKED, so a self-issued,
-- self-revoked sham grant must never name a victim org. That sham-grant
-- shape is exactly the attack 20260829320000 was written to close, and
-- this migration must not re-open it.
--
-- The UI only ever issues bootstrap grants (the producer sharing screen
-- offers invite-by-email alone), so every grant a real producer can
-- create keeps naming its grantee after revocation. The direct-grant
-- limitation is a deliberate, tested boundary, not an oversight.
--
-- THIS PARTIALLY AND DELIBERATELY NARROWS TWO EARLIER HARDENINGS, both
-- of which were right for what they defended and neither of which was
-- defending the name alone:
--   * 20260831120000 section 2 (a lapsed-but-still-ACTIVE grant
--     disclosed indefinitely) and
--   * 20260829390000 sections 1-2 (the grantee-side expiry predicate).
-- Both were about organizations SELECT RLS disclosing the counterparty
-- FULL ROW -- eori_number, cbam_declarant_status, slug, country. That
-- concern stands and that policy is untouched. This function has always
-- returned only (id, name), and still does.
--
-- IT ALSO CLOSES THE HOLE UNDER DIRECTION 2 OWN PREMISE. The
-- "only accept_sharing_grant_invitation() can produce that shape" claim
-- was, until now, enforced only by an RLS INSERT policy
-- (20260829300000 sharing_grants_insert_own_org XOR clause) -- and RLS
-- is bypassed by service_role, by SECURITY DEFINER contexts, by seeds and
-- by migrations. sharing_grants_grantee_or_invited_email_ck is an OR
-- (at least one), not an XOR. So the invariant the disclosure rule
-- depends on was one service-role INSERT away from being false. A BEFORE
-- INSERT trigger now enforces it in the engine, where RLS cannot be
-- stepped around. It is INSERT-only on purpose: an accepted bootstrap row
-- legitimately carries BOTH columns afterwards, and that is the proof.
-- ============================================================

create or replace function app.enforce_sharing_grant_insert_shape()
returns trigger
language plpgsql
as $$
begin
    -- Exactly one of the two grantee identifiers at INSERT time:
    -- a DIRECT grant names the org, a BOOTSTRAP grant names the email.
    -- Never both (that shape is the accepted-bootstrap proof, and must
    -- only ever be reachable through acceptance) and never neither
    -- (already covered by sharing_grants_grantee_or_invited_email_ck,
    -- restated here so this trigger is a complete statement of the rule).
    if (new.grantee_org_id is null) = (new.invited_email is null) then
        raise exception
            'A sharing grant must be inserted with exactly one of grantee_org_id (direct) or invited_email (bootstrap), never both and never neither.'
            using errcode = '23514';
    end if;

    return new;
end;
$$;

comment on function app.enforce_sharing_grant_insert_shape() is
    '2026-09-03 (P14). Enforces, in the engine rather than in RLS, that a '
    'sharing_grants row is INSERTed with exactly one of grantee_org_id or '
    'invited_email. public.sharing_counterparty_org_names() treats the '
    'combination (invited_email is not null AND grantee_org_id is not '
    'null) as proof that accept_sharing_grant_invitation() ran, because a '
    'bootstrap row starts with grantee_org_id NULL and only that RPC can '
    'resolve it. Before this trigger that proof rested on an RLS INSERT '
    'policy alone, which service_role, SECURITY DEFINER contexts, seeds '
    'and migrations all bypass -- and the table CHECK is an OR, not an '
    'XOR. INSERT-only by design: after acceptance a row legitimately '
    'carries both columns.';

drop trigger if exists sharing_grants_enforce_insert_shape on public.sharing_grants;

create trigger sharing_grants_enforce_insert_shape
    before insert on public.sharing_grants
    for each row
    execute function app.enforce_sharing_grant_insert_shape();

create or replace function public.sharing_counterparty_org_names()
returns table (
    id uuid,
    name text
)
language sql
stable
security definer
set search_path = public
as $$
    select distinct o.id, o.name
    from public.organizations o
    where o.id in (
        -- Direction 1: orgs that granted the caller access.
        --
        -- ANY status, no expiry test. A frozen ActualEmissionSnapshot
        -- outlives the grant that produced it by design
        -- (src/domain/sharing/grant-lifecycle.ts: revocation ends FUTURE
        -- reads only), so its provenance label must outlive the grant
        -- too. Naming the grantor to the org it deliberately shared with
        -- is self-disclosure; see this migration header.
        select sg.grantor_org_id
        from public.sharing_grants sg
        where sg.grantee_org_id in (select app.user_org_ids())

        union

        -- Direction 2: orgs the caller granted access to -- live, or
        -- provably accepted through the bootstrap path.
        --
        -- A terminal DIRECT grant is deliberately excluded: it carries no
        -- acceptance proof, and a self-issued, self-revoked sham grant
        -- naming a victim org must disclose nothing (20260829320000).
        select sg.grantee_org_id
        from public.sharing_grants sg
        where sg.grantor_org_id in (select app.user_org_ids())
          and sg.grantee_org_id is not null
          and (
              (
                  sg.status = 'ACTIVE'
                  and (sg.expires_at is null or sg.expires_at > now())
              )
              or (
                  sg.invited_email is not null
                  and sg.status in ('ACTIVE', 'REVOKED', 'EXPIRED')
              )
          )
    );
$$;

comment on function public.sharing_counterparty_org_names() is
    '2026-09-03 (P14, supersedes the 2026-08-31 body). Returns ONLY the id '
    'and name of organizations the caller has a genuine sharing-grant '
    'relationship with. A GRANTEE resolves its GRANTOR name for a grant '
    'of any status, including REVOKED and EXPIRED, because a frozen '
    'determination outlives the grant and must stay attributable -- and '
    'because naming the grantor to the org it chose to share with is '
    'self-disclosure. A GRANTOR resolves its GRANTEE name only for a '
    'live ACTIVE grant or one provably accepted via the bootstrap path '
    '(invited_email and grantee_org_id both set, a shape only '
    'accept_sharing_grant_invitation() can produce and which '
    'app.enforce_sharing_grant_insert_shape() now guarantees cannot be '
    'minted at INSERT); a terminal DIRECT grant carries no acceptance '
    'proof and is not resolved, so a self-issued sham grant discloses '
    'nothing. Never returns any other column: organizations SELECT RLS is '
    'deliberately NOT widened, so eori_number, cbam_declarant_status, '
    'slug and country remain undisclosed.';

revoke all on function public.sharing_counterparty_org_names() from public;
grant execute on function public.sharing_counterparty_org_names() to authenticated;
grant execute on function public.sharing_counterparty_org_names() to service_role;

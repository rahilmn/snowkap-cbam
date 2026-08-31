-- ============================================================
-- Snowkap CBAM
-- P13 final adversarial security review -- three confirmed findings,
-- each independently reproduced against the live policy definitions
-- before being fixed here.
--
-- ------------------------------------------------------------
-- FINDING 1 (HIGH) -- cross-tenant disclosure via a self-minted grant.
--
-- `sharing_grants_insert_own_org`'s WITH CHECK constrains the grantor,
-- the installation, and the grantee/email pairing -- but NOT `status`.
-- Meanwhile `organizations_select_via_own_issued_sharing_grant`
-- (20260829320000) grants SELECT on an organization row to anyone who
-- has issued that org an ACTIVE grant.
--
-- Chained: an ADMIN/OWNER of any org can INSERT a grant naming ANY
-- victim org as `grantee_org_id` with `status = 'ACTIVE'` -- no
-- acceptance by the victim, no relationship of any kind -- and then read
-- the victim's FULL organizations row: name, slug, country,
-- `eori_number`, and `cbam_declarant_status`. The victim is never
-- consulted and sees nothing.
--
-- Fix: the INSERT policy now requires `status = 'INVITED'`. A grant must
-- be *accepted* to become ACTIVE, which is what
-- `accept_sharing_grant_invitation()` / `acceptSharingGrant` already do
-- via their own INVITED-gated compare-and-swap. Verified safe for the
-- application: `issueSharingGrant`
-- (src/application/sharing/manage-sharing-grants.ts:291-306) never sets
-- `status` at all -- it relies on the column default, which is already
-- 'INVITED' -- so no legitimate flow changes.
--
-- ------------------------------------------------------------
-- FINDING 2 (MEDIUM) -- the same disclosure policy ignores expiry.
--
-- `organizations_select_via_own_issued_sharing_grant` tests
-- `sg.status = 'ACTIVE'` but omits the `expires_at` predicate that every
-- sibling sharing path applies (compare
-- `app.user_shared_installation_ids()`, which tests
-- `expires_at is null or expires_at > now()`). Because nothing
-- automatically flips a lapsed grant out of ACTIVE -- there is no expiry
-- job -- a grant that expired arbitrarily long ago keeps disclosing the
-- grantee org's full row to the grantor indefinitely.
--
-- Fix: apply the same expiry predicate the rest of the schema uses.
--
-- ------------------------------------------------------------
-- FINDING 3 (HIGH) -- non-finite numerics poison the period total.
--
-- `calculation_results` carries exactly two CHECK constraints
-- (`liability_currency`, `quantity_unit`) and NONE on its numeric
-- columns, and the table has no trigger. A member can therefore INSERT a
-- client-forged row -- bypassing the entire determination-forgery
-- trigger series, which guards `shipment_lines`, not this table -- whose
-- `embedded_emissions_tco2e` is 'NaN'. It then flows through
-- `list-period-shipment-lines.ts`'s unchecked
-- `as DecimalString` cast into `build-period-summary.ts`'s `.plus()`,
-- making the whole reporting period's total NaN.
--
-- Note these columns are `text`, not `numeric` -- this codebase carries
-- regulated figures as DecimalString so arbitrary precision survives the
-- round trip. So the guard is a canonical-FORM regex, reusing the exact
-- pattern 20260829440000 already applies to shipment_lines, not a
-- numeric range. Constrains form only, never magnitude: inventing an
-- upper bound on an emissions figure would be exactly the kind of
-- unsourced regulatory judgement CLAUDE.md forbids.
-- ============================================================

-- ------------------------------------------------------------
-- 1. A grant may only be CREATED as INVITED.
-- ------------------------------------------------------------

drop policy if exists sharing_grants_insert_own_org on public.sharing_grants;

create policy sharing_grants_insert_own_org
    on public.sharing_grants
    for insert
    to authenticated
    with check (
        app.user_is_admin_or_owner_of(grantor_org_id)
        and exists (
            select 1
            from public.installations i
            where i.id = sharing_grants.installation_id
              and i.org_id = sharing_grants.grantor_org_id
        )
        and (
            (
                grantee_org_id is not null
                and invited_email is null
                and app.organization_exists(grantee_org_id)
            )
            or (
                grantee_org_id is null
                and invited_email is not null
            )
        )
        -- NEW: a grant is born INVITED and becomes ACTIVE only through
        -- acceptance. Without this, an ACTIVE grant could be minted
        -- naming any org as grantee, which the organizations SELECT
        -- policy below then treats as a real relationship.
        and status = 'INVITED'
    );

comment on policy sharing_grants_insert_own_org on public.sharing_grants is
    '2026-08-31 (P13 final adversarial review): now also requires '
    'status = ''INVITED'' on insert. Previously unconstrained, which let '
    'an ADMIN/OWNER mint an ACTIVE grant naming any victim org as '
    'grantee and thereby read that org''s full row (eori_number, '
    'cbam_declarant_status, slug, country) via '
    'organizations_select_via_own_issued_sharing_grant, with no '
    'acceptance and no notice to the victim. issueSharingGrant never '
    'sets status (it relies on the INVITED column default), so no '
    'legitimate flow is affected.';

-- ------------------------------------------------------------
-- 2. An EXPIRED grant must stop disclosing the counterparty.
-- ------------------------------------------------------------

drop policy if exists organizations_select_via_own_issued_sharing_grant on public.organizations;

create policy organizations_select_via_own_issued_sharing_grant
    on public.organizations
    for select
    to authenticated
    using (
        exists (
            select 1
            from public.sharing_grants sg
            where sg.grantee_org_id = organizations.id
              and sg.grantor_org_id in (select app.user_org_ids())
              and sg.status = 'ACTIVE'
              -- NEW: the same expiry predicate every sibling sharing
              -- path already applies (cf. app.user_shared_installation_ids).
              and (sg.expires_at is null or sg.expires_at > now())
        )
    );

comment on policy organizations_select_via_own_issued_sharing_grant on public.organizations is
    '2026-08-31 (P13 final adversarial review): now also tests expires_at, '
    'matching app.user_shared_installation_ids(). Previously a grant that '
    'had lapsed by expires_at -- but whose status is still ACTIVE, since '
    'no expiry job exists -- kept disclosing the grantee org''s full row '
    'to the grantor indefinitely.';

-- ------------------------------------------------------------
-- 3. No non-finite numerics in calculation_results.
-- ------------------------------------------------------------

alter table public.calculation_results
    drop constraint if exists calculation_results_numeric_format_ck;

-- These columns are `text`, not `numeric`: this codebase carries every
-- regulated figure as a DecimalString (src/domain/shared/decimal.ts, and
-- ADR-0008) so arbitrary precision survives the round trip. The right
-- guard is therefore a canonical-format regex, not a numeric range --
-- and one already exists as precedent:
-- 20260829440000_p11_review_shipment_lines_numeric_format_ck.sql applies
-- `~ '^-?[0-9]+(\.[0-9]+)?$'` to shipment_lines' own quantity columns.
-- Reusing that exact pattern here rather than inventing a second dialect.
--
-- It rejects 'NaN', 'Infinity', '-Infinity', '0x10', '1e5' and empty
-- strings -- every shape the review demonstrated could be forged into
-- this table -- while accepting the canonical decimal strings the
-- calculation engine actually writes.
alter table public.calculation_results
    add constraint calculation_results_numeric_format_ck
    check (
        quantity ~ '^-?[0-9]+(\.[0-9]+)?$'
        and embedded_emissions_tco2e ~ '^-?[0-9]+(\.[0-9]+)?$'
        and (certificates_due is null or certificates_due ~ '^-?[0-9]+(\.[0-9]+)?$')
        and (liability_amount is null or liability_amount ~ '^-?[0-9]+(\.[0-9]+)?$')
    );

comment on constraint calculation_results_numeric_format_ck on public.calculation_results is
    '2026-08-31 (P13 final adversarial review): pins every DecimalString '
    'numeric column to canonical decimal form. calculation_results '
    'previously had CHECKs only on liability_currency and quantity_unit '
    'and no trigger, so a client-forged row with '
    'embedded_emissions_tco2e = ''NaN'' -- reachable because the '
    'determination-forgery trigger series guards shipment_lines, not this '
    'table -- propagated through the period summary''s Decimal .plus() '
    'and made the whole period total NaN. Same regex as '
    '20260829440000''s shipment_lines constraint, deliberately reused '
    'rather than inventing a second dialect. Constrains FORM only, never '
    'magnitude: inventing an upper bound on an emissions figure would be '
    'an unsourced regulatory judgement.';

-- ============================================================
-- Snowkap CBAM
-- P9 fix: declarations_insert_own_org caused infinite recursion (42P17)
-- on EVERY insert into public.declarations
--
-- What broke:
--   20260829330000's declarations_insert_own_org validates an
--   amendment's predecessor (supersedes_declaration_id must name a
--   declaration in the SAME org and the SAME reporting period) with a
--   raw `exists (select 1 from public.declarations prior ...)` written
--   directly into the policy's own WITH CHECK. Postgres refuses to
--   re-enter row-level-security expansion for a relation it is already
--   expanding, so evaluating that subquery while evaluating a policy ON
--   declarations raises:
--
--     infinite recursion detected in policy for relation "declarations"
--     (SQLSTATE 42P17)
--
--   Not only for amendments -- for EVERY insert. The subquery sits
--   inside an OR whose left branch (supersedes_declaration_id is null)
--   short-circuits at runtime for an original, but the policy expression
--   is still expanded against declarations when the statement is
--   planned, so a plain original DRAFT fails exactly as hard as an
--   amendment does. The table was completely unwritable as applied.
--
-- How it was found, and why that matters more than the fix:
--   Live, on the first INSERT tests/integration/declarations-isolation.test.ts
--   attempted -- not by reading the SQL. 20260829330000's own comment on
--   that policy argued, in detail and with confidence, that a raw EXISTS
--   was safe *here* specifically because declarations' SELECT policy
--   reads only memberships (via app.user_org_ids()) and never
--   declarations, so "there is no cycle to recurse on." That argument is
--   wrong: the cycle does not have to close through a second table.
--   Re-entering the SAME relation is itself the condition Postgres
--   rejects, which is precisely what app.user_is_admin_or_owner_of()
--   already existed to work around for memberships querying memberships
--   (20260828110000's header comment, found the same way -- live, 42P17,
--   after a first draft that looked correct).
--
--   That wrong comment is deliberately left in 20260829330000 rather
--   than rewritten, with a pointer to this migration. It is the third
--   42P17 in this schema (memberships 20260828110000; sharing_grants /
--   installations 20260829300000) and the second one a careful static
--   argument actively talked itself into. The standing lesson this
--   codebase keeps re-learning is worth more in the record than a clean
--   file: an RLS policy that reads any table is not proven by reasoning
--   about it, only by issuing the statement.
--
-- The fix:
--   app.declaration_predecessor_matches() -- a SECURITY DEFINER helper
--   that reads declarations as the function owner, bypassing that
--   table's RLS entirely instead of re-triggering it. Exactly the shape,
--   and for exactly the reason, of app.user_is_admin_or_owner_of()
--   (20260828110000) and
--   app.installation_has_pending_sharing_grant_invitation()
--   (20260829300000), whose own comment already named this as the fix
--   "this codebase already uses everywhere a policy needs to read a
--   DIFFERENT RLS-protected table without risking exactly this kind of
--   cross-table cycle" -- the only thing new here is that the table
--   being read is the policy's own.
--
--   Reading rows the caller cannot see leaks nothing. The helper returns
--   a single boolean about a predecessor the CALLER named, and only ever
--   returns true when that predecessor is in the same org as the row
--   being inserted -- an org the same policy independently pins to one
--   the caller is ADMIN+ of (app.user_is_admin_or_owner_of(org_id),
--   evaluated in the same WITH CHECK). A predecessor id belonging to
--   another tenant yields false, indistinguishable from one that does
--   not exist at all.
--
--   declarations_insert_own_org is redefined via drop policy + create
--   policy -- the established precedent for redefining an
--   already-applied policy (20260829260000's header comment lists the
--   prior instances: shipments_update_own_org_not_terminal in
--   20260829090000, calculation_results_insert_own_org_as_self in
--   20260829200000). Every other clause of the policy is carried over
--   unchanged; only the predecessor check's mechanism changes, never
--   what it admits.
--
-- Scope note: this migration touches ONLY the INSERT policy and adds one
-- helper. declarations_select_own_org and
-- declarations_update_own_org_pre_filing are untouched, and neither
-- reads declarations, so neither can hit this -- the "exactly ONE update
-- policy, on purpose" composition argument in 20260829330000's header
-- comment is unaffected and still holds.
-- ============================================================


-- ============================================================
-- 1. app.declaration_predecessor_matches()
-- ============================================================

create or replace function app.declaration_predecessor_matches(
    p_predecessor_id uuid,
    p_org_id uuid,
    p_reporting_period_kind text,
    p_reporting_period_year integer,
    p_reporting_period_quarter smallint
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.declarations prior
        where prior.id = p_predecessor_id
          and prior.org_id = p_org_id
          and prior.reporting_period_kind = p_reporting_period_kind
          and prior.reporting_period_year = p_reporting_period_year
          and prior.reporting_period_quarter
              is not distinct from p_reporting_period_quarter
    );
$$;

comment on function app.declaration_predecessor_matches(uuid, uuid, text, integer, smallint) is
    'Does p_predecessor_id name a declaration in the same organization '
    'AND the same reporting period as the row being inserted? SECURITY '
    'DEFINER so declarations_insert_own_org can ask this without '
    're-triggering declarations'' own RLS -- a raw EXISTS there caused '
    'real infinite recursion (42P17) on every INSERT into the table, '
    'reproduced live by tests/integration/declarations-isolation.test.ts. '
    'See this migration''s header comment for why reading rows the '
    'caller cannot see discloses nothing here.';

revoke all on function app.declaration_predecessor_matches(uuid, uuid, text, integer, smallint) from public;
grant execute on function app.declaration_predecessor_matches(uuid, uuid, text, integer, smallint) to authenticated;


-- ============================================================
-- 2. declarations_insert_own_org: same rules, non-recursive mechanism
-- ============================================================

drop policy declarations_insert_own_org on public.declarations;

create policy declarations_insert_own_org
    on public.declarations
    for insert
    to authenticated
    with check (
        app.user_is_admin_or_owner_of(org_id)
        and created_by_user_id = auth.uid()
        and status = 'DRAFT'
        and filed_snapshot is null
        and filed_reference is null
        and filed_at is null
        and (
            supersedes_declaration_id is null
            or app.declaration_predecessor_matches(
                supersedes_declaration_id,
                org_id,
                reporting_period_kind,
                reporting_period_year,
                reporting_period_quarter
            )
        )
    );

comment on policy declarations_insert_own_org on public.declarations is
    'ADMIN+ of the row''s own org, inserting a DRAFT as themselves, with '
    'no filing facts pre-populated (blocking FILED_RECORDED on UPDATE is '
    'worthless if a row can be born filed -- see 20260829330000''s header '
    'comment). An amendment''s supersedes_declaration_id must name a '
    'declaration in the same org and period, checked through '
    'app.declaration_predecessor_matches() rather than a raw EXISTS: the '
    'raw form raised 42P17 on every insert into this table '
    '(20260829340000).';


-- ============================================================
-- END OF MIGRATION
-- ============================================================

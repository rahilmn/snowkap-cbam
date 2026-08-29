# Support access runbook

Master plan §13 states this product's posture plainly: **"No cross-org
superadmin surface in-product; operational support access via an
audited runbook (§41)."** §41 lists "support-access runbook shape" as
an open owner decision needed by P11. No such runbook has existed until
this document. This is a first, honest pass at that shape: it describes
the access path that actually exists today (there is no audited
in-product tool — direct, credentialed database access is the only
path), names that plainly as an accepted-for-now gap rather than
dressing it up, and sketches — clearly separated, clearly not built —
what a proper audited tool would need.

## What's true today

**There is no in-product, audited support-access surface.** No
cross-org admin screen, no impersonation feature, no "view as org X"
tool exists anywhere in `app/`. The tenancy model (`docs/architecture/DOMAIN_MODEL.md`,
ARCHITECTURE.md's "Application service conventions") is built entirely
around a member of an org acting within their own org's `OrgContext`,
enforced by two walls (application `OrgContext` checks + Postgres RLS,
per master plan §13) — there is no third path through product code
that lets anyone see another org's data on purpose.

That means the only two ways anyone can see cross-org data today are
both **outside** the product, not features of it:

1. **The `SUPABASE_SERVICE_ROLE_KEY`.** In this codebase's own code,
   this key reaches exactly two files:
   `src/infrastructure/supabase/client.ts` (the protected,
   general-purpose service-role client used by the regulatory adapter
   and the `scripts/regulatory/*.py` pipeline — ADR-0005) and
   `src/infrastructure/supabase/admin-client.ts` (narrow — Auth admin
   API, currently just `inviteUserByEmail`). **Neither of these is a
   support tool** — they're product/pipeline code paths with a fixed,
   narrow job, not something a person invokes to go look at a
   customer's data. The service-role key becomes a support-access path
   only if someone takes that key and uses it *outside* this
   application — e.g., pasting it into the Supabase SQL editor's
   service-role context, or a personal script — which is possible for
   anyone who holds the key but is not a feature this codebase
   provides or governs.
2. **Direct database access via the Supabase project dashboard or
   CLI** — the Table Editor, the SQL Editor, or `psql`/`supabase db`
   against the project's Postgres connection (using
   `SUPABASE_DB_PASSWORD` or a dashboard login with sufficient
   project role). This is unrestricted by this codebase's RLS
   policies by construction — dashboard/CLI access to the underlying
   Postgres instance sits below the RLS-enforcing Data API entirely.

**So, plainly: any genuine support need today — "why does org X's
shipment Y show this result," "org Z says their invitation never
arrived," anything requiring a look at another org's actual data —
requires a person who already holds Supabase project credentials
(dashboard access or `SUPABASE_DB_PASSWORD`) to go look directly.**
This document does not grant anyone new access; it only describes how
to use access someone already has, responsibly, until a real tool
exists.

**Why this is a real gap, named on purpose, not a defect to silently
work around:**

- It is **inherently high-trust**: whoever holds these credentials can
  read or, via the SQL editor, write any org's data — there is no
  scoping to "just this one case."
- It is **hard to audit**: nothing in this codebase's `audit_events`
  table (ARCHITECTURE.md's "Auditability" section, the append-only
  table with no UPDATE/DELETE policy) is written for a dashboard query,
  a `psql` session, or a service-role script run outside the app. The
  full `event_type` catalog in ARCHITECTURE.md has no "support access"
  entry, because nothing in-product generates one — a support look via
  this path leaves no trace in the one place this product's own §21
  auditability chain looks. Supabase's own dashboard/database logs are
  the only record, and they live outside this repo and outside
  anything the product's audit screens (`app/(importer)/audit/`,
  `app/(producer)/activity/`) can show a user.

This is accepted for now because master plan §13 says so explicitly
("operational support access via an audited runbook") and §41 defers
the runbook's actual shape to P11 — this document. It is not accepted
forever: the design note below is what closes it, once prioritized.

## Today's procedure, for a real support case

This section is the actual, honest runbook for someone who already
holds Supabase project credentials and has a genuine support case to
investigate. It does not create new access; it constrains how existing
access is used.

1. **Confirm you actually need cross-org/database-level access.**
   Anything answerable from a user's own account, their org's own audit
   trail, or the regulatory Resolution Explorer doesn't need this path
   at all — use those first.
2. **Prefer read-only.** Use the Table Editor or a `SELECT`-only SQL
   Editor query wherever possible. Do not use the service-role
   key/SQL editor to *write* on a customer's behalf unless there is no
   other way to resolve the case — a direct write bypasses every
   invariant this codebase's application layer and domain functions
   enforce (lifecycle transitions in `src/domain/shipments/lifecycle.ts`,
   invariant checks, audit-event emission) and, per the gap above,
   leaves **no `audit_events` row** — the change will look, to this
   product's own auditability chain, like it never happened. If a write
   is genuinely unavoidable, treat it as an incident, not a routine
   support action: it needs the strongest manual documentation of
   anything on this list.
3. **Scope the query as narrowly as the case allows** — the specific
   org, the specific row, not a broad scan. Nothing enforces this
   automatically today; it's a discipline, not a control.
4. **Record it manually, outside this repo**, in whatever
   ticket/support-tracking system the team actually uses (not named
   here — this repo doesn't contain or govern one): who looked, when,
   which org(s), why, what was viewed or changed, and the outcome. This
   manual record is the *only* audit trail a support access leaves
   today — treat it as mandatory, not optional, precisely because nothing
   automatic backs it up.
5. **Nothing to revoke afterward.** This isn't a temporary grant — it's
   standing credential access someone already had before and after the
   case. If credentials were shared with someone who doesn't normally
   hold them (e.g., temporarily handed off via a password manager
   entry) to handle one case, that sharing should be undone once the
   case is closed; the underlying Supabase credentials themselves are
   out of scope for rotation here (see `SECRET_ROTATION.md`) unless the
   case was itself a security incident.

## Forward-looking design note: a proper audited support-access tool

**Nothing below this line is built.** It's a design sketch for what
closes the gap above, written so a future P11 (or later) contract has
a concrete starting point instead of a blank page — not a commitment
about when it lands. Deliberately kept separate from the "today"
sections above so the two are never confused.

A real audited support-access tool would need to be:

- **Time-boxed.** A grant expires automatically (minutes-to-hours, not
  standing access) rather than relying on a person remembering to stop
  looking.
- **Narrow to the specific case.** Scoped to one org — ideally one
  aggregate (one shipment, one org's emission data) — and read-only by
  default, mirroring the two-wall model (`OrgContext` + RLS) the rest
  of this product already uses for cross-org access, rather than the
  current all-or-nothing service-role bypass. A write, if ever needed,
  should route through the same application services and domain
  invariants product code uses — never a raw SQL mutation — so it still
  produces a normal, valid `audit_events` row and respects lifecycle
  rules (e.g., a LOCKED shipment stays immutable even for support).
- **Justified and, for anything beyond read, approved.** A reason
  captured at grant time; a write-capable grant reviewed by someone
  other than the requester.
- **Self-auditing.** Every access itself generates an
  `audit_events`-shaped row (or a dedicated `support_access_events`
  table with the same append-only, no-UPDATE/DELETE-policy pattern
  ARCHITECTURE.md's "Auditability" section already establishes) —
  `{id, org_id, requested_by, reason, scope, started_at, expires_at,
  actor}` at minimum — so a support access is finally visible in the
  same place every other "why did this happen" chain in this product
  already lives, closing exactly the blind spot named above.
- **Built on the grant primitive this codebase already has**, not a
  new mechanism from scratch. Master plan §9's `SharingGrant`
  (grantor/grantee, scope, time-boxed, revocable, audited,
  `security definer`-backed RLS extension via
  `app.user_shared_installation_ids()`) is structurally the same shape
  a support-access grant needs — narrow, time-boxed, read-first,
  revocable, audited — except issued to an internal operator instead of
  another org. Extending that model (or a sibling table following the
  same pattern) is very likely cheaper and more consistent than
  inventing a parallel access-control system, and worth evaluating
  first when this is actually scoped.

None of this is scheduled. It is recorded here so the next time
someone picks up "support-access runbook shape" from §41, the starting
point is a concrete design, not a blank page — and so nobody mistakes
the procedure above for that tool already existing.

## Related documents

- `docs/plans/MASTER_PLAN.md` §13 (tenancy/security posture), §9
  (sharing-grant model this design note builds on), §41 (the open
  decision this document is a first pass at).
- `docs/architecture/ARCHITECTURE.md` — "Auditability" section (the
  `audit_events` schema, catalog, and immutability guarantees this
  gap sits outside of today).
- `docs/adr/ADR-0005-protected-regulatory-subsystem.md` — why
  `src/infrastructure/supabase/client.ts` is protected and narrow.
- `SECRET_ROTATION.md` (this directory) — rotating the credentials
  this document's "today" procedure depends on.

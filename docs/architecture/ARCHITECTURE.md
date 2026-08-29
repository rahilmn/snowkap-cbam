# Architecture

This document describes the layered architecture Snowkap CBAM is built
on: what each layer owns, the dependency-direction rules the codebase
enforces mechanically, and the conventions new code follows. It is the
stack-agnostic half of the picture; product screens, database schema,
and the phase-by-phase build order live in
[`docs/plans/MASTER_PLAN.md`](../plans/MASTER_PLAN.md) and
[`DOMAIN_MODEL.md`](./DOMAIN_MODEL.md).

## Layers

```
UI  ->  Application  ->  Domain  <-  Infrastructure adapters
```

- **Domain** (`src/domain/`) — pure business logic and types. No I/O, no
  framework, no database client. Depends on nothing outside itself.
- **Application** (`src/application/`) — use-case orchestration: fetch
  through a port, hand data to the domain, return the domain's result.
  Depends only on domain types and port *interfaces* (not concrete
  adapters).
- **Infrastructure** (`src/infrastructure/`) — concrete adapters
  (Supabase, environment/config, storage, background jobs) that
  implement the ports application code depends on. May depend on
  anything.
- **UI** (`app/`, from Phase 2 onward) — Next.js routes, React Server
  Components, server actions. Calls application services; never talks
  to infrastructure directly.

This is the same shape the regulatory subsystem already uses —
`resolveActiveDefaultValue` (application) calls a `RegulatoryRepository`
port, whose only implementation today is `SupabaseRegulatoryRepository`
(infrastructure), which in turn feeds the pure `resolveDefaultValue`
resolver (domain). Every new product module follows this same shape.

## Why folders, not packages

The target architecture keeps domain/application/infrastructure as
folders inside one package rather than splitting them into a
pnpm-workspace with separate `packages/*` — at least for now. A
workspace split would force rewriting every relative import inside the
**protected** regulatory files (`src/domain/regulatory/`,
`src/infrastructure/regulatory/`) for zero functional gain, while there
is exactly one consumer of those imports (tests) and no application yet
to justify the extra boundary. What actually protects the layering is
not a package boundary but:

1. an executable **layering test** (below) that fails the build on a
   forbidden import;
2. the regulatory-verification gate (`pnpm regulatory:verify`);
3. the golden/unit test suites;
4. this document, plus the protected-zone policy in `CLAUDE.md`.

One standing rule keeps a future workspace split mechanical if it ever
becomes worth doing: no `tsconfig.json` path aliases are used anywhere
(imports are always relative). When that day comes, the move is a
`git mv` of folders into `packages/*/src`, not a rewrite.

Relative imports are extension-less (`from "./types"`, not
`from "./types.js"`) — a Phase 2 correction from the original NodeNext
convention, after Turbopack (Next.js's bundler) proved unable to
resolve `.js`-suffixed specifiers to their `.ts`/`.tsx` source files.
See [`ADR-0014`](../adr/ADR-0014-drop-js-extensions-for-turbopack.md)
for the evidence; `tsconfig.json` uses `module: "preserve"` /
`moduleResolution: "bundler"` accordingly.

## The layering test

`tests/architecture/layering.test.ts` (with its rule engine in
`tests/architecture/layering-rules.ts`) enforces the dependency
direction mechanically:

- `src/domain/**` may import other domain code only. No
  `src/application`, no `src/infrastructure`. No runtime package
  imports except `decimal.js`, and even that is allowlisted to exactly
  `src/domain/shared/decimal.ts` and `src/domain/calculations/**` — the
  only place regulated numerics are ever widened out of their
  `DecimalString` form for arithmetic. `zod`, `@supabase/*`, `next`, and
  `react` are always forbidden in domain code.
- `src/application/**` may not import `@supabase/*` directly, and may
  not import `src/infrastructure/**` — with exactly one grandfathered
  exception: the `RegulatoryRepository` port type at
  `src/infrastructure/regulatory/regulatory-repository.ts`. In the
  target architecture, ports belong in `src/application/<context>/ports.ts`
  (new product ports follow this from the start); this one exception
  exists because the port was already built inside `infrastructure/`
  before this document existed, and moving it now would touch
  protected-adjacent files for no behavioral gain. Every *new*
  application-owned port lives under `src/application/`.
- A domain unit test (`*.test.ts` under `src/domain`) is still domain
  code for these purposes — it is covered by the same restriction as
  any other domain file, so a domain test cannot reach into
  infrastructure to fake its way to green.

The test suite proves the engine actually works with synthetic
fixtures (a deliberately-forbidden import in an in-memory fixture is
asserted to fail the check) before it walks the real
`src/domain`/`src/application` trees and asserts zero violations exist
there today. Run it with `pnpm test` like any other suite.

## Application service conventions

Every use case is a plain async function, not a class, taking its
dependencies as explicit parameters — this is the same shape
`resolveActiveDefaultValue(repository, input)` already uses. Two
conventions apply to every product use case from Phase 3 onward:

- **Explicit `OrgContext`.** Every application service that touches
  product (tenant-scoped) data takes an `OrgContext { org_id, user_id,
  role, capabilities }` parameter — never ambient/global state, never
  inferred from a request-scoped singleton. This is what makes
  tenancy testable with plain function calls and is the first of the
  two enforcement "walls" described in `DOMAIN_MODEL.md`'s tenancy
  section (the second wall is Postgres RLS).
- **Ports as parameters, not imports.** A service takes its repository
  port(s) as parameters (or via a small typed bag of ports), exactly
  like `resolveActiveDefaultValue` takes `repository`. This keeps
  application code swappable and unit-testable against fakes without
  touching Supabase.

## Result/error convention

Expected outcomes — including "rejected", "invalid", "not found",
"ambiguous" — are **discriminated unions with an explicit `status` and
an enumerated `reason`**, matching the style the regulatory resolver
already established (`DefaultValueResolutionResult`). See, for example,
`transitionShipment`'s `{ status: "REJECTED", reason: "LINE_INCOMPLETE" }`
in `src/domain/shipments/lifecycle.ts`. `throw` is reserved for
infrastructure failures and true data-integrity violations (a
malformed row from the database, a network failure) — never for an
expected business outcome. At the UI/API boundary (from Phase 2
onward), these unions are mapped to `problem+json` responses; internals
never leak into an error message a user sees.

## Numeric and identifier conventions

- **No `number` for anything regulated.** Quantities, emissions, and
  money are always `DecimalString` (`src/domain/shared/decimal.ts`) at
  rest and in transit, and are only ever widened into a `Decimal` for
  arithmetic inside the calculation-engine module. This mirrors the
  regulatory domain's own convention of carrying emission values as
  plain strings end-to-end so no float ever touches a regulatory
  number.
- **Branded IDs.** Every aggregate ID is a distinct nominal type via
  the `Brand<T, B>` helper in `src/domain/shared/ids.ts` — plain
  strings at runtime, non-interchangeable at compile time (an
  `OrganizationId` cannot be passed where a `ShipmentId` is expected,
  even though both are `string`).
- **No `Date` objects in domain data.** Dates are branded `IsoDate`
  (`YYYY-MM-DD`) and timestamps are branded `IsoTimestamp`
  (`src/domain/shared/reporting-period.ts`) — customs/regulatory dates
  are timezone-free calendar dates, not instants.
- **snake_case for persisted fields.** Domain types use snake_case
  field names (`org_id`, `created_at`, `direct_emissions`), matching
  the regulatory domain's own convention and mapping 1:1 onto Postgres
  column names, so there is no translation layer between a domain type
  and its row shape.

## Validation boundary

`zod` is used only at process boundaries — parsing environment
variables (`src/infrastructure/config/env.ts`), and from Phase 2
onward, server-action/route-handler inputs and import-file rows. It
never appears inside `src/domain` (the layering test enforces this).
Domain-internal validity is expressed as plain TypeScript types plus
pure invariant functions (see `src/domain/shipments/invariants.ts`,
`src/domain/organizations/invariants.ts`) that return the same
discriminated-result shape as everything else, not exceptions.

## Web stack placement

The web application (Next.js App Router, arriving in Phase 2) lives at
the repository root as `app/`, alongside the existing `src/` — not
inside a separate `apps/web` workspace package. This is a deliberate
extension of the "folders, not packages" decision above: one
`tsconfig.json`, one deploy unit, zero import churn in the protected
regulatory files. Infrastructure modules that must never execute in a
browser bundle are guarded with the `server-only` import (added when
the Next.js app lands), and the layering test's infrastructure
restriction already prevents `app/` code from reaching infrastructure
directly — it goes through application services.

**If a different web stack were chosen instead** (the master plan
also evaluated a Fastify API + separate SPA), nothing above this
paragraph would change: `src/domain`, `src/application`, and
`src/infrastructure` are deliberately framework-agnostic (no `next` or
`react` imports anywhere outside `app/`, enforced by the layering
test). Only the consumer changes — a Fastify app under `apps/api`
calling the same application services, paired with a separately
deployed SPA under `apps/spa` — and only the "Web stack placement"
section of this document and the corresponding ADR would need
updating.

## Python data pipeline

`scripts/regulatory/*.py` is dev-side/CI tooling, not a Railway runtime
dependency. See `scripts/regulatory/requirements.txt` for its pinned
dependencies (pandas, openpyxl, psycopg) and `CLAUDE.md` for the
command sequence. It is entirely outside the layered TypeScript
architecture described above — its only interface to the rest of the
system is the Postgres database it writes to and the checksum/version
metadata it records in `regulatory_datasets`/`regulatory_sources`.

## Auditability

`audit_events` (`supabase/migrations/20260828070000_create_organizations_foundation.sql`)
is the append-only record every "Why did Snowkap produce this result?"
chain (master plan §21) is built on, and the source table for the
"Audit"/"Activity" nav entries in `components/shell/sidebar.tsx` — real
routes as of P8, backed by the `listAuditEvents` read model
(`src/application/audit/list-audit-events.ts`) and the two screens at
`app/(importer)/audit/` and `app/(producer)/activity/`.

**Schema shape.** One row is `{id, org_id, occurred_at, actor_type,
actor_user_id, event_type, aggregate_type, aggregate_id, payload,
correlation_id}`, mirrored exactly by the `AuditEvent` domain type
(`src/domain/audit/types.ts`): `actor` is a discriminated `USER
{user_id}` / `SYSTEM` union (`actor_user_id` is null only for
`SYSTEM`, enforced by `audit_events_actor_consistency_ck`); `org_id` is
null only for a `SYSTEM`-scope event with no owning organization (e.g.
a future regulatory dataset activation — no such row is written by
anything in this codebase yet); `event_type` is a namespaced free-text
string (the catalog below); `aggregate` is `{type, id}`, where `type`
is a fixed enum (`audit_events_aggregate_type_check`, widened once so
far to add `EVIDENCE_FILE` — `20260829240000_p7c_evidence_files_schema.sql`).

**Immutability.** Append-only by the absence of any update/delete grant
or policy — there is no trigger enforcing this and none is needed; a
table with no UPDATE/DELETE policy under RLS simply cannot be mutated
or removed by any authenticated-role caller, which is a stronger and
simpler guarantee than a trigger that could itself be dropped. See the
table comment in `20260828070000_create_organizations_foundation.sql`.

**RLS scoping.** `audit_events_select_own_org`
(`20260828070000_create_organizations_foundation.sql`) admits SELECT
only for rows whose `org_id` is one of the caller's own orgs, via the
same `app.user_org_ids()` helper every other org-scoped SELECT policy
in this codebase uses. `audit_events_insert_own_org_as_self`
(`20260828150000_p4_shipment_intake_schema.sql`) is the one
authenticated-role INSERT policy, requiring `actor_type = 'USER'`,
`actor_user_id = auth.uid()`, and `org_id in (select
app.user_org_ids())` — which is what makes `recordAuditEvent`
(`src/application/audit/record-audit-event.ts`) safe as a bare
client-side insert: a caller can only ever record *themselves* as the
actor, into an org they already belong to. Every read service that
queries `audit_events` (`listSharedDataStatus`, `listAuditEvents`)
still applies its own explicit `org_id` filter on top of this policy —
Wall 1 (application) never depends on Wall 2 (RLS) alone, per
`docs/plans/MASTER_PLAN.md` §126.

**Event catalog.** Built by grepping every `recordAuditEvent` call site
under `src/application/` plus every direct `audit_events` insert inside
a `SECURITY DEFINER` SQL RPC (`supabase/migrations/*.sql`) — the latter
exist specifically for the cases where the acting user's own RLS
session cannot legally write the row itself yet (no membership row
exists at the moment `organization.created`/
`membership.invitation_accepted` need to be recorded; the importer's
session is never a member of the grantor org for
`sharing_grant.data_consumed`, by the entire design of a cross-org
grant — see that RPC's own header comment in
`20260829310000_p7d3_shared_data_consumption_audit.sql`). As of this
writing, every row from every event_type below carries
`correlation_id: null` **except `calculation.computed`** — the one
event type, out of every event type below, whose call site populates
it. A
per-row column repeating "null" thirty-three times and "populated"
once was dropped from the table in favor of the **Correlation IDs**
subsection that follows the catalog, which explains that one exception
and what it does and doesn't mean against master plan §21.

**Updated 2026-08-29 (P13 audit finding):** this catalog undercounted
by 7 event types across a full P9/P10 cycle before this correction —
the entire declaration lifecycle (added P9: `declaration.amendment_created`,
`declaration.draft_generated`, `declaration.draft_refreshed`,
`declaration.marked_ready`, `declaration.filed`) and membership
deactivation/reactivation (added P10: `membership.deactivated`,
`membership.reactivated`) were never folded in after landing. All 7
are now present in the table below.

| `event_type` | `aggregate_type` | Fires when | Write path |
| --- | --- | --- | --- |
| `organization.created` | ORGANIZATION | An organization is created, in the same transaction as its OWNER membership. | SQL RPC: `create_organization_with_owner()` (`20260828090000`) |
| `membership.invitation_accepted` | MEMBERSHIP | A pending org invitation is accepted and becomes a membership. | SQL RPC: `accept_organization_invitation()` (`20260828130000`) |
| `membership.role_changed` | MEMBERSHIP | An ADMIN+ changes another member's role. | `recordAuditEvent` — `manage-membership.ts` |
| `membership.removed` | MEMBERSHIP | A member is removed from an org. | `recordAuditEvent` — `manage-membership.ts` |
| `membership.deactivated` | MEMBERSHIP | An ADMIN+ deactivates another member (P10). | `recordAuditEvent` — `manage-membership.ts` |
| `membership.reactivated` | MEMBERSHIP | An ADMIN+ reactivates a deactivated member (P10). | `recordAuditEvent` — `manage-membership.ts` |
| `shipment.created` | SHIPMENT | A shipment is created. | `recordAuditEvent` — `create-shipment.ts` |
| `shipment.marked_ready` | SHIPMENT | A shipment transitions DRAFT → READY. | `recordAuditEvent` — `transition-shipment.ts` (`AUDIT_EVENT_TYPE_BY_ACTION`) |
| `shipment.reopened` | SHIPMENT | A shipment transitions READY → DRAFT. | `recordAuditEvent` — `transition-shipment.ts` |
| `shipment.locked` | SHIPMENT | A shipment is locked — either directly (declaration-filed guard) or in bulk as a side effect of filing a declaration. | `recordAuditEvent` — `transition-shipment.ts`; **also** SQL RPC `record_declaration_filed()` (`20260829400000`), one row per member shipment locked |
| `shipment.voided` | SHIPMENT | A shipment is voided. | `recordAuditEvent` — `transition-shipment.ts` |
| `shipment_line.added` | SHIPMENT_LINE | A line is added to a shipment. | `recordAuditEvent` — `manage-lines.ts` |
| `shipment_line.updated` | SHIPMENT_LINE | A line's fields are edited. | `recordAuditEvent` — `manage-lines.ts` |
| `shipment_line.removed` | SHIPMENT_LINE | A line is removed. | `recordAuditEvent` — `manage-lines.ts` |
| `emission_determination.set` | SHIPMENT_LINE | A line's emission determination is set for the first time (DEFAULT or ACTUAL). | `recordAuditEvent` — `resolve-line-emissions.ts` / `determine-from-actual-data.ts` |
| `emission_determination.redetermined` | SHIPMENT_LINE | An existing determination is overwritten. | `recordAuditEvent` — `resolve-line-emissions.ts` / `determine-from-actual-data.ts` |
| `calculation.computed` | SHIPMENT_LINE | A line's CBAM calculation completes. | `recordAuditEvent` — `calculate-line.ts` (the one call site that also populates `correlation_id` — see **Correlation IDs**, below) |
| `emission_data.recorded` | EMISSION_DATA | A new DRAFT emission_data record is entered. | `recordAuditEvent` — `manage-emission-data.ts` (`recordEmissionData`) |
| `emission_data.submitted` | EMISSION_DATA | DRAFT → submitted for verification. | `recordAuditEvent` — `manage-emission-data.ts` (`AUDIT_EVENT_TYPE_BY_ACTION`) |
| `emission_data.verified` | EMISSION_DATA | Submitted → verified. | `recordAuditEvent` — `manage-emission-data.ts` |
| `emission_data.rejected` | EMISSION_DATA | Submitted → rejected. | `recordAuditEvent` — `manage-emission-data.ts` |
| `emission_data.discarded` | EMISSION_DATA | A DRAFT record is discarded. | `recordAuditEvent` — `manage-emission-data.ts` |
| `emission_data.activated` | EMISSION_DATA | A verified DRAFT record becomes ACTIVE. | `recordAuditEvent` — `manage-emission-data.ts` (`activateEmissionData`) |
| `emission_data.superseded` | EMISSION_DATA | The prior ACTIVE record for that installation/period is retired by a new activation. | `recordAuditEvent` — `manage-emission-data.ts` (`activateEmissionData`, conditional on a prior ACTIVE row existing) |
| `installation.created` | INSTALLATION | An installation is added. | `recordAuditEvent` — `manage-installations.ts` |
| `installation.removed` | INSTALLATION | An installation is removed. | `recordAuditEvent` — `manage-installations.ts` |
| `operator.created` | OPERATOR | An operator is added. | `recordAuditEvent` — `manage-operators.ts` |
| `operator.removed` | OPERATOR | An operator is removed. | `recordAuditEvent` — `manage-operators.ts` |
| `supplier.created` | SUPPLIER | A supplier is added. | `recordAuditEvent` — `manage-suppliers.ts` |
| `supplier.removed` | SUPPLIER | A supplier is removed. | `recordAuditEvent` — `manage-suppliers.ts` |
| `evidence.uploaded` | EVIDENCE_FILE | An evidence file is uploaded. | `recordAuditEvent` — `upload-evidence.ts` |
| `evidence.removed` | EVIDENCE_FILE | An evidence file is removed. | `recordAuditEvent` — `upload-evidence.ts` |
| `sharing_grant.issued` | SHARING_GRANT | A producer issues a sharing grant. | `recordAuditEvent` — `manage-sharing-grants.ts` (`issueSharingGrant`) |
| `sharing_grant.accepted` | SHARING_GRANT | A grant is accepted — either directly, or via an email-invitation bootstrap; same event_type from both call sites. | `recordAuditEvent` — `manage-sharing-grants.ts` (`acceptSharingGrant`, `acceptSharingGrantInvitation`) |
| `sharing_grant.revoked` | SHARING_GRANT | A producer revokes a grant. | `recordAuditEvent` — `manage-sharing-grants.ts` (`revokeSharingGrant`) |
| `sharing_grant.data_consumed` | SHARING_GRANT | An importer determines/redetermines a line from a producer's shared data — recorded on the **grantor's** org_id, not the importer's. | SQL RPC: `record_shared_data_consumption()` (`20260829310000`), called from `determine-from-actual-data.ts` |
| `declaration.draft_generated` | DECLARATION | A declaration draft is first generated for a period. | `recordAuditEvent` — `generate-or-refresh-declaration-draft.ts` |
| `declaration.draft_refreshed` | DECLARATION | An existing draft is regenerated (e.g. after underlying data changed). | `recordAuditEvent` — `generate-or-refresh-declaration-draft.ts` |
| `declaration.marked_ready` | DECLARATION | A declaration transitions DRAFT → READY. | `recordAuditEvent` — `mark-declaration-ready.ts` |
| `declaration.amendment_created` | DECLARATION | An amendment declaration is created against an already-filed one. | `recordAuditEvent` — `create-declaration-amendment.ts` |
| `declaration.filed` | DECLARATION | A declaration is filed, atomically LOCKing every member shipment in the same transaction (see `shipment.locked` above). | SQL RPC: `record_declaration_filed()` (`20260829400000`) |

### Correlation IDs

Verified for this pass by grepping every `recordAuditEvent` call site
under `src/application/` for a `correlationId:` argument, every
`SECURITY DEFINER` SQL RPC under `supabase/migrations/*.sql` that
inserts into `audit_events` for a `correlation_id` column in its
INSERT, and every call site of `createRequestId()`
(`src/infrastructure/observability/logger.ts`). This is a verification
pass, not an implementation one — `docs/plans/MASTER_PLAN.md` §38's P8
contract lists "correlation-ID verification" as in-scope and "new data
capture" as non-scope, so nothing below was changed to make it true; it
is reported as found.

- **What's actually linked today.** One pair of rows, in two different
  tables, share a `correlation_id`: `calculateLine`'s
  `calculation_results` insert and the `calculation.computed` audit
  event that follows it in the same function
  (`src/application/calculations/calculate-line.ts`) both get the same
  `randomUUID()`. That function's own doc comment explains why — so a
  future reproduction check can flag any `calculation_results` row with
  no matching audit event as suspect, given that `calculation_results`
  accepts a direct client-side INSERT rather than routing through a
  recomputing RPC — and tracks the larger fix (an RPC that recomputes
  and compares, or removing the direct INSERT) as a named P11
  hardening item from the mandatory P6 review, deliberately not
  redesigned here. This is the *only* place in the codebase where two
  rows in two different tables carry the same `correlation_id` value.
  Every other `recordAuditEvent` call site under `src/application/` —
  16 files as of 2026-08-29, up from 12 at P8 exit as the P9
  declarations module and the P10 membership-deactivation lifecycle
  added their own — and all four `SECURITY DEFINER` RPCs that insert
  into `audit_events` directly (`create_organization_with_owner()` in
  `20260828090000`, `accept_organization_invitation()` in
  `20260828130000`, `record_shared_data_consumption()` in
  `20260829310000`, and `record_declaration_filed()` in `20260829400000`,
  added P9/hardened P11 — missing from this list until this same
  correction) write `correlation_id: null`, because none of them is
  ever handed a value to write.

  **P11 finding, closed:** `record_declaration_filed()`'s own audit
  writes are `SECURITY DEFINER`, so they were never exposed to a client
  INSERT — but before `20260829430000_p11_review_audit_events_event_type_catalog.sql`,
  every *other* `audit_events` write path (the plain `recordAuditEvent`
  call sites above) accepted an arbitrary, unvalidated `event_type`
  string from the caller via RLS's own INSERT policy, since the table
  had no `event_type` CHECK constraint. A member could forge any
  `event_type`/`payload` combination into their own org's audit trail
  via a bare client INSERT — live-reproduced during the P11 review as a
  fabricated `declaration.filed` row carrying a forged
  `filed_reference`. That migration adds a `WITH CHECK` allowlist of
  every real event type (the 41 client-insertable + RPC-only types this
  catalog now documents) to close it.
- **What generates a correlation/request ID at all.** One thing does,
  and it isn't wired to anything: `createRequestId()`
  (`src/infrastructure/observability/logger.ts`) exists and is
  unit-tested (`logger.test.ts` — non-empty, unique per call) for
  exactly this purpose, per its own doc comment citing master plan
  §21/§28 ("Request IDs on every action, threaded into logs and audit
  events"). But it has no other caller anywhere in this codebase —
  grep confirms `createRequestId` appears only in its own definition
  and its own test. The one production caller of `log()` itself
  (`app/api/health/route.ts`) doesn't call `createRequestId` either.
  So there is no request-scoped ID generated per action/request today,
  no propagation of one through logs, and `calculateLine`'s
  `randomUUID()` is scoped to that one function call, not to the HTTP
  request or server action invoking it — it is not, and was never
  designed to be, the request-wide thread §21 describes.
- **Known gap, not a defect.** Master plan §21 states plainly:
  "Correlation IDs thread request → logs → audit events → calculation
  rows." That thread does not exist today, outside the one
  `calculation_results`/`calculation.computed` pair above — `logger.ts`
  has the request-ID primitive ready and untouched, `record-audit-event.ts`
  has the field ready and almost entirely unused, and the two are not
  connected to each other or to anything upstream. This is disclosed
  here rather than left for a reader to discover, per this codebase's
  standing convention against documenting functionality that doesn't
  exist. Full threading — one request-scoped ID generated per
  action/request, propagated through `log()` calls, and attached to
  every `audit_events` row and `calculation_results` row that request
  produces — remains explicit future scope, not started by this pass.

## Related documents

- [`DOMAIN_MODEL.md`](./DOMAIN_MODEL.md) — the product domain model
  (aggregates, lifecycles, invariants), tenancy design, and the Phase 3
  DDL template.
- [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md) — the regulatory schema
  as it exists today.
- [`REGULATORY_RESOLUTION_RULES.md`](./REGULATORY_RESOLUTION_RULES.md) —
  the normative regulatory resolution rules (R1–R14) the resolver
  implements.
- `docs/adr/` — architecture decision records for the choices this
  document summarizes.
- [`docs/plans/MASTER_PLAN.md`](../plans/MASTER_PLAN.md) — the approved
  end-to-end product plan, phase contracts, and roadmap.

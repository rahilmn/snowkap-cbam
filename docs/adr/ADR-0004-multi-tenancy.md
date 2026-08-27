# ADR-0004: Multi-tenancy — org_id from day one, dual-wall enforcement

## Status

Accepted

## Context

No tenancy concept exists anywhere in the current schema (the
regulatory foundation migration's own header comment says organizations
are explicitly out of scope). The product is inherently multi-tenant
(importer and producer organizations), and retrofitting tenant
isolation onto tables built without it is a data migration, not a
schema tweak — the highest-risk kind of change to defer.

## Decision

Every product table carries `org_id uuid not null references
organizations(id)` from its very first migration (Phase 3), denormalized
onto child rows (e.g. `shipment_lines.org_id`) so RLS policies never
need to join through a parent to determine ownership. Two enforcement
walls, always both: (1) application services take an explicit
`OrgContext { org_id, user_id, role, capabilities }` parameter — never
ambient/global state; (2) Postgres Row Level Security is **enabled at
table creation**, with policies defined in the same migration, driven
by a `security definer` helper function (`app.user_org_ids()`) so
per-row cost stays flat. The Supabase service-role key (which bypasses
RLS) is confined to system jobs and the regulatory adapter, and is
never used in a request path a browser can reach.

Cross-organization sharing (see ADR-0012) is the one sanctioned way
data crosses this boundary, and is itself dual-wall-enforced and
read-only.

## Alternatives considered

- Defer RLS policies until "the access model is finalized" (as the
  regulatory tables currently do) — rejected for product tables
  specifically: that pattern is fine for read-only reference data
  behind a service-role-only adapter, but wrong for tenant data that a
  logged-in user will read/write directly.
- JWT `org_id` claim instead of a `memberships` table lookup — noted as
  a possible later optimization once the membership-lookup approach is
  proven; not the foundation, since it doesn't naturally support a user
  belonging to multiple organizations (a real case here: one user in
  both an importer org and a producer org).

## Consequences

Phase 3's first migration must be `organizations` + `memberships` (see
ADR-0011) before any product table that references them. A standing
two-organization isolation test suite is required from Phase 3 onward,
and a three-party (producer/grantee/stranger) version from Phase 7 once
sharing exists.

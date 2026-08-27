# ADR-0003: Web stack — Next.js App Router, single Railway service

## Status

Accepted

## Context

No frontend or HTTP server exists yet. The product needs a web
application (two experiences, described in the master plan: Importer/
Declarant and Producer/Operator) deployed to Railway, backed by
Supabase. Two credible directions: (a) a Next.js App Router application
as a single deployable service, server-rendering and handling mutations
via server actions; (b) a Fastify (or similar) API service plus a
separately deployed React SPA.

## Decision

Next.js App Router, deployed as one Railway service. React Server
Components read data by calling application services directly (no
internal HTTP hop); mutations go through server actions; route handlers
exist only where the shape demands them (file upload/download streams,
health checks, future webhooks). This is the owner's explicit choice,
confirmed during Phase 0/1 planning, and the project's stated default
("favor a single deployable application unless there is strong evidence
that separate services are required").

## Alternatives considered

- **Fastify API + React SPA** — two Railway services, a harder API
  boundary, easier future non-web clients — but CORS/auth plumbing and
  two deployments to maintain, for a benefit (API/UI separation) the
  project doesn't need yet. Kept as a documented delta: see
  `docs/architecture/ARCHITECTURE.md` ("Web stack placement") — because
  `src/domain`/`src/application`/`src/infrastructure` are kept
  framework-agnostic regardless of this choice, switching to this
  alternative later would only mean adding `apps/api` and `apps/spa`
  consumers, not rearchitecting the domain.
- Defer the stack decision to Phase 2 — rejected: Phase 1's domain
  foundations benefit from knowing the target consumer shape now (e.g.
  confirming RSC-first reads over a client-side data-fetching library).

## Consequences

`app/` lives at the repository root (not inside a package), per
ADR-0002. No `next` or `react` import may appear anywhere under
`src/domain`, `src/application`, or `src/infrastructure` — the layering
test enforces this indirectly by forbidding those packages in
`src/domain` and will be extended to check `src/application` /
`src/infrastructure` if a violation risk is ever identified there.

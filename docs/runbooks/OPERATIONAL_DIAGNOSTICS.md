# Operational diagnostics runbook

This is the P12 diagnostics runbook named alongside
[`DEPLOYMENT.md`](./DEPLOYMENT.md), [`ROLLBACK.md`](./ROLLBACK.md), and
[`INCIDENT_RESPONSE.md`](./INCIDENT_RESPONSE.md) in this phase's own
instructions. Where `INCIDENT_RESPONSE.md` is "something is visibly
wrong, respond," this document is "answer 'what's actually happening in
production right now,'" including the routine, non-incident version of
that question — a user reports something odd, and you need to go find
out what actually occurred.

## The three real surfaces, today

**Railway's own logs (once connected).** Not connected in this
environment yet — see `DEPLOYMENT.md`'s status note. Once it is:
Railway captures this app's stdout as-is (`src/infrastructure/observability/logger.ts`'s
one-line-per-event structured JSON — see `INCIDENT_RESPONSE.md`'s "Reading
the structured JSON logs" section for the exact shape and redaction
rule, not repeated here), viewable in Railway's dashboard "Logs" tab or
via `railway logs` from the CLI, filterable by raw text/time. There is
no log drain or external aggregator wired in (master plan §41 still
lists this as an open decision) — Railway's own retention window is the
only place these lines live once written, there is no separate,
longer-lived archive.

**`/status` (`app/status/page.tsx`, built in P10) — the in-product
trust surface.** This is the one screen designed specifically to answer
"what is this deployment, and what can it verify about itself" for a
signed-in member, without needing log or database access at all:

- **Application**: `GIT_SHA` (or an explicit "No GIT_SHA set --
  local/dev build" badge when unset — never a fabricated hash).
- **Regulatory foundation**: the same `checkActiveDefaultEmissionValuesDataset`
  invariant `/api/health` checks (shared function, so the two screens
  can never quietly disagree — see that function's own doc comment),
  plus a table of every currently-`ACTIVE` `regulatory_datasets` row
  across all seven `dataset_type` values (version, effective range,
  source file, checksum, imported/created timestamps) — every column
  shown is a real column on that table; there is no `verified_at`
  column, so no "last verified" timestamp is invented (see the page's
  own doc comment for this exact reasoning).
- **Background jobs**: stated plainly as "Not yet applicable" — this
  product has no background job runner (no pg-boss/worker code exists
  anywhere in this repository as of this phase, per master plan
  §11/§29's "adopted once async work first exceeds request scope").
  There is deliberately no fabricated "all jobs healthy" panel for a
  job system that doesn't exist yet.

`/status` reads through the caller's own session-scoped Supabase client
(not the service-role client `/api/health` uses), so it requires being
signed in as a member of an org — it's the human-facing surface, not
the scriptable one.

**`/api/health` — the scriptable, unauthenticated surface.** See
`INCIDENT_RESPONSE.md`'s "First move" section for the exact response
shape and status-code mapping; not repeated here. Use this one for
`curl`/monitoring/scripted checks; use `/status` for a human looking
around inside the app.

## Correlating a user-reported issue to a specific request

**State the real, current limit honestly before describing the
workflow around it** — this section exists specifically because P8's
audit work already investigated and documented this exact question
(`docs/architecture/ARCHITECTURE.md`'s "Auditability" → "Correlation
IDs" subsection), and overstating coverage here would contradict that
already-honest documentation.

What's actually true today, verified in that section by grepping every
`recordAuditEvent` call site, every `SECURITY DEFINER` SQL RPC that
inserts into `audit_events`, and every caller of `createRequestId()`:

- **There is no per-request correlation ID generated or threaded
  anywhere in this codebase today.** `createRequestId()`
  (`src/infrastructure/observability/logger.ts`) exists, is unit-tested,
  and has exactly zero callers outside its own test file. Nothing
  generates one per incoming request/action, and nothing propagates one
  through `log()` calls or into `audit_events` rows as a matter of
  course.
- **The one real exception**: `calculateLine`
  (`src/application/calculations/calculate-line.ts`) generates a single
  `randomUUID()` and writes it as `correlation_id` on **both** the
  `calculation_results` row it inserts **and** the paired
  `calculation.computed` audit event, in the same function call. This
  is the only place in the schema where two rows in two different
  tables share a `correlation_id` value. It's scoped to that one
  function invocation, not to the HTTP request or server action that
  triggered it — every other `event_type` in the audit catalog (33 of
  the 34 listed in `ARCHITECTURE.md`) writes `correlation_id: null`,
  because nothing hands its call site a value to write.

**What this means in practice for "correlate a report to a request":**

1. **If the report is about a specific calculation result** (a user
   says "this line's CBAM number looks wrong" or "why is this the
   value"): this is the one case with real, usable correlation. Find
   the `calculation_results` row for that shipment line, read its
   `correlation_id`, and the exactly-one `audit_events` row of type
   `calculation.computed` sharing that value is the matching audit
   trail entry for that specific computation. This is also the case
   P8's "Why this number?" explanation chain
   (`app/(importer)/audit/`, `app/(producer)/activity/`,
   `listAuditEvents` — master plan §21) already surfaces in-product,
   so for this specific report type, the org's own audit/activity
   screen is usually a faster path than reading raw tables at all.
2. **For everything else** — a failed sign-in, a stuck CSV import, a
   redirect that landed somewhere wrong, an evidence upload that
   didn't appear — there is genuinely no request-ID thread linking the
   user's report to a specific log line or database row. The workaround
   is imprecise, manual correlation by **timestamp + org + description**:
   - Get the reporter's org, approximate time, and what they were
     doing.
   - Check `/api/health` / `/status` first, to rule out a systemic
     incident before spending time chasing an isolated report (see
     `INCIDENT_RESPONSE.md`).
   - Search `audit_events` filtered by that `org_id` and an
     `occurred_at` window around the reported time, via the org's own
     audit/activity screen if the reporter's own account can see it, or
     directly (Table/SQL editor) if not — which requires the
     credentialed access path `SUPPORT_ACCESS.md` documents, including
     its manual-record-keeping requirement, since a direct query leaves
     no trace in the product's own audit chain.
   - Search Railway logs (once connected) for the same time window and
     org-identifying details (org id/name, user email if it appears in
     a log field — remembering `redactSensitiveFields()` only redacts
     by field *name*, not by scanning values) — by raw text/time, not
     by any ID that ties a log line to that specific audit row, because
     none exists yet to search by.

## What's honestly not possible today

Stated together, plainly, because each gap individually is already
disclosed elsewhere in this codebase's own documentation and repeating
them here in one place is more useful than leaving them scattered:

- **No log drain / external log aggregation** (master plan §41, open
  decision) — Railway's own retention window (once connected) is the
  only place logs live.
- **No error tracker** (Sentry or otherwise — §41, open decision; no
  `@sentry/*` dependency exists in `package.json`) — no automatic
  error-rate dashboards, no stack-trace aggregation beyond what a raw
  log line's `message` field happens to contain.
- **No APM/tracing** — no latency breakdown by route/query beyond
  whatever master plan §33's manually-verified performance budgets
  captured at test time; nothing live/continuous.
- **No per-request correlation ID**, beyond the one
  `calculation_results`/`calculation.computed` pairing described above
  — this is the specific, load-bearing limitation this document exists
  to state accurately rather than round up.
- **No alerting connected** — ties directly into
  `INCIDENT_RESPONSE.md`'s "Escalation" section: nothing pages anyone
  automatically today.

None of these are being described as defects to fix as part of this
document — they're accurately-scoped, already-known gaps (several
named explicitly as open owner decisions in master plan §41), recorded
here so a diagnostic session starts from an accurate picture of what
tooling actually exists rather than discovering the gap mid-incident.

## Related documents

- `docs/architecture/ARCHITECTURE.md` — "Auditability" section in full,
  the authoritative source for the correlation-ID facts stated above;
  read it directly rather than trusting only this summary if the
  question matters for something high-stakes.
- [`INCIDENT_RESPONSE.md`](./INCIDENT_RESPONSE.md) — first-response
  checks this document's surfaces feed into.
- [`SUPPORT_ACCESS.md`](./SUPPORT_ACCESS.md) — the credentialed direct-
  database-access path referenced above, and its manual audit-trail
  requirement.
- `app/status/page.tsx`, `app/api/health/route.ts`,
  `src/infrastructure/observability/logger.ts`,
  `src/application/calculations/calculate-line.ts` — the actual source
  this document describes.
- `docs/plans/MASTER_PLAN.md` §21 (auditability/explainability), §32
  (observability), §41 (open decisions named above).

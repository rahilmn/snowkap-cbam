# Incident response runbook

This is the P12 incident-response runbook named alongside
[`DEPLOYMENT.md`](./DEPLOYMENT.md) and [`ROLLBACK.md`](./ROLLBACK.md)
in this phase's own instructions (master plan §29/§43's deployment/
rollback shape implies "something eventually goes wrong in production
and someone has to respond" without a dedicated document for it until
now). It is a practical first-response guide for *this specific
application* — every check below points at a real file, a real
endpoint, or a real, currently-true gap, not a generic incident-
response template.

## First move: is the app up at all?

`GET /api/health` (`app/api/health/route.ts`) is the fastest real
signal this codebase has. It needs no auth (`force-dynamic`, no session
check) and is what Railway's own healthcheck hits (`railway.json`,
`healthcheckPath: "/api/health"` — see `DEPLOYMENT.md` §4). Response
shape:

```json
{
  "status": "ok" | "degraded",
  "git_sha": "<deployed commit's short SHA, or \"dev\">",
  "checks": {
    "database": "ok" | "error",
    "active_regulatory_dataset": "ok" | "missing" | "duplicate" | "error"
  }
}
```

- **`status: "ok"` → HTTP 200.** Process is up, Supabase answered, and
  exactly one `ACTIVE` `default_emission_values` dataset exists. This
  is the *only* combination that returns `ok`.
- **`status: "degraded"` → HTTP 503**, for every other combination —
  there is no partial-credit state. Read `checks.database` and
  `checks.active_regulatory_dataset` together to know which of the two
  things the route actually checked failed (see the per-state table
  below; the route's own logic forces `checks.database` to `"error"`
  whenever the dataset check itself couldn't run, precisely so a broken
  deploy can't read as healthy on that field by accident — see the
  route's own comment: "the dataset invariant was never actually
  checked -- it must not default to ok").
- **No response at all / connection refused / timeout** is a different,
  worse signal than a `503` — it means the process itself isn't
  answering (crashed, still starting, network/DNS/routing problem in
  front of it), not that it started and found a problem. Distinguish
  these before assuming either the deploy or Supabase side.

For a logged-in-member's view of the same underlying checks, `/status`
(`app/status/page.tsx`, P10) shows the same regulatory-dataset check
plus every currently-`ACTIVE` `regulatory_datasets` row and the app's
`GIT_SHA` — useful when you're already in the app and want a
human-readable confirmation rather than a raw JSON fetch, but it reads
through the caller's own session-scoped client (not the service-role
client `/api/health` uses), so it requires being signed in and a member
of an org; `/api/health` is the one to script or curl.

## Reading the structured JSON logs

Every log line this app writes goes through one function —
`log()` in `src/infrastructure/observability/logger.ts` — which writes
one JSON object per line to stdout via `console.log`. Shape:

```json
{"level": "debug" | "info" | "warn" | "error", "message": "...", "time": "<ISO 8601>", "...other fields"}
```

`level`, `message`, and `time` are reserved — a caller can never
override them via its own `fields` argument. Every other field passes
through `redactSensitiveFields()` first: any field whose **name**
matches a password/secret/token/credential/key-shaped pattern is
replaced with `"[REDACTED]"` before it's ever written — this is a
name-based deny-list, not a value-based one, so a field that happens to
*contain* a secret under an innocuous name would not be caught (there
is no call site that does this today — see that function's own doc
comment for the audit that confirmed it — but it's worth knowing the
limit of the guarantee when reading an unfamiliar future log line).

**Where to actually read them, today**: there is no Railway project
connected to this environment (`DEPLOYMENT.md`'s status note applies
here too) and no log drain adopted (master plan §41 still lists this as
an open decision) — so today, these JSON lines are visible only in
whatever terminal is running `pnpm dev` / `pnpm start`, or in
`docker logs <container>` for a locally-run image. Once a Railway
project exists, its own "Logs" tab (or `railway logs` via the CLI)
becomes the real source — Railway captures container stdout as-is
(the logger's own comment states this design choice directly: "no log
shipping agent needed"), filterable by raw text and time in Railway's
UI, but with no external aggregation or long-term retention beyond
whatever Railway itself keeps.

**Correlating a log line to a specific user action has a real, known
limit — do not assume more than what's actually true.** `logger.ts`
has a `createRequestId()` helper built for exactly this
(master plan §21/§28: "Request IDs on every action, threaded into logs
and audit events"), but as `docs/architecture/ARCHITECTURE.md`'s
"Auditability" → "Correlation IDs" section documents plainly: it has no
caller anywhere in this codebase outside its own unit test, and the one
production `log()` call site (`app/api/health/route.ts`'s error branch)
doesn't use it either. The **one** exception is
`calculateLine`'s `calculation_results` row and its paired
`calculation.computed` audit event, which share one `randomUUID()` —
scoped to that single function call, not to the HTTP request that
triggered it. So: for a calculation-explanation question, that one
pairing is real and usable; for almost everything else (a failed
sign-in, a stuck import, a redirect that went to the wrong place),
there is no request-ID thread linking a log line to a specific user
action — matching has to be done by timestamp + org + description, by
hand, and that's imprecise. See `OPERATIONAL_DIAGNOSTICS.md` for the
fuller correlation workflow this limitation shapes.

## What each degraded state means, and what to check first

| `checks.database` | `checks.active_regulatory_dataset` | What actually happened | Check first |
| --- | --- | --- | --- |
| `error` | `error` | `getSupabaseClient()` threw, or the dataset query itself rejected — Supabase was unreachable before the dataset invariant could even be evaluated. The route's own `catch` block logs this at `error` level with the caught error's `.message` (see `log("error", "health check database connectivity failed", ...)` in the route). | 1) The route's own error log line (message field has the real error). 2) Are `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` actually set and correct in this environment (not just present in `.env.example` — a missing/typo'd Railway env var throws exactly this way). 3) Supabase's own status page / dashboard for a platform-side outage. 4) Network/DNS reachability from the Railway service to the Supabase project. |
| `ok` | `missing` | Database is reachable, but the query found **zero** `ACTIVE` `default_emission_values` rows. | A migration or manual change deactivated the dataset without activating a replacement, or a broken deploy ran against the wrong project. Check `regulatory_datasets` directly (Table/SQL editor — see `SUPPORT_ACCESS.md` for the access-discipline this requires) for the current row set. Recovery is the regulatory pipeline (`scripts/regulatory/*.py`) re-run and `pnpm regulatory:verify`, per `BACKUP_RESTORE.md`'s recovery decision tree's regulatory branch — never a manual `UPDATE` to flip a row `ACTIVE` outside that pipeline. |
| `ok` | `duplicate` | Database is reachable, but **more than one** row is `ACTIVE` for the same dataset. | An activation migration that added a new `ACTIVE` row without deactivating the previous one. Fix is a **new, forward** corrective migration flipping the extra row's status — never editing the already-applied migration, per CLAUDE.md's protected-zone rule and `ROLLBACK.md` §2's forward-only discipline. |
| `error` | `missing` or `duplicate` doesn't occur | (Not a real combination — see the route's own logic: whenever `active_regulatory_dataset` is `"error"`, `database` is forced to `"error"` too, and whenever it's `"missing"`/`"duplicate"`, `database` stays `"ok"` because the query itself succeeded.) | — |

## Escalation

**Today there is no on-call rotation or paging system connected to
this project.** This is stated plainly because it's true right now,
not because it's the intended end state — master plan §32 describes
"Alerts: Railway health, CI failures, error-tracker rules; alert
test-fired at P12" as the target, but no error tracker is adopted yet
(§41 still lists "Sentry/error tracking" as an open owner decision —
confirmed by grep: no `@sentry/*` dependency in `package.json`), no
Railway project is connected to trigger a Railway-health alert from,
and nothing in this repository configures a paging tool. For a
genuinely unresolvable issue today, the real path is: the team's normal
communication channel (not named here, per the same convention
`SUPPORT_ACCESS.md` uses — this repo doesn't contain or govern one),
reaching whoever holds Supabase project credentials or (once one
exists) Railway project access — the same credential-holding population
`SECRET_ROTATION.md` and `SUPPORT_ACCESS.md` already describe. Naming
this gap honestly here, rather than inventing an escalation path that
doesn't exist, is the same discipline those two documents already
apply to their own subjects.

## Checklist: likely early-stage incident classes

**A bad deploy.** Symptom: `/api/health` goes `degraded` (or stops
responding) right after a deploy, and its `git_sha` matches the new
build, not the previously-healthy one. First action:
[`ROLLBACK.md`](./ROLLBACK.md) — redeploy the previous known-good
build, then confirm via `ROLLBACK.md` §1's health-signal check (status
**and** `git_sha` match, not status alone).

**A Supabase outage.** Symptom: `checks.database: "error"` (and
correspondingly `checks.active_regulatory_dataset: "error"`, per the
table above), with no recent deploy to explain it, and Supabase's own
status page or dashboard confirming a platform-side incident. There is
nothing app-side to fix — this app has no fallback data path. Monitor
and re-check `/api/health` for recovery; do not restart the Railway
service repeatedly expecting it to help (it won't fix an upstream
outage, and Railway's own `restartPolicyMaxRetries: 3` will already
have tried that on its own after the healthcheck first failed).

**A regulatory dataset misconfiguration.** Symptom:
`checks.active_regulatory_dataset: "missing"` or `"duplicate"` on
`/api/health`, or the `/status` page's "Regulatory foundation" badge
showing anything other than the green "Exactly one ACTIVE dataset."
See the table above for the specific fix per state. Do **not** attempt
a direct data patch outside the pipeline/migration discipline — that's
exactly the "silently pick among ambiguous candidates" / "hardcode a
regulatory number" class of mistake CLAUDE.md's protected-zone rules
exist to prevent, and it applies just as much during an incident as
during ordinary development.

**A rate-limit-store or auth issue.** `src/infrastructure/rate-limit/rate-limiter.ts`
is, by its own doc comment, a deliberately honest interim measure: a
**single-process, in-memory** sliding-window limiter, wired into
`app/(auth)/actions.ts`, `app/accept-invitation/actions.ts`, and
`app/api/evidence/upload/route.ts`. Two real, distinct symptom
patterns follow directly from that design, and are worth telling apart
before assuming either is a security incident:
- **Legitimate users unexpectedly locked out of sign-in/invitation
  actions**, especially right after a burst of unrelated traffic — the
  in-memory counter has no way to distinguish "one attacker" from "many
  legitimate users sharing a counter key" (e.g. behind the same NAT/
  proxy, depending on how the request's client IP is derived — see
  `components/shell/get-client-ip.ts`). Check whether the lockout
  correlates with a real traffic spike or a specific shared-IP
  population before treating it as an attack.
- **Rate limiting seems ineffective** — an attacker appears to get far
  more attempts through than the configured limit allows. Check whether
  the Railway service is currently scaled to more than one instance:
  each process keeps its **own** independent counter (the module's own
  comment states this plainly — "N Railway/Node process enforces its
  own, independent limit" — meaning N instances behind a load balancer
  raise the *effective* ceiling to N× the configured limit for an
  attacker spread across them), and a limiter's own counters reset to
  zero on every process restart/crash/deploy, which a bad-actor
  retrying across deploys could also exploit.

Neither of these is a defect to silently patch mid-incident — they're
already-documented, accepted limitations of the current implementation
(master plan §41 lists a real shared rate-limit store, e.g. Redis, as
a still-open owner decision). The correct incident response is to
recognize the pattern, not to attempt an ad hoc fix to the limiter
itself under pressure.

## Related documents

- [`DEPLOYMENT.md`](./DEPLOYMENT.md) — the deploy procedure a "bad
  deploy" incident traces back to.
- [`ROLLBACK.md`](./ROLLBACK.md) — the actual rollback procedure.
- [`BACKUP_RESTORE.md`](./BACKUP_RESTORE.md) — recovery decision tree
  for genuine data-loss, as distinct from the health-check states here.
- [`SUPPORT_ACCESS.md`](./SUPPORT_ACCESS.md) — the credentialed-access
  discipline for looking directly at database state during an incident.
- [`OPERATIONAL_DIAGNOSTICS.md`](./OPERATIONAL_DIAGNOSTICS.md) — the
  fuller "what's happening right now" workflow this document's
  first-response checks feed into.
- `docs/architecture/ARCHITECTURE.md` — "Auditability" section, the
  authoritative source for the correlation-ID limitation described
  above.

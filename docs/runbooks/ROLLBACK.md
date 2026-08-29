# Rollback runbook

This is the P12 rollback runbook named in
[`docs/plans/MASTER_PLAN.md`](../plans/MASTER_PLAN.md) §43 ("Rollback
Strategy") and checked in §44's production-readiness list ("Rollback
rehearsed"). §43 states the strategy in outline —
**"Railway previous-build redeploy (rehearsed P12); health-gated
promotion; staging always one step ahead"** — this document turns that
outline into an actual step-by-step procedure. It assumes
[`DEPLOYMENT.md`](./DEPLOYMENT.md) has already been read (this document
does not repeat that document's environment/build/healthcheck details).

**Status, honestly, as of 2026-08-29**: exactly as `DEPLOYMENT.md`
states, no staging or production Railway project is connected to this
environment. **This procedure has not been rehearsed against a real
Railway environment.** Master plan §43 itself flags the rehearsal as a
P12 deliverable ("rehearsed P12"), not something already done, and §44
lists "Rollback rehearsed" as an outstanding production-readiness
checklist item. What follows is the precise, ready procedure — derived
from this repo's actual `railway.json`, `app/api/health/route.ts`, and
master plan §43's own text — not a record of a rehearsal that happened.

## Two separate rollback domains — do not conflate them

Exactly like `BACKUP_RESTORE.md`'s "two separate recovery domains"
distinction, this is the single easiest mistake to make when reading
this document quickly, so it's stated up front and in bold:

**A rollback is a redeploy of old application code against the SAME
already-migrated database schema — never a schema rollback.** This
codebase's migrations are forward-only (master plan §12, §43: "Code:
... `git revert`... Migrations: forward-only"). There is no tooling
anywhere in this repo — no `down` migration, no schema-versioned
rollback script — that reverts an applied migration, and none should
ever be written to do so. Conflating "roll back the deployment" with
"roll back the schema" is exactly the mistake this section exists to
prevent: the two are handled by completely different mechanisms below,
and only one of them (application code) is ever actually "rolled back"
in the literal sense.

## 1. Application code rollback

### Identify the last-known-good build

Two independent sources should agree before proceeding:

1. **The application's own deployment-visibility signal.** Every build
   carries its `GIT_SHA` (Dockerfile build arg — see `DEPLOYMENT.md`
   §2), surfaced on `/api/health`'s `git_sha` field and the `/status`
   page's "Version (GIT_SHA)" card. If the environment was healthy
   before the bad deploy, whatever `GIT_SHA` was showing there — from a
   monitoring check, a teammate's last "looks fine" report, or Railway's
   own deploy history — is the candidate last-known-good commit.
2. **Railway's own deployment history for the service.** Railway
   retains prior builds per service (retention depends on the plan/
   project configuration — confirm in the dashboard once a real project
   exists) and shows, per historical deploy, the commit it built from
   and whether its healthcheck passed. Cross-check this against (1):
   the build immediately before the bad one, that Railway itself
   recorded as healthy, is the actual rollback target — don't rely on
   `git log` guesswork alone when Railway's own record is available.

Then confirm, independently, that CI was green for that commit
(`.github/workflows/ci.yml`'s run for that exact SHA in GitHub Actions)
— a build Railway once marked "healthy" only means its healthcheck
passed after deploy, not that it necessarily represents a commit you'd
choose to ship again if e.g. a security issue was found in it after the
fact. In the normal case (rolling back from a bad deploy that broke
something the healthcheck or immediate smoke-testing catches) this
extra check is a formality; treat it as a real check, not a formality,
if the rollback reason is itself security-related.

### Trigger the redeploy

Two paths, in order of preference:

1. **Railway's built-in "redeploy previous build" action** (the
   platform feature master plan §43 names directly: "Railway
   previous-build redeploy"). Railway can redeploy a prior build from
   its own deployment history **without rebuilding the Docker image** —
   this is the fast path, typically seconds to a couple of minutes
   (container pull + start + healthcheck), not a full CI/build cycle.
   Use this whenever the target build is still present in Railway's
   history. This is the mechanism §43 rehearses at P12; it has not yet
   been exercised in this environment (see the status note above).
2. **Fallback: redeploy from a known-good commit via the normal
   pipeline**, only if the needed build has aged out of Railway's
   history (or Railway's redeploy-previous-build action is unavailable
   for some other reason). This is slower — it goes through a full
   Docker build again (`DEPLOYMENT.md` §2) — but produces the identical
   image content for the same commit and `GIT_SHA` build arg, since the
   build is fully reproducible from source (frozen lockfile, pinned
   Node version, deterministic `next build`). Per CLAUDE.md's git
   discipline, if the bad commit is still on `main` and needs to stop
   being the deploy target going forward (not just for this one
   rollback), use `git revert` to create a new commit undoing it rather
   than force-pushing or rewriting history — then let the normal
   staging→production pipeline (`DEPLOYMENT.md` §6–8) redeploy that
   revert commit. Never force-push `main` as part of a rollback.

### Confirm the rollback succeeded

The health signal is **not** "Railway shows green" alone — that only
proves the container started and `/api/health` returned `200` for
*some* build. The actual confirmation is:

1. `GET /api/health` → `status: "ok"` (`200`), **and**
2. `git_sha` in that response matches the specific prior commit's short
   SHA identified above — not just any successful-looking response.
   This is exactly why `app/api/health/route.ts` and the `/status` page
   both surface `git_sha` (master plan §32, "Deployment visibility:
   GIT_SHA in footer/status") — a rollback that silently redeployed the
   *same bad build* (e.g. because the wrong build was selected in
   Railway's history) would still show `status: "ok"`, and only the
   `git_sha` mismatch would catch it.
3. Whatever the original incident's specific symptom was (see
   `INCIDENT_RESPONSE.md`'s per-symptom checklist) is actually gone —
   the healthcheck passing is necessary but not sufficient; it only
   covers process liveness, database reachability, and the one
   regulatory-dataset invariant, not the full space of things a bad
   deploy could break.

There is no automated alerting or error-tracking dashboard to confirm
against today — master plan §41 still lists "Sentry/error tracking" as
an open owner decision, and none is adopted in this codebase yet (grep
confirms no `@sentry/*` dependency in `package.json`). Confirmation
today is the manual health/status check above plus a manual smoke pass
of the specific feature the incident affected, not an automated "error
rate back to baseline" signal.

## 2. Database-side rollback — the distinction that matters

**Migrations in this codebase are forward-only** (master plan §12,
§43). A "database rollback," in the sense of reverting an applied
migration to restore a prior schema shape, is not a supported operation
and must never be attempted here. This is stated as clearly as possible
because conflating it with the application-code rollback above is a
real production mistake, not a pedantic distinction:

- **If application code is rolled back to an older commit while the
  database schema has already moved forward** (a newer migration
  applied since that commit was built), the rollback is safe **only
  when every migration applied since then was additive** — a new
  nullable column, a new table, a new index, a new RLS policy that
  doesn't remove a capability the old code relies on. The old
  application code simply doesn't know about the new column/table and
  ignores it; nothing breaks. This is the expected, common case: master
  plan §43 itself notes "early phases additive so abort stays cheap,"
  and CLAUDE.md's protected-zone rules plus §42's escalation
  requirement for "a destructive database change" exist specifically to
  keep destructive migrations rare and gated, which is what keeps this
  assumption usually true.
- **If a migration since the target commit was destructive** (dropped
  or renamed a column/table the old code reads or writes, tightened a
  constraint the old code's writes would now violate), rolling back
  application code alone, without a compensating fix, **will break the
  old code against the new schema** — the exact mistake this section
  exists to prevent. Because master plan §42 requires human escalation
  before any destructive database change lands in the first place, this
  situation should be rare and, when it does happen, already reviewed —
  but "already reviewed" does not mean "safe to app-rollback past
  without checking." Before rolling back application code past a
  destructive migration, explicitly confirm the target commit's code is
  still compatible with the *current* schema, not the schema as it
  existed when that commit was written.
- **If the actual problem is a bad migration itself** (not bad
  application code) — the fix is a **new, forward corrective
  migration**, never editing the already-applied migration file and
  never a schema "down" operation. This mirrors the exact discipline
  `BACKUP_RESTORE.md` documents for the regulatory dataset ("regulatory
  datasets roll back by activation-flip migration, never row
  mutation") and master plan §43's general data principle ("append-only
  designs... make undo a status flip, not a delete"). A bad migration
  that added a bad constraint gets a new migration that fixes the
  constraint; a bad migration that corrupted data gets a new migration
  (or a targeted, reviewed data-fix script) that corrects it forward —
  the applied migration itself stays in the history, immutable, exactly
  like every other applied migration.

If a genuine data-loss incident (not just "the wrong code is running")
is in play, this document is not the right starting point —
`BACKUP_RESTORE.md`'s recovery decision tree covers that case
specifically (PITR vs. logical dump vs. roll-forward vs. the
regulatory-pipeline re-derivation path), and this rollback procedure
and that one are meant to be read together when both an application
rollback and a data question are on the table at once.

## 3. Staging-first rehearsal

Master plan §43's "staging always one step ahead" applies to rollback
rehearsal the same as it applies to forward deployment (`DEPLOYMENT.md`
§5): **rehearse the redeploy-previous-build action on staging before
trusting it for a real production incident.** Concretely, once a
staging Railway project exists: deploy two consecutive builds to
staging, then exercise §1's "redeploy previous build" path to go back
to the first one, and confirm via §1's health-signal check that it
actually landed the older `GIT_SHA` — this is the literal P12
rehearsal master plan §43 names, and it has not happened yet in this
environment (see the status note at the top of this document).

## Related documents

- `docs/plans/MASTER_PLAN.md` §43 (Rollback Strategy, in full), §12
  (forward-only migrations), §42 (destructive-change escalation), §44
  (production-readiness checklist).
- [`DEPLOYMENT.md`](./DEPLOYMENT.md) — the forward deployment procedure
  this document is the inverse of; environment/build/healthcheck
  details are not repeated here.
- [`BACKUP_RESTORE.md`](./BACKUP_RESTORE.md) — the database-side
  recovery decision tree for actual data-loss incidents, as distinct
  from "the wrong code is running" (this document's real subject).
- [`INCIDENT_RESPONSE.md`](./INCIDENT_RESPONSE.md) — how to recognize
  that a rollback is the right response in the first place.

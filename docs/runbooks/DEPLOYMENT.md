# Deployment runbook

This is the P12 deployment runbook named in
[`docs/plans/MASTER_PLAN.md`](../plans/MASTER_PLAN.md) §29 ("Railway")
and §31 ("CI/CD"), and checked in §44's production-readiness list
("Railway healthy... alerts tested"). It sits alongside
[`ROLLBACK.md`](./ROLLBACK.md) (what to do when a deployment goes bad),
[`BACKUP_RESTORE.md`](./BACKUP_RESTORE.md) (the database side of
recovery), [`SECRET_ROTATION.md`](./SECRET_ROTATION.md) (the
credentials this procedure depends on), and
[`INCIDENT_RESPONSE.md`](./INCIDENT_RESPONSE.md) /
[`OPERATIONAL_DIAGNOSTICS.md`](./OPERATIONAL_DIAGNOSTICS.md) (what to do
once something is live and misbehaving).

**Status as of 2026-09-03**: the production Railway deployment is
**live and healthy** at `https://snowkap-cbam-production.up.railway.app`.
`/api/health` returns `{"status":"ok"}` with `database`,
`active_regulatory_dataset`, `app_url` and `product_schema` all `ok`, and
its `git_sha` matches the deployed commit. The 2026-08-30 note quoted
below, which recorded a platform-level `502` and concluded that nothing
in this document had ever been executed successfully, is **superseded**:
the deploy path described here has since been executed, and the
environment matrix it defines (including `APP_URL`, whose absence caused
a separate class of failure) is configured.

What remains genuinely unproven, and must not be read as covered by the
above: **rollback has never been rehearsed** (see
[`ROLLBACK.md`](./ROLLBACK.md)), and **no restore has ever been performed
against a hosted project** (see [`BACKUP_RESTORE.md`](./BACKUP_RESTORE.md)).

The original 2026-08-30 status note, retained for provenance:

> **Status, honestly, as of 2026-08-30 (corrected — see below)**: a
> production Railway project *does* now exist, owner-provisioned, at
> `https://snowkap-cbam-production.up.railway.app` — but it is currently
> **down**: every request (root and `/api/health` alike) returns
> Railway's own platform-level `502 Bad Gateway` / "Application failed to
> respond" page, meaning the container itself never successfully bound to
> a port to answer any request at all (see
> `docs/plans/P13_RELEASE_READINESS_REPORT.md` §29 for the full,
> repeatedly-reconfirmed evidence, including live Request IDs). This
> session has no Railway CLI/dashboard/API access, so the actual deploy
> logs, build output, or environment-variable configuration cannot be
> inspected from here — see that same §29 for the two most plausible,
> code-verified failure theories (a missing `NEXT_PUBLIC_SUPABASE_URL`/
> `NEXT_PUBLIC_SUPABASE_ANON_KEY` Docker build-arg, or a missing
> `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` runtime variable failing the
> healthcheck) — neither is confirmed, only plausible from this repo's own
> config files. No staging Railway project or staging/production Supabase
> project exists yet. **Nothing in this document has been executed
> successfully against a real Railway environment** — the one real
> deployment that exists has never been observed to work. This document
> was originally written (2026-08-29) before any Railway project existed
> at all, framed as "no Railway project is connected" throughout; that
> framing is now stale wherever it appears below and should be read as
> "a Railway project exists but has never yet been observed healthy," not
> "no Railway project exists." It remains written to be immediately
> actionable the moment the deployment is fixed — every step below is a
> description of a ready procedure, derived directly from this repo's
> actual `Dockerfile`, `railway.json`, `.github/workflows/ci.yml`,
> and `app/api/health/route.ts` (not an invented design), not a record of
> a completed deployment. Where this document distinguishes "designed"
> from "verified locally," that distinction is real — see the "Local
> verification, honestly" section near the end.

## 1. Pre-deploy gates

Every deployment — staging or production — starts from a commit that
already passed the same gates `.github/workflows/ci.yml` enforces on
every push to `main` and every pull request (public PR gate, no secrets
required):

```
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm exec playwright install --with-deps chromium
pnpm exec playwright test        # builds the app itself, runs the smoke suite against it
pnpm audit --audit-level high    # blocking since P11 (see ci.yml's own comment on this step)
# secret scan (ci.yml's inline pattern scan over tracked files)
```

`pnpm regulatory:verify` is **not** part of this gate — it needs
`SUPABASE_DB_PASSWORD` and a Python environment
(`scripts/regulatory/requirements.txt`), and per CLAUDE.md and
`README.md` it stays a locally-run / manually-dispatched gate. Run it
by hand before any deployment that touches
`src/domain/regulatory/`, `src/infrastructure/regulatory/`,
`supabase/migrations/*.sql`, or the ACTIVE `default_emission_values`
dataset itself, and confirm `RESULT: VALID` before proceeding — per
CLAUDE.md's protected-zone rule, this is not optional for a regulatory-
touching change regardless of what CI ran.

Never deploy a commit CI hasn't run green against, and never deploy
directly from a local working tree with uncommitted changes — the
`GIT_SHA` baked into the image (see below) is only meaningful as a
deployment-visibility signal if it names a real, reviewed commit.

## 2. How Railway builds this app

`railway.json`'s `build.builder` is `DOCKERFILE`, pointing at the
repo-root `Dockerfile` — Railway does not use Nixpacks or any other
auto-detected builder for this service; the Dockerfile is authoritative.

The Dockerfile is a three-stage build (see the file's own header
comment, citing master plan §29: "pinned Node LTS, corepack-pinned
pnpm, non-root user, standalone output"):

1. **`deps`** — `node:22-slim`, `corepack enable`, `pnpm install
   --frozen-lockfile` against `package.json` / `pnpm-lock.yaml` /
   `pnpm-workspace.yaml` only (so this layer caches across builds that
   don't touch dependencies).
2. **`build`** — copies `node_modules` from `deps`, copies the full
   source, accepts a `GIT_SHA` build arg (default `unknown`), sets it
   as `ENV GIT_SHA`, then runs `pnpm build` (`next build`, followed by
   the `postbuild` script `scripts/build/copy-standalone-assets.mjs`,
   which copies `.next/static` and `public/` into `.next/standalone` —
   required because Next's `output: "standalone"` mode, set in
   `next.config.ts`, does not include those on its own).
3. **`run`** — a fresh `node:22-slim` layer (nothing from the `build`
   stage's `node_modules`/build tooling carries over), creates a
   non-root `nextjs` user/group (uid/gid 1001), copies **only**
   `.next/standalone` from the `build` stage (chowned to `nextjs`),
   switches to that user, exposes port 3000, sets `PORT=3000` /
   `HOSTNAME=0.0.0.0`, and runs `node server.js`.

**`GIT_SHA` is a build arg, not a runtime secret.** Railway (or
whatever triggers the build) must pass `--build-arg
GIT_SHA=<the deploying commit's SHA>` — in Railway's own UI/config this
is a "Build Argument," configured per-service, sourced from the commit
Railway is building (Railway exposes the deploying commit SHA as
context it can template into build args; confirm the exact mechanism
in the Railway dashboard when the service is first created, since this
has not been done in this environment yet). Without it, the image
silently falls back to `GIT_SHA=unknown`/`dev` and the deployment-
visibility guarantee (`/api/health`'s `git_sha` field, the `/status`
page's "Version" card) goes dark — this is exactly the failure mode
`app/status/page.tsx`'s own doc comment calls out ("never a fabricated
commit hash when the env var is unset").

There is no Docker `HEALTHCHECK` instruction in the image deliberately
— see the Dockerfile's own comment: Railway's `healthcheckPath` (below)
is the single health-check mechanism, so a second, independent one
inside the image can't ever disagree with it.

## 3. Environment variables

Read from `.env.example`, `next.config.ts`, and every
`process.env.*` reference in `src/` and `app/` — nothing below is
invented; each row states what actually reads it today.

| Variable | Where it's used | Server-only or public | Set on |
| --- | --- | --- | --- |
| `SUPABASE_URL` | `src/infrastructure/config/env.ts` → `src/infrastructure/supabase/client.ts` (the protected regulatory adapter) and `server-client.ts` | Server-only | Railway runtime env (both `web` service environments) |
| `SUPABASE_SERVICE_ROLE_KEY` | Same as above, plus `src/infrastructure/supabase/admin-client.ts` (`inviteUserByEmail` only) | Server-only, bypasses RLS — see `SECRET_ROTATION.md` | Railway runtime env |
| `NEXT_PUBLIC_SUPABASE_URL` | `src/infrastructure/supabase/browser-client.ts` | Public — inlined into the client bundle at **build** time | Railway **build** args/env (not just runtime — see caveat below) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same as above | Public by design (RLS-enforced — see `.env.example`'s own comment) | Railway **build** args/env |
| `GIT_SHA` | Dockerfile `ARG`/`ENV`, surfaced via `next.config.ts`'s `NEXT_PUBLIC_GIT_SHA`, read by `app/api/health/route.ts` and `app/status/page.tsx` | Public (a commit hash, not a credential) | Passed as a Docker build arg per deploy (see §2) |

**The `NEXT_PUBLIC_*` build-time caveat, stated plainly because it's
the easiest mistake to make**: Next.js inlines `NEXT_PUBLIC_*`
variables into the client JavaScript bundle **at `next build` time**,
not at container start. Setting them only as Railway *runtime*
variables (visible to `node server.js` via `process.env`) has no effect
on the already-built client bundle — they must be present in the
build environment Railway's Dockerfile build runs in.

**Update, 2026-08-29 — confirmed live, no longer just a caveat.** A
real `docker build` of this Dockerfile failed with exactly the
predicted symptom: `next build`'s static-generation phase prerenders
every `app/**/page.tsx`, and every authenticated page's
`getServerSupabaseClient()` call throws
`"NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be
configured"` before Next's automatic dynamic-rendering bailout ever
gets a chance to kick in — so the whole build failed, not just one
page. The Dockerfile now declares `ARG`/`ENV NEXT_PUBLIC_SUPABASE_URL`
and `ARG`/`ENV NEXT_PUBLIC_SUPABASE_ANON_KEY` in the `build` stage,
mirroring `GIT_SHA`'s existing pattern — confirmed fixed by a
successful local build afterward. **What still needs confirming at
first real Railway setup**: whether Railway actually forwards its
configured project variables through to this service's Docker build
step as matching-named build args (Railway's documented behavior is
that it does, for `ARG`s whose names match a configured variable — the
same mechanism `GIT_SHA` already relies on — but this repo has not yet
had a real Railway project to confirm it against). If it turns out
Railway does *not* auto-forward them for some reason, the fallback is
passing them as explicit `--build-arg`s in whatever triggers the
build, the same way `GIT_SHA` is documented above (§2) — the Dockerfile
side of that fallback is already done either way.

**`SUPABASE_DB_PASSWORD` is never a Railway runtime variable.** Master
plan §29 states this explicitly ("pipeline/CI-only, never runtime"),
and nothing in `app/` or `src/` reads it — only
`scripts/regulatory/*.py` does, via `pnpm regulatory:verify` and the
data-loading pipeline, run locally or from a future secret-bearing CI
gate (§31), never from the deployed `web` service. Do not add it to the
Railway service's environment.

**`APP_URL` — a real, currently-open gap, not invented for this
document.** `app/team/actions.ts`'s `getAppOrigin()` already reads
`process.env.APP_URL` today (as of the in-progress P11 work in this
working tree) and prefers it unconditionally when set, falling back to
a trusted-local-host check otherwise — its own doc comment states
plainly that `APP_URL` "is not yet set anywhere" and names the real fix
as setting it "once this app's environment matrix is resolved (master
plan §41, still an open owner decision)." This document does not
invent a value for it; when a production domain exists, set
`APP_URL=https://<the real domain>` on the Railway `web` service before
relying on any auth-redirect flow (invitations, password reset) in that
environment, and update `.env.example` in the same change that does —
`SECRET_ROTATION.md`'s own convention for a newly-adopted variable.

**`LOG_LEVEL` is named in master plan §29's environment matrix but is
not read anywhere in this codebase today** (`src/infrastructure/observability/logger.ts`
logs every call unconditionally — there is no level-filtering logic to
configure). Do not set it; it would currently do nothing. Add it to
this table, and to `.env.example`, only in the same change that
actually implements level filtering.

**Master plan §29 also names "SIGTERM graceful shutdown (stop intake,
drain, close pool)" and it is not implemented today** — a repo-wide
search finds no `process.on("SIGTERM", ...)` (or any `process.on`
handler) anywhere in `src/`, `app/`, or the Dockerfile's `CMD`. The
standalone `server.js` Next generates receives whatever Node's default
signal handling does (process exit, no explicit drain of in-flight
requests or the Supabase client's connection pool) when Railway sends
`SIGTERM` ahead of a redeploy or restart. This is the same kind of gap
as `LOG_LEVEL` above — named here because it's true, not implemented
elsewhere in this repo, and worth fixing before relying on zero-downtime
redeploys in production; it is not part of this document's docs-only
scope to add.

## 4. Healthcheck

`railway.json`'s `deploy` block wires Railway's healthcheck to
`GET /api/health`, `healthcheckTimeout: 30` (seconds), with
`restartPolicyType: "ON_FAILURE"` and `restartPolicyMaxRetries: 3` — a
container that never reports healthy within 30 seconds is restarted, up
to 3 times, before Railway gives up and leaves it failed.

`app/api/health/route.ts` checks, in order: process liveness (it
responded at all), Supabase reachability (via the service-role client),
and the one regulatory invariant a broken deploy could silently
violate — exactly one `ACTIVE` `default_emission_values` dataset
(`checkActiveDefaultEmissionValuesDataset`, shared with the `/status`
page so the two can never disagree about what "ok" means). Response
shape:

```json
{
  "status": "ok" | "degraded",
  "git_sha": "<the deployed build's GIT_SHA, or \"dev\">",
  "checks": {
    "database": "ok" | "error",
    "active_regulatory_dataset": "ok" | "missing" | "duplicate" | "error"
  }
}
```

HTTP status is **200 only when `status: "ok"`, 503 for every degraded
case** (`result.status === "ok" ? 200 : 503` — the route's own mapping,
with no partial-credit middle state). Railway's healthcheck treats a
non-2xx response the same as unreachable, so any `degraded` response
triggers the restart policy above — which will not fix a genuine
Supabase outage or dataset misconfiguration (see
`INCIDENT_RESPONSE.md`'s per-state triage), but is exactly the correct
behavior for a transient startup race or a bad container that a fresh
process might clear.

## 5. Supabase Auth settings — a required, not-yet-actionable production step

**P13 review, finding S3.** `supabase/config.toml`'s `[auth.email]
enable_confirmations = false` (and `[auth.sms] enable_confirmations =
false`) governs the **local** `supabase start` dev stack only — this
file has no effect on a staging or production Supabase project's own
Auth configuration, which is set per-project via the Supabase dashboard
(Authentication → Providers → Email) or the Management API, entirely
outside this repo's version control. Leaving confirmations off locally
is deliberate and correct (it lets local sign-up/sign-in flows work
without a real mail server); it is not evidence about, and must not be
mistaken for, what staging or production actually has configured.

Master plan §14 is explicit that the intended design is "confirmations
on, hardened password policy (the stock 6-char local default is
explicitly raised)" — this document cannot verify or set that today,
for the same reason the rest of this runbook is "designed but
unexecuted" per its own header: **no staging or production Supabase
project exists yet in this environment.** This is recorded here as a
required step for whoever provisions those projects (master plan §41's
"Production Supabase/Railway/DNS provisioning" owner-input item), not
as something this codebase change can complete on its own:

- [ ] Staging Supabase project: Authentication → Providers → Email →
      "Confirm email" **enabled**.
- [ ] Production Supabase project: same setting, independently (§6
      below — staging and production are separate projects; this is
      not inherited from one to the other).
- [ ] Password policy: raise the minimum length beyond Supabase's stock
      6-character default, per master plan §14's "hardened password
      policy" language, on both projects independently.
- [ ] Re-verify `supabase/config.toml`'s local settings are unchanged by
      this (they should stay `enable_confirmations = false` for local
      dev — do not "fix" this file itself, it was never the actual gap).

Do not claim this finding "fixed" until each box above is checked
against a real project and re-verified by an authenticated sign-up
attempt actually requiring email confirmation before first sign-in.

## 6. Where staging and production diverge

Per master plan §29: **staging and production are separate Railway
environments *and* separate Supabase projects** — not one Railway
project with two environment variable sets pointed at the same
database, and not one Supabase project shared across both. This
matters for this runbook specifically because it means every step
below (migrations, env vars, the healthcheck, GIT_SHA visibility) is
duplicated per environment, never shared.

Per §29/§31's flow:

```
merge to main
  → CI green (public PR gate, above)
  → staging migrations applied
  → staging auto-deploys from main
  → [staging smoke/verification — this document, staging environment]
  → gated manual production promotion (owner participation, per §29/§34)
  → [production smoke/verification — this document, production environment]
```

Migrations are **never** applied at app startup (§29) — they are a
separate, explicit step before the app deploy that depends on them,
staging first, always (§43: "staging always one step ahead").
Production migrations go through "the gated runbook" master plan §30
names — that gated migration-promotion runbook is not itself the
subject of this document (this document covers the *application*
deploy) and does not yet exist as a separate written procedure; treat
"apply to staging, verify, then apply the same migration to production
with owner sign-off" as the standing rule per §29/§43 until a dedicated
migration-promotion runbook is written.

## 7. Deployment procedure (staging)

1. Confirm the commit on `main` passed CI (§1) — check the GitHub
   Actions run for that commit, not just that CI "usually" passes.
2. Apply any new files under `supabase/migrations/*.sql` to the
   staging Supabase project (forward-only — see `ROLLBACK.md`'s
   database section for why this order matters).
3. Let Railway's staging `web` service auto-deploy from `main` (per
   §29), or trigger it manually if auto-deploy is disabled for this
   service — either way, confirm the build used the exact commit SHA
   expected as its `GIT_SHA` build arg (§2).
4. Watch the Railway deploy's healthcheck (§4) go green within the
   30-second/3-retry window. If it doesn't, the deploy fails and the
   previous build stays live (Railway does not cut traffic to a build
   that never reports healthy) — see `INCIDENT_RESPONSE.md` for triage,
   not this document.
5. Once green, verify by hand, not just by trusting the platform:
   - `curl https://<staging-url>/api/health` → `status: "ok"`, `200`,
     and `git_sha` matching the deployed commit's short SHA.
   - Open `/status` as a logged-in member → "Version (GIT_SHA)" card
     matches the same commit; "Regulatory foundation" card shows
     `Exactly one ACTIVE dataset` (green).
   - Skim the first minute of Railway logs for unexpected `"level":"error"`
     lines (see `OPERATIONAL_DIAGNOSTICS.md` for how to read them).

## 8. Deployment procedure (production promotion)

Production promotion requires owner participation per master plan §29
("production promotes via runbook with owner participation") and §34.
It is a **promotion of the already-staging-verified build**, not a
fresh build from a possibly-drifted source state — reuse the exact
image/commit that just passed staging verification above rather than
re-triggering a new build from `main` a second time (which could pick
up a commit merged in the gap between staging verification and
production promotion). Railway's environment-promotion or manual
redeploy-by-commit mechanism is how this is done in practice; the exact
click-path depends on the Railway project's configuration, which does
not exist yet in this environment to document precisely.

1. Owner sign-off to proceed (per §29/§34 — this is a human gate, not
   an automatic one).
2. Apply the same migrations already applied to staging in step 7.2,
   now to the production Supabase project — staging-first, already
   proven, per §43.
3. Promote the staging-verified build to the production Railway
   environment.
4. Repeat step 7.4–7.5's healthcheck and manual verification against
   the production URL.
5. Confirm `GIT_SHA` on `/status` and `/api/health` matches the
   intended release commit in production specifically, not just that
   staging looked right earlier.

If anything in steps 3–5 goes wrong, stop and go to `ROLLBACK.md`
rather than attempting to force the deploy through.

## 9. Local verification, honestly

`README.md` documents that this repo's Dockerfile/`railway.json`
combination has previously been "verified to build and serve correctly
locally" via:

```bash
docker build --build-arg GIT_SHA=$(git rev-parse --short HEAD) -t snowkap-cbam:local .
docker run --rm -p 3000:3000 --env-file .env snowkap-cbam:local
```

**Update, 2026-08-29 (P13 continuation, Railway now available):
re-confirmed a third time, fresh, on this same day** -- Docker's data
root has since moved to `D:\DockerDesktopWSL` (off the `C:` drive that
caused every failure below), and this pass ran `docker build` at HEAD
`fd516b3` with the real `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`
build args, producing a 391 MB `snowkap-cbam:p13-verify` image (every
route in the app tree built cleanly, no route-level build errors). Ran
the container, confirmed independently:
`GET /api/health` → `{"status":"ok","git_sha":"fd516b3","checks":{"database":"ok","active_regulatory_dataset":"ok"}}`
(git_sha matches the build-arg exactly); `docker exec ... whoami`/`id`
→ `nextjs` (uid 1001, gid 1001), not root; and a direct grep of
`.next/static` inside the running container for the real
`SUPABASE_SERVICE_ROLE_KEY` value found zero matches while the same
grep for the (safe-to-expose) `NEXT_PUBLIC_SUPABASE_ANON_KEY` value
found it correctly inlined -- confirming the client bundle carries the
publishable key but not the service-role secret. Container stopped and
removed after verification.

**Update, 2026-08-29 (later the same day): re-confirmed for real, after
the disk-exhaustion blocker below was resolved (C: freed to ~38 GB).**
A real `docker build` (against the fixed Dockerfile — §3's
`NEXT_PUBLIC_SUPABASE_*` build-arg update) completed successfully,
producing a 391 MB `snowkap-cbam:p12-local` image. The container was
run, `GET /api/health` returned
`{"status":"ok","git_sha":"<HEAD short SHA>","checks":{"database":"ok","active_regulatory_dataset":"ok"}}`,
and `docker exec ... whoami` confirmed the process runs as the
non-root `nextjs` user (uid 1001), not root. This closes the local
half of "Local Docker build validation" as a genuinely re-verified,
current fact — not the historical README claim below, and not
something still open. What follows is preserved as the honest record
of the three earlier same-day failures that blocked this before the
disk was freed, since the root cause (and the general lesson about
this host's disk-space fragility) remains worth keeping:

1. An earlier P12 Docker-validation pass *did* attempt a real
   `docker build` — it ran through `corepack enable`, created the
   `nextjs` user, and got partway into `pnpm install` (224 of 225
   packages, per that pass's own report) before failing on disk
   exhaustion. That report and its logs are not checked into this repo,
   so this document cites the package count as *reported*, not as
   something independently re-derived from an artifact this session
   could inspect.
2. A later same-day check (documented previously in this section, and
   in `BACKUP_RESTORE.md`'s 2026-08-29 handoff) found the engine itself
   unreachable — `docker version`/`docker info` both returned
   `500 Internal Server Error`, with `Get-PSDrive C` showing ~365 MiB
   free — the point at which the host's `C:` drive had tipped from
   "nearly full" to effectively full.
3. This fix, re-checked live rather than assumed (`docker version`,
   `docker info`, `wsl -l -v`, `Get-PSDrive C`, 2026-08-29 14:34 local):
   `docker version`'s client call succeeds but the daemon call now fails
   with `open //./pipe/dockerDesktopLinuxEngine: The system cannot find
   the file specified` — a colder failure than #2's 500 error, matching
   `wsl -l -v` showing the `docker-desktop` distro as `Stopped` (it
   never came up this session, rather than coming up and then dying).
   `C:` free space at the same moment: **0.493 GB**.

These are not three unrelated blockers — they're the same root cause
(host disk exhaustion, with Docker's ~31 GB WSL VHDX itself living on
`C:`, at `C:\Users\rahil.naik\AppData\Local\Docker\wsl\disk\docker_data.vhdx`)
presenting differently depending on how far the engine got before it
was starved: far enough to install 224/225 packages in #1, far enough
to answer with an HTTP 500 in #2, not far enough to open its own named
pipe in #3. **This fix did not attempt a build or start Docker Desktop
either**, for the same reason #1 already demonstrates concretely: with
under 0.5 GB free on the drive hosting both the OS and Docker's VHDX, a
build predictably fails at the same `pnpm install` stage before it can
prove anything about the Dockerfile itself, and there is direct
same-day precedent (`BACKUP_RESTORE.md`'s handoff: `C:` measured at
**0.01 GB free** later the same day) that pushing this host further
risks driving `C:` to literal zero, a host-stability risk out of
proportion to what a documentation-validation task should take on.

**Resolution:** once `C:` had real headroom again (freed to ~38 GB
free, per the same day's later work), the build-and-serve check above
was re-run for real and passed — see the "Update" note at the top of
this section. The three failures below were a genuine, real host-disk
blocker, not a Dockerfile defect, and are kept here as the record of
that — not as a currently-open item.

## Related documents

- `docs/plans/MASTER_PLAN.md` §29 (Railway), §31 (CI/CD), §32
  (Observability), §41 (open decisions this document names honestly),
  §44 (production-readiness checklist this document is evidence for).
- `Dockerfile`, `railway.json`, `.github/workflows/ci.yml`,
  `app/api/health/route.ts`, `next.config.ts` — the actual source this
  document describes.
- [`ROLLBACK.md`](./ROLLBACK.md) — what to do when a deployment made
  here needs to be undone.
- [`INCIDENT_RESPONSE.md`](./INCIDENT_RESPONSE.md) — first response
  when a deployed environment is unhealthy.
- [`SECRET_ROTATION.md`](./SECRET_ROTATION.md) — the credentials this
  procedure's environment variables depend on.

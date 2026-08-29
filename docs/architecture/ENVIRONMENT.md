# Environment variables

This is the environment matrix named in
[`docs/plans/MASTER_PLAN.md`](../plans/MASTER_PLAN.md) §29 ("Environment
matrix per env (runbook-documented)") — listed there as a line-item
intent, never actually written out on its own until now. It covers
**every environment variable this codebase actually reads today**,
found by grepping `process.env.` across `src/`, `app/`, `next.config.ts`,
`Dockerfile`, `scripts/`, and `tests/`, plus `os.environ.get(...)` across
`scripts/regulatory/*.py` — nothing hypothetical, nothing from the master
plan's aspirational list that the code doesn't actually consume. Two
variables §29 names — `LOG_LEVEL` and an error-tracking DSN — are
deliberately **absent** from this document: neither is read anywhere in
the code as of this writing. Both remain open owner decisions (master
plan §41: "Sentry/error tracking · log drain · ... · rate-limit store —
P11"); when either is actually adopted, add it here in the same change
that introduces the read, following the shape below.

**Extend this document, don't guess ahead of it.** When a new
`process.env.*` (or `os.environ.get(...)`) read is added anywhere in the
codebase, add its row and section here in the same commit — and add it
to [`.env.example`](../../.env.example) too if it's something a
developer or deploy pipeline needs to actually set (see "Cross-check
against `.env.example`" below for what qualifies).

## How to read this document

- **Build-time** — baked into the compiled output (a Docker image layer,
  or a Next.js client bundle) and fixed from that point on; changing it
  requires a rebuild, not just a redeploy.
- **Runtime** — read fresh from the process environment each time the
  relevant code path executes; changing it only requires restarting the
  process (or, for Railway, redeploying with the new value set — Railway
  does not hot-reload env vars into a running container, per
  [`docs/runbooks/SECRET_ROTATION.md`](../runbooks/SECRET_ROTATION.md)).
- **Client-exposed** — `NEXT_PUBLIC_`-prefixed; Next.js inlines these
  into the JavaScript bundle shipped to the browser. Anyone who opens
  dev tools can read the value. Never put a real secret behind this
  prefix.
- **Server-only** — never leaves the server process. Everything in this
  document that is *not* `NEXT_PUBLIC_`-prefixed falls here by
  construction (Next.js only inlines the prefixed ones).
- **Distinct per environment** — per master plan §29, staging and
  production are separate Railway environments **and** separate
  Supabase projects. A variable marked "must differ" here would, if
  shared, either point one environment's traffic at the other's
  database or silently defeat the isolation the two-project design
  exists for.

## At a glance

| Variable | Build/Runtime | Exposure | Read at | Local default | Distinct per environment? |
|---|---|---|---|---|---|
| `SUPABASE_URL` | Runtime | Server-only | `src/infrastructure/config/env.ts:49` | none — must be set | **Must differ** (staging/production are separate Supabase projects) |
| `SUPABASE_SERVICE_ROLE_KEY` | Runtime | Server-only, secret | `src/infrastructure/config/env.ts:49` | none — must be set | **Must differ** |
| `SUPABASE_DB_PASSWORD` | Runtime (pipeline/CI only, never app runtime) | Server-only, secret | `scripts/regulatory/*.py` (3 scripts) | none — must be set | **Must differ** |
| `NEXT_PUBLIC_SUPABASE_URL` | Build-time (inlined) | Client-exposed | `browser-client.ts:28`, `server-client.ts:36`, `proxy.ts:41` | none — must be set | **Must differ** (same value as `SUPABASE_URL` in whichever environment) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Build-time (inlined) | Client-exposed (safe by design — RLS-enforced) | `browser-client.ts:31`, `server-client.ts:39`, `proxy.ts:44` | none — must be set | **Must differ** |
| `APP_URL` | Runtime | Server-only | `app/team/actions.ts:147` | unset (falls back to trusted-local-host header detection) | **Must differ** (staging/production domains differ) |
| `NODE_ENV` | Runtime (Next.js/Node-managed) | Server-only | `browser-client.ts:48`, `server-client.ts:67`, `proxy.ts:64`, `switch-org-action.ts:53` | `development` (set by `next dev`) | Safe to share — same value (`production`) in both |
| `GIT_SHA` | Build-time ARG, then baked as runtime `ENV` | Server-only | `next.config.ts:16`, `app/status/page.tsx:147`, `app/api/health/route.ts:63` | unset → `"dev"` | N/A — unique per deploy by nature (the commit SHA), not a shared/differ question |
| `PORT` | Runtime (platform-managed) | Server-only | consumed by the Next standalone `server.js` itself, not application source | `3000` (Dockerfile `ENV PORT=3000`) | Safe to share |
| `HOSTNAME` | Runtime (platform-managed) | Server-only | consumed by the Next standalone `server.js` itself | `0.0.0.0` (Dockerfile `ENV HOSTNAME=0.0.0.0`) | Safe to share |
| `SUPABASE_LOCAL_URL` | Runtime, test-only | Server-only | 10 files: 4 `tests/integration/*-isolation.test.ts` + 3 other `tests/integration/*.test.ts` + 3 `scripts/perf/*.ts` (full list in §4 below) | `http://127.0.0.1:54321` | N/A — local/CI dev tooling only, never staging/production |
| `SUPABASE_LOCAL_ANON_KEY` | Runtime, test-only | Server-only | 8 files: all 7 test files above, plus `scripts/perf/measure-p11-perf.ts` (a read-only perf pass — it does need the anon key; `seed-p11-perf-setup.ts`/`cleanup-p11-perf.ts` don't) | fixed public Supabase CLI demo JWT | N/A |
| `SUPABASE_LOCAL_SERVICE_ROLE_KEY` | Runtime, test-only | Server-only | 9 files: all 7 test files above, plus `scripts/perf/{seed-p11-perf-setup,cleanup-p11-perf}.ts` (writes/teardown need it; `measure-p11-perf.ts` doesn't) | fixed public Supabase CLI demo JWT | N/A |
| `CI` | Runtime, test-only | Server-only | `playwright.config.ts:18,19,47` | unset locally | N/A — set automatically by GitHub Actions, never configured by hand |

That's **14** environment variables actually read by this codebase.
`NEXT_PUBLIC_GIT_SHA` is a fifteenth name that appears in the code but
is **produced**, not read — see "Declared but not independently read"
below for why it's documented separately rather than counted here.

## 1. Supabase — data plane

### `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`

Read together, validated by a zod schema, in
[`src/infrastructure/config/env.ts`](../../src/infrastructure/config/env.ts)
(`loadSupabaseEnv`, defaulting its `source` parameter to `process.env`).
Consumed by the two service-role Supabase clients:
`src/infrastructure/supabase/client.ts` (the protected regulatory
adapter's general-purpose client — RLS bypassed entirely, ADR-0005) and
`src/infrastructure/supabase/admin-client.ts` (deliberately narrower —
Auth admin API only, `inviteUserByEmail`). Both are lazily constructed
and memoized, so a missing/invalid value throws only when a caller first
tries to use Supabase, not at module import time (this is load-bearing —
see `tests/integration/module-load.test.ts`, which asserts importing
these modules never throws even with no env configured).

`SUPABASE_SERVICE_ROLE_KEY` is a secret: it bypasses Row Level Security
on every table. Never expose it client-side, never log it. See
[`docs/runbooks/SECRET_ROTATION.md`](../runbooks/SECRET_ROTATION.md) for
the rotation procedure.

**Differs by environment**: local points at the CLI-managed local
Postgres/GoTrue stack (`http://127.0.0.1:54321`, per
`supabase/config.toml`'s `[api] port = 54321`); staging and production
each point at their own separate hosted Supabase project (master plan
§29: "staging and production are separate Railway environments **and**
separate Supabase projects"). Sharing this pair between staging and
production would mean staging traffic writes to the production
database — never do this.

### `SUPABASE_DB_PASSWORD`

Read via `os.environ.get("SUPABASE_DB_PASSWORD")` in all three regulatory
pipeline scripts:
`scripts/regulatory/verify-definitive-regulatory-data.py:132`,
`scripts/regulatory/load-definitive-default-values.py:944`,
`scripts/regulatory/reconcile-loaded-regulatory-data.py:147`. This is
the direct Postgres connection password (Project Settings → Database),
distinct from the service-role API key above — the pipeline scripts
combine it with a base connection URL read from
`supabase/.temp/pooler-url` (created by `supabase link`, gitignored) and
pass it to `psycopg.connect(...)` separately, never concatenating it
into a logged connection string.

Per master plan §29: **"pipeline/CI-only, never runtime"** — no
application code path reads this variable; only `pnpm regulatory:verify`
and the two loading/reconciliation scripts do, and only when a human (or
a future secret-bearing CI job) runs them directly.

**Differs by environment**: same reasoning as `SUPABASE_URL` — each
Supabase project has its own database password.

### `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Read in three places, all following the same "read, validate,
fail-safe-or-throw" shape:
`src/infrastructure/supabase/browser-client.ts:28,31` (throws if
missing — this is the browser-side session client, so a misconfigured
environment must not silently produce a client that looks valid),
`src/infrastructure/supabase/server-client.ts:36,39` (throws, same
reasoning, for the SSR session client used in Server Components/Actions),
and `proxy.ts:41,44` (fails *open* to an unauthenticated response rather
than throwing — deliberately different, since a thrown error here would
break every single request the proxy runs on, per that file's own doc
comment).

The `NEXT_PUBLIC_` prefix means Next.js inlines both values into the
client bundle **at build time** — this is intentional and safe by
design for the anon/publishable key: every read/write it performs is
still subject to Postgres RLS, unlike `SUPABASE_SERVICE_ROLE_KEY` above.
`NEXT_PUBLIC_SUPABASE_URL` is the identical value to `SUPABASE_URL` in
whichever environment you're in (same project, two names because one
feeds a browser-safe client and one feeds the service-role client).

**Differs by environment**: must differ between staging and production
for the same reason as `SUPABASE_URL` — and because these are
build-time/inlined, a rotation or environment promotion of either value
requires a rebuild, not just a config change, once a hosted build
pipeline exists (see `docs/runbooks/SECRET_ROTATION.md`'s note on this).

The Docker build path needs both passed explicitly as `--build-arg`s —
Next.js can only inline a `NEXT_PUBLIC_*` value that was actually
present in the build-stage process environment, and a Docker build
stage starts with none of the host's env vars. The
[`Dockerfile`](../../Dockerfile)'s build stage declares matching `ARG`
declarations (lines 42–45) for exactly this reason; omitting either
`--build-arg` produces an image whose client bundle silently has no
Supabase URL/key baked in, not a build failure.

## 2. Application runtime

### `APP_URL`

Read once, in
[`app/team/actions.ts:147`](../../app/team/actions.ts) (`getAppOrigin`),
where it is unconditionally preferred over the request's own
`x-forwarded-host`/`host` headers whenever it is set. This function
exists to build the absolute URL embedded in team-invitation emails; per
its own doc comment, without an authoritative `APP_URL`, a malicious
`X-Forwarded-Host` header on an invite request could otherwise land the
invitation link on an attacker-controlled domain. Today, `APP_URL` is
unset in every environment (local dev included), so the function falls
back to header-based origin detection — but only when the host matches
a trusted-local-host pattern; anything else falls back to a fixed
fallback origin rather than trusting an arbitrary header verbatim.

**This is a real, currently-open gap, not a hypothetical one**: master
plan §41 lists the full environment matrix (which `APP_URL` is part of)
as a still-open owner decision. Setting `APP_URL` to each environment's
real deployed origin is the durable fix this function is already
written to prefer — it just has nothing to prefer yet.

**Differs by environment**: must differ — local (`http://localhost:3000`
or `http://127.0.0.1:3000`, per `next.config.ts`'s `allowedDevOrigins`
comment on why `127.0.0.1` specifically matters for Supabase Auth
redirects locally), staging (a `*.staging.*` or equivalent Railway
domain), and production (the real public domain) are three different
values by construction — sharing one would send invitation links to the
wrong environment.

### `NODE_ENV`

Not application-specific — the standard Next.js/Node.js convention,
read directly in four places, all for the identical purpose (gating the
`secure` flag on a cookie so it isn't marked secure over plaintext
`http://localhost` in dev, but is in a real deployment):
`src/infrastructure/supabase/browser-client.ts:48`,
`src/infrastructure/supabase/server-client.ts:67`, `proxy.ts:64`, and
`components/shell/switch-org-action.ts:53`. Next.js itself sets this
automatically per command (`development` for `next dev`, `production`
for `next build`/`next start`) — it is not something a developer
usually sets by hand in `.env`, which is why it is absent from
`.env.example` (see "Cross-check against `.env.example`" below). The
Dockerfile's run stage also sets it explicitly (`ENV NODE_ENV=production`,
line 51) so the container's runtime value matches its build mode
regardless of how it's launched.

**Differs by environment**: local is `development`; CI, staging, and
production are all `production` (CI builds and runs the production
build path to smoke-test it — see `.github/workflows/ci.yml`'s "Build
and run Playwright smoke suite" step). Staging and production do **not**
need to differ from each other here — sharing `production` between them
is correct, not a gap.

### `GIT_SHA`

A Docker build **ARG**, promoted to a runtime **ENV** in both the
`build` and `run` stages of the [`Dockerfile`](../../Dockerfile) (lines
27–28 and 52–53) — this is deliberately not `.env`-configured; it comes
from the deploying commit itself. `next.config.ts:16` reads it at build
time to derive the client-exposed `NEXT_PUBLIC_GIT_SHA` (see the
dedicated section below). Two runtime call sites read it directly,
server-side, for deployment visibility (master plan §32: "GIT_SHA in
footer/status"): `app/status/page.tsx:147` (the System/status screen)
and `app/api/health/route.ts:63` (the `/api/health` response body,
which Railway's healthcheck and any deployment-verification tooling can
read). Both default to the literal string `"dev"` when unset — this is
what a local `pnpm dev`/`pnpm build` run sees, since nothing passes
`--build-arg GIT_SHA=...` outside the Docker path
([`README.md`](../../README.md)'s documented local-Docker command does:
`docker build --build-arg GIT_SHA=$(git rev-parse --short HEAD) ...`).

**Differs by environment**: not a "shared vs. distinct" question in the
usual sense — every deploy anywhere (staging or production) gets its
own value automatically, because it *is* the commit SHA being deployed.
Railway/CI is expected to pass the real deploying commit's SHA as the
build arg (per the Dockerfile's own comment); nothing in this repo does
that yet, since no Railway project is connected here.

## 3. Container / platform-managed (`Dockerfile`)

### `PORT` / `HOSTNAME`

Set in the [`Dockerfile`](../../Dockerfile)'s run stage
(`ENV PORT=3000`, line 51; `ENV HOSTNAME=0.0.0.0`, line 52) and consumed
by Next's generated standalone `server.js` itself (`.next/standalone/`),
not by any file in this repo's own source — there is no
`process.env.PORT` or `process.env.HOSTNAME` read in `src/`, `app/`, or
`scripts/`. They're documented here because Railway is expected to set
(or override) both for the running container, per master plan §29's
"`web` (Next standalone, `node server.js`, `PORT` binding)."

**Differs by environment**: safe to share the same values everywhere —
`0.0.0.0` is the correct bind address in any containerized deployment
(not just this one), and `3000` matches `railway.json`'s
`healthcheckPath` assumption and the `EXPOSE 3000` directive. Railway
may still override `PORT` per its own platform convention; the
Dockerfile's default of `3000` is what's exposed either way.

## 4. Test-only / CI-only

### `SUPABASE_LOCAL_URL` / `SUPABASE_LOCAL_ANON_KEY` / `SUPABASE_LOCAL_SERVICE_ROLE_KEY`

Optional overrides for the ten local-Postgres-backed consumers — seven
test files plus three perf scripts, not ten test files — that default
to the fixed values `supabase start` always prints for a fresh local
project: `http://127.0.0.1:54321` for the URL, and two deterministic
demo JWTs (derived from the equally-public default local `JWT_SECRET`
— not secrets, safe to commit; see
`tests/integration/organizations-isolation.test.ts`'s own header
comment for the full reasoning, and `.github/workflows/ci.yml`'s secret
scan, which explicitly allow-lists this exact JWT payload marker rather
than trusting them not to look secret-shaped). Consumers — note only
four of the seven test files actually end in `-isolation.test.ts`; the
other three are named differently and a single brace expansion across
all seven would produce three filenames that don't exist:
`tests/integration/{organizations,shipments,sharing-grants,declarations}-isolation.test.ts`,
`tests/integration/{regulatory-authenticated-read,shared-data-consumption-audit,shared-data-status-visibility}.test.ts`,
and `scripts/perf/{seed-p11-perf-setup,cleanup-p11-perf,measure-p11-perf}.ts`
(this last group's actual per-variable reads differ per script — see
the `SUPABASE_LOCAL_ANON_KEY`/`SUPABASE_LOCAL_SERVICE_ROLE_KEY` rows in
"At a glance" above, not "same files" for every variable). These exist
purely so a developer running a non-default local Supabase setup (a
different port, a Dockerized instance, etc.) can point the suites
elsewhere without editing test source.

**Differs by environment**: not applicable — these never run against
staging or production; they exist to reach a local, disposable Supabase
instance only (the test files' own header comments are explicit that
using the protected regulatory project or any hosted project for
tenancy/RLS testing is forbidden).

### `CI`

Read in `playwright.config.ts:18,19,47` to toggle
`forbidOnly`/`retries`/`reuseExistingServer` — the standard convention
GitHub Actions (and most CI platforms) set automatically to `true` on
every run; nothing in this repo sets it by hand, locally or otherwise.

## 5. Declared but not independently read

### `NEXT_PUBLIC_GIT_SHA`

Defined in `next.config.ts:15` (`env: { NEXT_PUBLIC_GIT_SHA:
process.env.GIT_SHA ?? "dev" }`) — this makes it a real, build-time
client-exposed variable in principle, per the Dockerfile's own comment
("surfaces it as `NEXT_PUBLIC_GIT_SHA`"). In practice, no component or
route in this codebase currently reads
`process.env.NEXT_PUBLIC_GIT_SHA` — both places that display the
version (`app/status/page.tsx:147`, `app/api/health/route.ts:63`) read
the server-only `GIT_SHA` directly instead, since both are server-side
code with no need for a client-inlined copy. It's documented here for
completeness (it does exist as a real env var Next.js produces) but
intentionally excluded from the "14 variables" count above and from
`.env.example`, since neither is about a variable *this codebase reads*
— it's one this codebase *writes*, currently to no reader. If a future
client component needs the version string, it already has this value
available with no further plumbing.

## Cross-check against `.env.example`

[`.env.example`](../../.env.example) documented 5 of the 14 variables
above before this change: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`SUPABASE_DB_PASSWORD`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY` — exactly the Supabase data-plane group
above, already documented thoroughly.

**Added by this change**: `APP_URL` (a real, currently-unset application
runtime variable with security-relevant fallback behavior — see its
section above) and the three `SUPABASE_LOCAL_*` test overrides (real,
actually read by ten files, previously undocumented anywhere a
developer would find them without reading test source directly).

**Deliberately left out of `.env.example`**, even though each is a real
`process.env` read documented above:

- `NODE_ENV` — Next.js sets this automatically per command; a
  developer manually setting it in `.env` is far more likely to
  misconfigure `pnpm dev` (e.g. accidentally forcing `production` and
  losing HMR) than to need it.
- `GIT_SHA`, `PORT`, `HOSTNAME` — build/runtime values the
  [`Dockerfile`](../../Dockerfile) sets (`ARG`/`ENV`) and Railway is
  expected to manage per master plan §29; `.env.example` is scoped to
  values a developer fills in for `pnpm dev`/`pnpm test`/local Docker
  runs, not container platform plumbing. `GIT_SHA` specifically is
  passed as a `--build-arg` in the documented local-Docker command
  (`README.md`), not read from `.env`.
- `CI` — set automatically by the CI platform; there is nothing to
  "fill in."

No variable in this document was found to be read by the codebase but
absent from both `.env.example` and this cross-check's reasoning above
— every real, actually-used variable is now either in `.env.example`
(if a developer/operator needs to set it) or explicitly accounted for
here (if it's platform- or tool-managed instead).

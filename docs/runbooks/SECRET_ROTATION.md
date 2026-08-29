# Secret rotation runbook

This is the P11 rotation runbook named in
[`docs/plans/MASTER_PLAN.md`](../plans/MASTER_PLAN.md) §29 ("Secrets in
Railway env + GitHub secrets; rotation runbook (P11)") and checked in
§44's production-readiness list ("rotation runbook exists"). It covers
every secret this codebase actually reads today, per
[`.env.example`](../../.env.example) and
[`src/infrastructure/config/env.ts`](../../src/infrastructure/config/env.ts) —
nothing hypothetical. **Extend this document, don't guess ahead of
it**: when a new secret is actually introduced (a Sentry DSN, a log
drain token, a rate-limit store credential — all currently pending
owner decisions per §41), add a section for it here in the same commit
that introduces it, following the shape below.

## Secrets in scope

| Variable | Secret? | Consumers today | Rotated at |
| --- | --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes — bypasses Row Level Security on every table | `src/infrastructure/supabase/client.ts` (protected regulatory adapter + `scripts/regulatory/*.py` pipeline), `src/infrastructure/supabase/admin-client.ts` (Auth admin API — `inviteUserByEmail` only) | Supabase dashboard → Project Settings → API |
| `SUPABASE_DB_PASSWORD` | Yes — direct Postgres superuser-adjacent password | `scripts/regulatory/verify-definitive-regulatory-data.py`, `scripts/regulatory/load-definitive-default-values.py`, `scripts/regulatory/reconcile-loaded-regulatory-data.py` (via `pnpm regulatory:verify` and the pipeline) | Supabase dashboard → Project Settings → Database |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Not secret by design (RLS-enforced, inlined into the client bundle on purpose — see `.env.example`'s own comment) | `src/infrastructure/supabase/browser-client.ts`, `src/infrastructure/supabase/server-client.ts` | Supabase dashboard → Project Settings → API |
| `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` | Not secret (a project URL, not a credential) — same value in both places | all four Supabase client modules above | Fixed per Supabase project; changes only if the project itself is recreated, which is not a "rotation" |

Two things this table already tells you that are easy to miss:

- **`SUPABASE_SERVICE_ROLE_KEY` has two consumers, not one.**
  `src/infrastructure/supabase/client.ts` is the protected,
  general-purpose service-role client (ADR-0005) — table access
  everywhere, RLS bypassed entirely. `src/infrastructure/supabase/admin-client.ts`
  is deliberately narrower (its own doc comment explains why: it exists
  so product code can reach `inviteUserByEmail` without opening the
  general RLS-bypass escape hatch — see the
  `UI_ALLOWED_INFRASTRUCTURE_IMPORTS` exception in
  `tests/architecture/layering-rules.ts`). Both modules read the *same*
  environment variable, so rotating the key affects both, even though
  only one of the two files is protected-zone.
- **Neither of the two real secrets reaches CI or a hosted runtime
  today.** `.github/workflows/ci.yml` runs only the public PR gate
  (typecheck, test, build, Playwright smoke, secret scan) — it declares
  no `secrets:` and needs none; the credential-dependent test suites
  self-skip (see `tests/integration/module-load.test.ts`). The
  secret-bearing CI gate is not wired yet, and while a Railway project
  now exists (corrected 2026-08-30 — see `DEPLOYMENT.md`'s status
  note), it is currently down and this session cannot inspect or
  update its environment variables. **Caution this section didn't
  carry before**: if `SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_DB_PASSWORD`
  were ever set as Railway service variables (unconfirmed from here),
  rotating the value in Supabase without also updating Railway's copy
  would leave the deployment permanently unable to authenticate even
  after its current 502 is otherwise fixed — check Railway's own
  variable configuration before rotating, once dashboard access exists.
  For local dev today, `SUPABASE_SERVICE_ROLE_KEY` and
  `SUPABASE_DB_PASSWORD` live in exactly one place per person: each
  developer's own local, gitignored `.env`. That materially changes the
  blast radius and downtime profile of a rotation right now — see each
  section below, and the "Once Railway/CI-secrets exist" note at the
  end of this document for what changes when that stops being true.

## `SUPABASE_SERVICE_ROLE_KEY`

**Where it's rotated.** Supabase dashboard for the project → Project
Settings → API. Supabase's key-management UI has changed more than
once (legacy `anon`/`service_role` keys vs. the newer publishable/secret
key system); confirm the current control in the dashboard before
rotating rather than trusting a remembered click-path. Regenerating the
key immediately invalidates the previous value — Supabase does not, as
of this writing, offer a grace period where both old and new
`service_role` values are simultaneously valid, so treat this as an
instantaneous cutover, not an overlap window.

**Who to notify.** Every developer with a local `.env` containing this
value — today that means everyone who has cloned this repo and
configured Supabase credentials to run `pnpm test`'s integration
suites, the regulatory pipeline, or `pnpm dev` against a real project.
This repo has no roster of who that is and no shared-secrets vault
(that's a real gap, not an oversight — see the "Once Railway/CI-secrets
exist" note); coordinate the rotation through the team's normal
communication channel and confirm each person has updated before
treating the rotation as complete.

**What needs restarting.** Both consumer modules memoize their client
at first use (`let cachedClient: SupabaseClient | undefined;` in both
`src/infrastructure/supabase/client.ts` and
`src/infrastructure/supabase/admin-client.ts`) — a running `pnpm dev`
process, an open test-watch process, or an in-progress
`pnpm regulatory:verify` run will keep using the *old* key until the
process restarts, even after `.env` is edited. Restart every such
process after updating the key.

**How to verify without downtime.** The one shared runtime that exists
(Railway) is already down and unreachable from this session, so there
is no *healthy* shared runtime whose uptime this rotation could affect
today (corrected 2026-08-30 from "no Railway" — a project exists, it's
just not up; see `DEPLOYMENT.md`'s status note, and this file's own
note above about checking Railway's variable configuration before
rotating). So "without downtime" for this secret currently
means "without breaking your own or a teammate's local workflow between
old-key revocation and new-key update" — sequence it as: (1) update
your own `.env` and confirm `pnpm test`'s integration suites and
`pnpm regulatory:verify` (needs `SUPABASE_DB_PASSWORD` too — rotate
that first or together, see below) still pass against the new key; (2)
have every other holder do the same; (3) only then treat the old key as
fully retired. Because Supabase invalidates the old value the moment
you regenerate, steps (1)–(2) are really "everyone updates promptly
after the regenerate," not a true old/new overlap — plan the rotation
for a moment when nobody has an urgent need to run the regulatory
pipeline mid-rotation.

**Once Railway/CI-secrets exist** (not yet — see `README.md`'s
"Current state" and CLAUDE.md): add a step to update the GitHub
repo/environment secret and the Railway environment variable *before*
regenerating the key in Supabase, in that order, so nothing is left
pointing at a value Supabase has already revoked; redeploy the `web`
(and `worker`, once it exists) Railway service afterward so the new
value is actually loaded (Railway does not hot-reload env vars into a
running container); verify via the `/api/health` endpoint (process +
DB reachability + exactly-one-ACTIVE-dataset check, per master plan
§29) before considering the rotation complete.

## `SUPABASE_DB_PASSWORD`

**Where it's rotated.** Supabase dashboard → Project Settings →
Database → "Reset database password" (or equivalent — same caveat as
above about Supabase's UI changing over time).

**A rotation gotcha specific to this variable**: the pipeline scripts
(`scripts/regulatory/verify-definitive-regulatory-data.py`,
`load-definitive-default-values.py`,
`reconcile-loaded-regulatory-data.py`) don't build a full connection
string from `SUPABASE_DB_PASSWORD` alone — they read a base connection
URL from `supabase/.temp/pooler-url` (created by `supabase link`,
gitignored, holding host/port/user but not the password) and pass the
password separately to `psycopg.connect(connection_url, password=...)`.
Rotating the password alone is sufficient — you do **not** need to
re-run `supabase link` unless the project's host/pooler details
themselves changed (a different event from a password rotation).

**Who to notify.** Same population as `SUPABASE_SERVICE_ROLE_KEY`
above: everyone who runs `pnpm regulatory:verify` or the pipeline
scripts locally. If both secrets are being rotated in the same pass
(often the right call, since both originate from the same Supabase
project's credential set), notify once and cover both.

**What needs restarting.** Nothing process-level is memoized for this
one (each pipeline script opens a fresh `psycopg` connection per run,
reading `os.environ` at call time — see `connect()` in each script), so
there's no stale-cache risk the way there is for the service-role
client. The only requirement is that `.env` (or however the shell's
environment is populated) carries the new value before the next
invocation.

**How to verify without downtime.** Run
`pnpm regulatory:verify` after updating the password and confirm it
prints `RESULT: VALID` (per CLAUDE.md's own gate description). This
script is the actual production consumer of this credential — a clean
`RESULT: VALID` run *is* the verification, not a proxy for it. As with
the service-role key, there is no live Railway/production consumer of
this variable today (master plan §29 states plainly:
"`SUPABASE_DB_PASSWORD` is pipeline/CI-only, never runtime"), so there
is no user-facing downtime surface for this rotation at all right now.

## `NEXT_PUBLIC_SUPABASE_ANON_KEY` (and `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL`)

These are included for completeness, not because they need a rotation
*schedule* the way the two secrets above might. `NEXT_PUBLIC_SUPABASE_ANON_KEY`
is, by Supabase's own design and this repo's `.env.example` comment,
safe for browser exposure: every read/write it performs is still
subject to Postgres RLS, so it carries no elevated privilege to leak.
The `SUPABASE_URL` values aren't credentials at all. Rotate the anon
key only if you have a specific reason to believe it was compromised
alongside something that *does* matter (e.g., a leaked service-role key
from the same project, prompting a full project credential refresh) —
in that case, the same dashboard path (Project Settings → API) applies,
and because Next.js inlines `NEXT_PUBLIC_` variables into the client
bundle at *build* time, any rotation of this one requires a rebuild and
redeploy, not just a config change, once a hosted build pipeline exists.

## Extending this document

Do not write a rotation procedure for a secret this codebase doesn't
have. When a new one is actually adopted — a Sentry DSN, a log-drain
token, a hosted rate-limit store credential, an AV-scanning API key —
all of which master plan §41 lists as pending owner decisions, not
yet-built features — add it to the table above and give it its own
section, in the same PR that introduces the dependency, following the
same four questions this document answers for each existing secret:
where it's generated/rotated, who needs telling, what needs
restarting/redeploying, and how to verify the rotation succeeded
without downtime.

# Snowkap CBAM — FINAL RELEASE AUDIT (P14)

> Branch `phase14/release-hardening`, head `4aa624d`, branched from
> `95c95bb`. Working tree clean. `main` untouched at `909233d`. The
> deploy branch `feature/full-product-build` is untouched at `95c95bb`,
> locally and remotely. **Nothing has been pushed.**
>
> Every figure below was produced by a command run in this session. Where
> something could not be verified, it says so, in the place where the
> claim would otherwise have gone.

---

## 1. Execution summary

Sixteen commits on an isolated branch, closing eight of the plan's
release blockers, implementing two owner decisions that arrived
mid-execution, and adding six migrations. Local test count moved from
1401 to **1607**, with **zero skipped** — the tightened baseline the
plan required, not the historical 14.

Three things are worth stating before the detail, because they are the
kind of thing a summary usually hides.

**The build artifact check found a real gate-ordering hazard.** Running
`pnpm test:e2e` rebuilds the app with `E2E_RATE_LIMIT_BYPASS_BUILD=true`,
because Playwright's `webServer.command` is `pnpm build && pnpm start`.
So the gate protocol's own order — build at step 4, Playwright at step 5
— leaves a rate-limit-bypassing artifact on disk at the end. Confirmed
live: after the E2E run, `.next/standalone/server.js` contained
`"E2E_RATE_LIMIT_BYPASS_BUILD":"true"`. A clean rebuild inlines it empty.
Nothing was ever deployed from a harness build, but the gate as written
would not have caught it.

**CI has not run on this branch head.** Pushing would have required
knowing which branch Railway deploys from, and this session has no
Railway access. Reported as NOT RUN, not as passed.

**Storage could not be enabled locally.** Tried, live: the storage
container reports `LegacyHealthCheckTimeoutError ... unhealthy` on this
host. The new determination journey therefore skipped rather than ran.

---

## 2. Work completed

| WP | Status | Commits | Tests | Evidence |
|---|---|---|---|---|
| CI / test integrity | IMPLEMENTATION COMPLETE (from prior session) | `a496b69` | skip baseline 14 → 0 | Gate 2 JSON reports `numPendingTests 0` |
| WP-G docs | IMPLEMENTATION COMPLETE | `b560379`, `4aa624d` | n/a | Migration-promotion procedure, fresh-DB rebuild recipe, dump-scope honesty |
| WP-B provenance after revoke | IMPLEMENTATION COMPLETE, TESTS GREEN | `42decd8` | `sharing-counterparty-names` 8/8 | Live Postgres; accepted-bootstrap fixture built by really calling the RPC |
| WP-A auth links | IMPLEMENTATION COMPLETE, TESTS GREEN | `9766997`, `c30413a`, `b71a691` | `auth-email-links` 5/5, `auth-link-errors` 12/12 | PKCE recovery token verified on a *different* client with no code verifier |
| WP-D confirmation dialogs | IMPLEMENTATION COMPLETE, TESTS GREEN | `09183c1`, `fa38568` | E2E cancel-then-confirm on revoke | 16 actions wired; dialog contents render only while open |
| WP-C determine-from-actual-data | IMPLEMENTATION COMPLETE, TESTS GREEN | `fa38568` | 17 domain + 7 marking + 5 service | Full-snapshot no-op predicate; preview; server-decided flag |
| WP-J reproduction + goldens | IMPLEMENTATION COMPLETE, TESTS GREEN | `0d2fba2` | 38 goldens, 7 reproduction, 40 validator | Real line classified → determined → calculated → reproduced |
| WP-I provenance + reporting | IMPLEMENTATION COMPLETE, TESTS GREEN | `ea4dd7b` | 38 reporting | Stale figures excluded; 6 columns appended |
| WP-F hardening | IMPLEMENTATION COMPLETE, TESTS GREEN | `46e16b1`, `8c8c909`, `b71d948`, `9ea809f` | 1607 total | F1–F11 detailed in §3 |
| WP-E navigation | PARTIAL — placeholder REMOVAL is an owner decision | `23993d9`, `9ea809f` | 3 specs retargeted | False tooltips corrected; two placeholders became real screens |
| WP-H fixture hygiene | IMPLEMENTATION COMPLETE | `ea4dd7b` | 5 suites | Impossible `MAPPED`/"Germany"/`MATCHED` shapes replaced with a real dataset row |
| WP-K operations | PARTIAL — owner steps outstanding | `9ea809f`, `4aa624d` | health 58 | Smoke script run read-only against production |
| **D1 Annex II** | IMPLEMENTATION COMPLETE, TESTS GREEN | `c2f61e8` | 59 engine + golden | Engine 1.2.0 → 1.3.0, goldens re-derived by hand |
| **D2 importer-entered** | IMPLEMENTATION COMPLETE, TESTS GREEN | `23993d9` | 7 live + 10 unit | Two database walls, proven under RLS |

**Migrations added (6):** `20260902150000` counterparty names + XOR
trigger · `20260903100000` accept-grant capability gate ·
`20260903110000` filing quantity clause · `20260903120000` D2 provenance
walls · `20260903130000` invitation audit catalog · `20260903140000`
verification-downgrade gate. All applied to local Postgres. **None
pushed to production.**

---

## 3. Security

**Closed this round, each with a live reproduction or a live negative
test:**

- **Accepting shared data bound it to whichever org a cookie named.**
  `accept_sharing_grant_invitation` checked membership, never capability,
  and the target came from the active-org cookie. The binding is
  immutable and admits every member of that org to the producer's
  verified data. Now refused in the database, refused earlier in the
  application, and the organisation is chosen explicitly rather than
  inferred. Proven live with one user who is an owner of both a
  producer-only and an importer org.
- **A filed declaration could be understated by a forged quantity.**
  `calculation_results` is member-insertable and its CHECK pins the form
  of a decimal string, never its magnitude. A self-consistent row with a
  smaller quantity passed the determination comparison *and*
  `reproduceCalculationResult` — which recomputes from the row's own
  inputs and therefore cannot see that they are not the line's. Filing
  now refuses it.
- **Evidence behind a verified record could be stripped.** VERIFIED →
  VERIFICATION_PENDING → remove a file → VERIFIED, with
  `verifier_user_id` untouched throughout. The harmed party is the
  importer, whose frozen determination then cites documents that no
  longer exist. An ACTIVE, VERIFIED record can no longer leave VERIFIED.
- **Four reads were pinned to the user's orgs rather than the active
  one**, including the staleness signal, which disclosed to an org whose
  grant had been revoked that a newer version existed.
- **Sign-out could leave the session in place** on auth-js's
  `sessionError` path. Cookies are now cleared directly.
- **Admins saw their org's outgoing invitations with a live Accept
  button** on `/accept-invitation`. Live for ABC's owner in production
  at the time it was found.
- **Inviting and revoking left no audit trail at all** — the only way
  into an organisation, carrying a role.

**Verified sound and unchanged:** every SECURITY DEFINER function sets
`search_path`; RLS on all public tables; no cross-org write path;
append-only `audit_events` and `calculation_results`; storage policies
on the org prefix.

**D2 widened the write surface and was reviewed as a boundary change.**
The live test asserts that an importer's external records stay invisible
to every other organisation, so the write surface did not open a read
one.

**Not closed, carried as risk:** see §15.

---

## 4. Regulatory

**D1 rests on a fact already in this project's register**, not a new
interpretation: Article 7(1) sentence 2, recorded as RULE-EE-004 since
P6. That entry itself said the exception "must be reintroduced
explicitly" if the engine ever recomputed totals from components.
RULE-EE-009 did exactly that and the exception was not reintroduced. D1
reintroduces it. **No Annex II code list was transcribed, invented or
inferred.**

**The risk changed direction and this must not be glossed.** Membership
is detected through `cbam_goods.sector`, a proxy. While it refused, its
imprecision was conservative. Now that it applies an exclusion, a good in
those sectors that is not actually in Annex II would be **under-reported**.
Recorded as a high-risk accepted item in the register, ADR-0019 and §15 —
not closed.

**`pnpm regulatory:verify` against production: `RESULT: VALID`,
12540/12540**, all eleven checks PASS, run this session.

**The validator's positive UNLISTED arm now exists.** Only the negative
case had ever been tested, and the positive path was dead for four
validator versions without anyone noticing. Deliberately uses Kiribati
rather than an EU member state, so it cannot pre-decide the open
EU-origin question.

**EU-origin (G6) remains undecided and is the owner's.** Nothing in this
release asserts a scope position. The `Country mapping status` export
column ships as a verbatim projection of a frozen enum, documented in the
XLSX Notes as not being a scope indicator.

---

## 5. Calculations

Engine **1.3.0**. The bump is a real behavioural change, so every
`calculation_results` row carrying 1.2.0 now reports
`ENGINE_VERSION_CHANGED` rather than `REPRODUCIBLE` on an on-demand
check. That is the honest outcome and the reason the column exists. No
historical row was rewritten.

**The reproduction proof is real now.** The claim that "a CI-side
reproduction test covers the other half" appeared in two doc comments and
was false; the only coverage was a fully mocked unit test and a
seven-line stub asserting `true === true`. There is now an integration
test that classifies, determines, calculates and persists a real line
against real Postgres and the real dataset, then reproduces it.

**38 golden fixtures, hand-derived**, never generated by running the
engine. The version guard did its job: raising 1.2.0 → 1.3.0 broke all
35 existing goldens and every value was re-derived by hand. Three pin
behaviour written down as defective or open rather than settled
(`tCO2e/t/yr` computing as per-tonne; `tCO2/t` treated as CO2e).

**Independently recomputed and byte-equal** against production's own
rows: `"2"`, `"2.78"`, `"2.8"`.

---

## 6. Auth and invitations

Links are pre-fetch resilient: `token_hash` on an app-owned
`/auth/confirm` page that never consumes the token on GET, with an
explicit Continue. An architecture test asserts against stripped source
that the page contains no Supabase client, no `useEffect`, no
`requestSubmit`, no `autoFocus`.

The invited-user dead end is closed: invite always routes through
setting a password.

**The unverified assumption, still unverified.** U1 — that
`{{ .TokenHash }}` carries the `pkce_` prefix for PKCE-initiated
recovery — is proven against *local* GoTrue by
`tests/integration/auth-email-links.test.ts`, which verifies a
PKCE-initiated recovery token on a *different* client with no code
verifier. Hosted GoTrue may differ. This is why the Reset-password
template is pasted first and verified on two devices before any other.

---

## 7. Sharing and provenance

A grantee resolves its grantor's name for a grant of **any** status —
self-disclosure by the grantor, and necessary because a frozen
determination outlives the grant. A grantor resolves its grantee only
for a live-ACTIVE or provably-accepted bootstrap grant, so a self-issued,
self-revoked sham direct grant still names nobody. Both directions
proven live, including the stranger-gets-nothing case.

D2 adds a third provenance axis that was previously unreachable, with the
snapshot's own claim validated against the installation's.

---

## 8. Reporting and declarations

**Period reports were publishing figures the filing gate refuses.**
`checkCalculationCurrency` existed and nothing under
`src/application/reporting/**` called it, so a redetermined-but-not-
recalculated line contributed its superseded figure to the KPI, every
breakdown and both exports. Excluded now, and named as
`CALCULATION_STALE`.

**A filed declaration could render "No member shipments yet."** on its
own provenance screen — unbounded `.in()`, error never destructured,
`?? []` turning a refusal into an empty list. Batched, and failing closed.

Six provenance columns appended after `Calculated at`, so existing
byte-stable prefixes survive. The Notes sheet explains each, including
the two a reader could get wrong.

---

## 9. UX, mobile, accessibility

Sixteen consequential actions ask first, on a native `<dialog>`.
Contents render only while open — a real defect found when three journey
specs failed on "resolved to 2 elements", because every closed dialog was
duplicating the name it referred to.

Three navigation placeholders told users something false. Corrected.

Mobile: `mobile-chromium` ran the full suite. 39 passed across both
projects, 0 failed, 0 flaky.

**Not done:** an axe pass. Recorded, not claimed.

---

## 10. Operations

`/api/health` now reports `dataset_version` and `active_row_count` —
facts, not conditions, because the application pins no regulatory version
and inventing one inside a health check would be a regulatory decision
taken in the wrong place.

`scripts/smoke/production-smoke.mjs`, strictly read-only, run against
production this session: 18/21 checks passed. The three failures are the
correct pre-deploy baseline — `/external-operators`, `/external-emissions`
and `/auth/confirm` all 404, and the dataset fields are absent, because
production still serves `95c95bb`.

Runbooks gained the migration-promotion procedure, the fresh-database
rebuild recipe (which existed only inside `ci.yml`), and an honest
statement of what the logical dump is not: `auth.users` and Storage
objects are outside it.

---

## 11. Test matrix

| Gate | Result | Evidence |
|---|---|---|
| 0. Preconditions | **PASS** | 12540 ACTIVE rows |
| 1. `pnpm typecheck` | **PASS** | exit 0 |
| 2. `pnpm test` | **PASS** | 1607 passed, 0 failed, **0 skipped** (JSON: `numPendingTests 0`) |
| 3. `pnpm regulatory:verify` (production) | **PASS** | `RESULT: VALID`, 12540/12540 |
| 4. `pnpm build` | **PASS** | Bypass flag inlined **empty** — but only on a clean rebuild, see §1 |
| 5. Playwright, both projects | **PASS** | 39 passed, 9 skipped, **0 failed, 0 flaky** |
| 6. CI on the branch head | **NOT RUN** | Nothing pushed; deploy-branch trigger unverified |
| 7. Production smoke (read-only) | **RUN** | 18/21; 3 expected pre-deploy failures |
| 8. Security regression list | **PARTIAL** | Named tests exist; independent re-run is Phase 4's |
| 9. Accessibility | **PARTIAL** | Keyboard/focus specs pass; no axe pass |
| 10. Mobile sweep | **PASS** | `mobile-chromium` green |

**The 9 Playwright skips, by name and reason** — none hidden:

- `producer-journey`, `importer-journey`, `cross-org-sharing-journey`,
  `team-invitation-journey`, `importer-auth-smoke`,
  `producer-auth-smoke`, `shell` (one test each) — desktop-only, skipped
  on `mobile-chromium`. Pre-existing and deliberate.
- `actual-data-determination` — skipped on **both** projects: on
  `mobile-chromium` as desktop-only, and on `chromium` because Supabase
  Storage will not start on this host. **This spec has never executed.**
  It is written to fail loudly rather than skip under CI.

---

## 12. The 19 original UAT findings, re-attacked

| # | Finding | Disposition now |
|---|---|---|
| 1 | Signup/confirmation, real inbox | **D — owner UAT.** The Confirm-signup template changes; local autoconfirm cannot test it. |
| 2 | Confirmation delivered | **D — owner UAT.** Same. |
| 3 | Onboarding reached | **A — closed**, re-swept after signposting changes. |
| 4 | Real account received invitations | **D — owner UAT.** Old template shape; re-earned on the new one. |
| 5 | `otp_expired` | **A — closed in code**, C for production proof. Pre-fetch-resilient links, both prefetch arms tested. |
| 6 | Invitee reached producer dashboard | **D — owner action.** That user holds no known password. |
| 7 | ABC real org | **A — closed.** Trailing-space cause fixed; the existing row needs a one-off `btrim`. |
| 8 | Producer mobile nav | **D — owner UAT.** Nav changed; prior evidence void. |
| 9 | 2 tCO2e | **F — verified, no issue.** Recomputed byte-equal; now a golden. |
| 10 | Reproducibility | **A — closed.** The CI half exists and runs. |
| 11 | Not determined / Not calculated | **F — verified, no issue.** |
| 12 | "Use this data" | **A — closed.** Preview, confirmation, server-decided no-op. |
| 13 | No confirmation dialog | **A — closed.** 16 actions. |
| 14 | Role navigation | **A — closed** for correctness; **D** for the removal decision. |
| 15 | Settings disabled both roles | **D — owner decision** on removal. Tooltip now honest. |
| 16 | Producer Production data / Evidence / Verification disabled | **A — closed** for the false tooltips (Evidence and Verification are built); **D** for Production data, genuinely absent. |
| 17 | Importer Calculations / Installations disabled | **A — closed.** Installations became two real screens under D2. Calculations now explains it happens per line. |
| 18 | Hamburger works | **D — owner UAT.** Dialogs must stack above the drawer. |
| 19 | "Shared by Unknown organization" | **A — closed in code**, C until the migration is pushed. |

---

## 13. Remaining blockers

**B — RELEASE BLOCKER:**

1. **CI has never run on this branch head.** The plan's own gate 6.
   Blocked on knowing which branch Railway deploys from.
2. **No migration has been pushed.** Six migrations are required for the
   deployed code to behave as tested. Owner-gated by design.
3. **`actual-data-determination.spec.ts` has never executed.** The only
   end-to-end proof that determining from verified shared data works
   through the real UI. Needs a Storage-capable environment.
4. **Production recovery is a design, not a capability.** No restore has
   ever run against a hosted project.
5. **The Auth templates are not pasted**, so the invitation fix is not
   live. Owner-gated, and correctly ordered after the deploy.

**C — HIGH RISK, OWNER SIGN-OFF:** see §15.

---

## 14. Owner decisions required

1. **EU-origin scope (G6).** Option 1 or Option 2. Unchanged.
2. **Navigation placeholders**: remove the four remaining, or keep them
   as a roadmap. Their wording is now honest either way.
3. **Which branch Railway deploys from**, and whether auto-deploy can be
   paused. Everything in §13 items 1–2 is downstream of this.
4. **Backup tier / PITR**, and an actual restore into a throwaway project.
5. **Production fixture cleanup** — nine Auth users and two P13 test orgs.
6. **The `btrim` one-off** for `"ABC test plant "`.
7. **Re-read CELEX:32025R2621 and 32026R1740 Annex I directly.** The
   R7/R9 memo's own outstanding request.
8. **ACTUAL dataset period vs shipment period** — allowed today, shown in
   the picker, not recorded in the snapshot.
9. **Hosted Auth configuration**: Site URL, redirect allowlist,
   `secure_password_change`, CAPTCHA off, and the three rate-limit
   buckets.
10. **`tCO2/t` treated as CO2e** — material for aluminium PFCs and
    fertiliser N2O.

---

## 15. High-risk accepted items

Each needs an explicit owner acceptance.

1. **D1's sector proxy can now under-report.** The single most important
   item on this list. §4.
2. **Project-wide GoTrue rate-limit buckets.** Server-side
   `verifyOtp` and `signInWithPassword` mean the hosted per-IP limits
   apply to the Railway egress IP shared by all customers.
3. **Magic-link re-invite** mails a genuine sign-in credential to any
   address an org admin types. Bounded by the IP limiter, the unique
   PENDING index and `shouldCreateUser: false`.
4. **`/reset-password` accepts any live session without re-authentication.**
5. **`redetermineLineFromActualData` has no compare-and-swap.** Two
   concurrent redeterminations both commit and both audit events name the
   same previous determination. The value is one someone chose; the
   attribution is wrong.
6. **Amendments cannot correct a figure on an already-filed line.**
7. **Observability is insufficient for an incident.** `createRequestId()`
   has zero production call sites; audit-write failures return a reason
   that no caller yet surfaces.
8. **`INPUTS_DRIFTED` is now unreachable.** Retained deliberately as the
   fail-closed answer for "the recompute could not run".
9. **The E2E harness rebuilds with the rate-limit bypass enabled.** §1.

---

## 16. Post-release roadmap

Annex II CN-code dataset (retires D1's proxy) · thread the audit-failure
reason through Server Actions · request-id threading and SIGTERM
handling · CAS on redetermination · `emission_data.emission_unit`
allowlist · fix `tCO2e/t/yr` · CSP nonce/hash · importer-entered →
operator-provided linking path · axe in CI · `list-declarations.ts`
paging.

---

## 17. Final verdict

**RELEASE BLOCKED — five items in §13 remain open, of which four require
owner action this session could not perform and one requires an
environment this host cannot provide.**

Specifically: CI has never run on the branch head, no migration has been
pushed, the end-to-end determination journey has never executed, no
restore has ever been performed against a hosted project, and the Auth
templates are not live.

What is true, and is not the same thing: **implementation is complete**
for every work package the plan scoped and for both owner decisions,
**local tests are green** at 1607 passed and zero skipped, and
**`pnpm regulatory:verify` returns VALID against production**. That is a
release candidate's worth of work. It is not a release, and the gap
between those two is exactly the list above.

Nothing here should be read as an approval. The independent adversarial
review and the owner's own UAT remain separate checkpoints, and this
document was written by the agent that did the implementation.

---

## 18. Release certification pass (2026-09-03)

Appended, not merged into the sections above. §§1–17 are the historical
record of the implementation pass and are left exactly as they were
written, including the places where this section corrects them. Where a
correction matters it is stated here explicitly rather than by silently
editing the earlier text — see **N.1**, which withdraws a claim §15 made.

This pass ran no feature work. It carried the existing candidate through
the release gates, fixed the one release-process defect the audit had
found and left as documentation only, and corrected three security
defects that a re-check reproduced live — one of them a hole in a gate
written earlier the same day, in this same audit's name.

### A. Exact release SHA

| | |
|---|---|
| Release candidate | **`1b4a6c7356e96976404c8a310a82b4c294d04bed`** (`1b4a6c7`) |
| Branch | `phase14/release-hardening` |
| Base | `95c95bb3db07eeb90eac481c6a8e16a702cf88b1` — the deploy branch head |
| Commits on the branch | 22 |
| Diff vs base | 188 files changed, 21,475 insertions, 811 deletions |
| Working tree | clean |
| Pushed | **no** — the branch does not exist on `origin` (see **B**) |
| `main` | `909233d` — untouched, never merged |
| `feature/full-product-build` | `95c95bb` — untouched |

Four commits were added during this certification pass, on top of the
`5c760ff` audit:

- `0824ab0` `build(e2e)` — the rate-limit-bypass build gets its own
  directory (**E2E artifact hazard, closed — see D.3**)
- `e31d3cc` `fix(security)` — the evidence gate added earlier the same
  day had a hole and guarded the wrong half
- `4ebfe73` `fix(security)` — `organizations.capabilities` made
  append-only in the database
- `1b4a6c7` `fix(security)` — TRUNCATE revoked from `anon` and
  `authenticated`

Note on SHAs: `1b4a6c7` is the release candidate as *code*. The commit
that adds this section is a docs-only commit on top of it; when CI
eventually runs, it must run on the branch head at that time, and the
tree it tests is identical to `1b4a6c7` apart from this file.

### B. Deployment state

**Established from evidence:**

| Fact | Value | Source |
|---|---|---|
| Production URL | `snowkap-cbam-production.up.railway.app` | — |
| Production SHA | `95c95bb3db07eeb90eac481c6a8e16a702cf88b1` | `/api/health`, read 2026-09-03 |
| Production health | `status: ok`; `database`, `active_regulatory_dataset`, `app_url`, `product_schema` all ok | same |
| `/api/live` | 200 | HTTP |
| Railway build config | `railway.json`: Dockerfile builder, `node server.js`, healthcheck `/api/health` (30 s), restart ON_FAILURE ×3 | repo file |
| GitHub deployment records | 63, all created by `railway-app[bot]` | GitHub Deployments API |
| Environments seen | `resilient-elegance / production` (62) and `chic-expression / production` (1) | same |
| `chic-expression` | deployed `main`'s head once, 2026-08-28, then recorded nothing for the 62 subsequent pushes to the deploy branch | same |
| Every deployment SHA | inside `main` or `feature/full-product-build` history; none outside | computed against both refs |

What that evidence *does* establish: the two Railway services are
branch-filtered. A service does not deploy every push to every branch —
`chic-expression` ignored 62 consecutive pushes to the branch the other
service was deploying.

**What it does not establish, and this is the gate:** what happens when a
branch that has never existed on the remote is pushed. The two other
remote branches (`feature/phase-1-foundation`, `master`) carry no
deployment record, but both were last pushed *before* the earliest
deployment record (2026-08-28 23:43 UTC), so their absence proves
nothing about branch filtering.

**Missing access, stated exactly.** The branch→service mapping lives in
Railway's own service settings. It is not in the repository:
`railway.json` contains build and deploy settings and **no branch or
auto-deploy field**. The Railway CLI is not installed on this host, and
no `RAILWAY_TOKEN` exists in the environment or in `.env`. The
configuration is therefore unread, and the brief's instruction — never
infer topology from naming conventions — leaves exactly one honest
answer: it is unknown whether pushing `phase14/release-hardening` would
trigger a production deploy.

**No push was made.** Pushing could deploy 22 unreviewed commits and 9
unapplied migrations' worth of application code straight to a production
system serving two real organisations, a FILED declaration and a pending
invitee. The brief forbids exactly that, and this pass declines to take
the risk on inference.

**Precise owner action (unblocks D, E, and everything downstream of
them):** in the Railway dashboard, for the service backing
`snowkap-cbam-production.up.railway.app`, read and record (a) the
connected repository, (b) the deploy branch, (c) whether auto-deploy is
enabled, (d) whether a preview/staging environment exists, and (e) the
build-retention setting. Then either confirm that a push to
`phase14/release-hardening` cannot deploy, or pause auto-deploy for the
duration of the CI run.

### C. Migration state

`supabase migration list --linked` against production, 2026-09-03:

- **63 applied on both sides**, in the same order, with matching versions
- **9 pending** — local only, `remote` empty
- **0 drift** — no remote-only entry, no version mismatch

Pending, in apply order:

| Version | What it does |
|---|---|
| `20260902150000` | sharing counterparty names survive a terminal grant (WP-B) |
| `20260903100000` | `accept_sharing_grant_invitation` requires IMPORTER_DECLARANT (F10) |
| `20260903110000` | filing refuses a calculation whose quantity ≠ the line's |
| `20260903120000` | D2 importer-entered provenance |
| `20260903130000` | audit catalogue gains the invitation events (F5) |
| `20260903140000` | emission-data verification downgrade gate |
| `20260903150000` | **corrects `…140000`** — closes its bypass and guards the evidence array |
| `20260903160000` | `organizations.capabilities` append-only |
| `20260903170000` | revoke TRUNCATE from `anon`/`authenticated` |

Two ordering facts that matter for promotion:

1. `…150000` is a `create or replace` of the function `…140000`
   installs. Applying both in sequence yields the corrected body.
   `…140000` was **never applied to production**, but it was applied
   locally and is already committed, so it is corrected forward rather
   than edited in place.
2. `…170000` deliberately omits `alter default privileges for role
   supabase_admin`, which raises "permission denied to change default
   privileges" for the migration role. The omission and its consequence
   are documented inside the migration, not silently dropped.

All nine are applied and verified on local Postgres. **None has been
promoted to production** — promotion is an owner-gated step and the
sequencing rule in the plan (§13.F) has not been executed.

### D. CI evidence

#### D.1 CI on the exact candidate SHA — **NOT RUN**

CI is GitHub Actions, triggered on push (`branches: ['**']`). Running it
on `1b4a6c7` requires pushing the branch, which is blocked on **B**.
There is no substitute: a tag push does not match `branches`, and the
brief forbids substituting an older SHA, the deploy branch, a local
equivalent or a recreated state. Recorded as not run, not as passed.

#### D.2 Local gate, run on the candidate tree

Every gate that does not need CI was executed on this exact tree.

| Gate | Result |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm test` | **1616 passed, 0 failed, 0 skipped, 0 todo**, 138 files, 106 s |
| `pnpm build` | exit 0; `postbuild` artifact assertion OK |
| `pnpm test:e2e` | **39 passed, 9 skipped, 0 failed, 0 flaky**, exit 0 |
| `pnpm regulatory:verify` (production) | **`RESULT: VALID`**, 12,540/12,540 |

The test run was executed with `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` exported to the local values, which is what
makes the skip count zero: without them the protected regulatory
adapter's real-database suites silently skip. The count is taken from
the machine-readable reporter output, not from the terminal summary —
`numPendingTests: 0`, `numTodoTests: 0`.

The nine E2E skips, listed rather than summarised:

- eight `[mobile-chromium]` desktop-only journeys —
  `actual-data-determination`, `cross-org-sharing-journey`,
  `importer-auth-smoke`, `importer-journey`, `producer-auth-smoke`,
  `producer-journey`, `shell.spec.ts:52` (desktop nav), and
  `team-invitation-journey`
- one `[chromium]` skip: **`actual-data-determination.spec.ts`**, gated
  on `!storageAvailable`. This is the Storage blocker, not a mobile
  layout skip — see **E**.

#### D.3 The E2E build-artifact hazard — **fixed and proven**

The defect: `pnpm test:e2e` rebuilt the application with
`NEXT_PUBLIC_E2E_RATE_LIMIT_BYPASS_BUILD=true` into `.next` — the same
directory the Dockerfile copies into the production image — leaving a
production-deployable artifact with rate limiting disabled. Nothing
downstream would have caught it: the artifact builds, boots and serves
normally.

The invariant now enforced: **a test run must not leave a
production-deployable artifact containing the E2E rate-limit bypass.**

- `scripts/build/dist-dir.mjs` is the single source of the rule —
  `.next-e2e` for a bypass build, `.next` otherwise. `next.config.ts`,
  the standalone-asset copier and `playwright.config.ts` all read it
  from there.
- It keys on the **input** variable `NEXT_PUBLIC_E2E_RATE_LIMIT_BYPASS_BUILD`,
  which is what Playwright actually sets. An earlier attempt at this fix
  keyed on the derived output key `E2E_RATE_LIMIT_BYPASS_BUILD`, which
  no process ever exports — a silent no-op that would have shipped the
  bypass while appearing to fix it. It was caught by review and is
  recorded here because the failure mode is exactly the kind this gate
  exists to prevent.
- `scripts/build/assert-clean-production-artifact.mjs` is the
  fail-closed half. It checks the **constant** `.next`, not the resolved
  directory, so a misconfiguration that pointed a bypass build back at
  `.next` makes the assertion fire rather than follow it somewhere
  harmless. Three independent checks: the inlined build-time key present
  and not `"true"`; `required-server-files.json` carrying it as empty;
  and no file in the tree mentioning either bypass variable.
- It runs in `postbuild` (every local build) and again in the
  **Dockerfile** with `--require-artifact` before the `COPY`. Since
  `railway.json` sets the builder to `DOCKERFILE`, the production image
  itself cannot be built from a bypassing — or missing — artifact.

Proof, executed on this tree:

```
clean pnpm build      ->  .next tree sha256 c00eaa67da5efe...0e4fec81
                          required-server-files E2E_RATE_LIMIT_BYPASS_BUILD = ""
full pnpm test:e2e    ->  39 passed / 9 skipped / 0 failed
after E2E             ->  .next tree sha256 c00eaa67da5efe...0e4fec81   (identical)
                          assert-clean-production-artifact: OK
                          .next-e2e required-server-files ...BUILD = "true"
```

The `.next` tree is **byte-identical** before and after a full E2E run,
and the bypass lives in `.next-e2e`, which proves the test still
genuinely exercises it. The test was not weakened; it simply no longer
writes where the deploy artifact lives.

### E. Hosted Storage E2E evidence — **NOT RUN (environment blocker)**

The single most important missing functional proof, per the brief:
installation → emission data → evidence upload → verification →
activation → sharing → importer acceptance → actual determination →
calculation → provenance → reproducibility.

- **Locally impossible.** `supabase/config.toml` ships
  `[storage] enabled = false`, and the local Storage container is
  unhealthy on this host: `GET /storage/v1/bucket` → **503**. The
  journey therefore skips, and it skips *loudly* — the spec calls
  `test.skip(!storageAvailable, …)` with the reason spelled out.
- **The authorised environment already exists in CI and was not
  weakened.** `.github/workflows/ci.yml` rewrites `[storage]` to
  `enabled = true`, asserts the edit applied, and hard-fails the job if
  `GET /storage/v1/bucket` is not healthy. The spec itself *throws*
  rather than skipping when `process.env.CI` is set. So under CI this
  test cannot silently pass on the disabled branch.
- **Therefore this gate is blocked behind D, which is blocked behind
  B.** It is not a missing capability in the product or the test suite;
  it is one push away, and the push is the thing that cannot be taken
  safely.

No evidence is fabricated for this gate. It has never executed anywhere.

### F. Restore evidence — **partial; the hosted drill was NOT performed**

#### F.1 What was done

A restore drill was executed on the current migration set into a
**disposable local target**. No customer data was moved. It was
schema-scope only, and it produced a genuinely useful negative result.

#### F.2 What it proved — the logical dump is not a recovery path

| Check | Result |
|---|---|
| Tables | match |
| RLS enabled | match |
| Functions | match |
| Triggers | match |
| **RLS INSERT policies** | **5 of 56 lost** |
| Restore errors | **15 × "schema auth does not exist"** |

The `auth` schema is not in the dump, and `auth.users` carries ten
foreign keys from product tables. Five INSERT policies referencing it
failed to restore. A naive validation — tables present, RLS on,
functions present — **passes on this broken database**. That is the
finding: the runbook's own success criteria would have certified a
restore that silently lost five write-authorisation policies.

`BACKUP_RESTORE.md` now states plainly that the logical dump covers
`public` + `app` only, that `auth.users` and Storage objects are outside
it, and that it is a schema/product-data artefact rather than a
standalone recovery path.

#### F.3 What was not done

An actual restore into a **throwaway hosted Supabase project**, followed
by `regulatory:verify` and row-count comparison. Provisioning a new
hosted project is a billable, account-level action that was not
authorised for this pass. Recorded as an environment/owner blocker, not
as a pass.

Backup state on the hosted project, read 2026-09-03: `walg_enabled:
true`, **`pitr_enabled: false`**, 7 daily backups retained, most recent
2026-09-02T17:44Z. The backup tier / PITR decision remains the owner's
(see **O**).

**Nothing in this section should be read as "disaster recovery works."**
A dump that runs is not a restore that was verified.

### G. Auth-template evidence — **NOT DONE (access blocker)**

The `/auth/confirm` route, the token-hash link handling, the error
taxonomy, the set-password step and the local templates are implemented
and covered by the integration and E2E suites, including the
prefetch/scanner case (`team-invitation-journey`, passing on
`[chromium]`).

The hosted Supabase Auth templates are **not live**. Pasting them
requires the Supabase dashboard; the CLI's `supabase config` surface in
this project exposes only `push`, and no dashboard session is available
here. The staged paste order, the per-template verification and the
rollback procedure are written in
`docs/runbooks/AUTH_EMAIL_TEMPLATES.md`.

Consequences that must not be glossed:

- The two-device password-recovery proof (**the most important recovery
  proof in the brief**) has not been run against production.
- Assumption **U1** — that `{{ .TokenHash }}` carries the `pkce_` prefix
  for PKCE-initiated recovery links — remains **unverified against
  hosted GoTrue**. It is load-bearing for the recovery leg. If it is
  false, the Recovery template breaks password reset for every user,
  which is why the runbook pastes Reset password **first**, alone, and
  verifies it on two devices before anything else is touched.
- Delivery is claimed from template source nowhere in this document.

### H. Production smoke — **read-only only; no post-deploy smoke exists**

Read against production on 2026-09-03, without mutating anything:

| Check | Result |
|---|---|
| `/api/health` | `status: ok`, `git_sha` = `95c95bb…` |
| `/api/health` checks | `database`, `active_regulatory_dataset`, `app_url`, `product_schema` — all ok |
| `/api/live` | 200 |
| Migration ledger | repo = ledger for all 63 applied; 9 pending; no drift |
| `regulatory:verify` | `RESULT: VALID`, 12,540/12,540 |

The post-deploy smoke the brief describes — new routes resolving, the
three expected pre-deploy 404s changing, `git_sha` equal to the release
SHA — **cannot exist yet**, because nothing has been deployed. Production
still serves `95c95bb`, which is the correct and intended state.

### I. Security verification

A full adversarial re-check ran against the candidate, with live
reproduction against local Postgres inside `begin … rollback`
transactions. Findings were **not** taken at face value from the
verification agents: of 24 candidate findings only one survived their
refutation pass, yet direct `psql` probes confirmed **four more were
real**. All four are recorded below. Refuted findings were re-tested by
hand rather than accepted.

#### I.1 Fixed in this pass

**1. The evidence gate written earlier the same day had a bypass, and
guarded the wrong half.** (`20260903150000`, commit `e31d3cc`.)

`20260903140000` keyed its un-verify rule on `new.status = 'ACTIVE'` as
well as `old.status`, so one UPDATE moving both columns walked past it,
and the VERIFIED → strip evidence → VERIFIED chain that migration's own
header named was reproducible again. Worse and simpler: no downgrade was
needed at all —

```
update emission_data set evidence_file_ids = '{}' where …;
```

succeeded on an ACTIVE + VERIFIED record as an ordinary member, leaving
it VERIFIED with no evidence. The row-level protections
(`20260829560000`) cover the `evidence_files` **rows**; nothing covered
the **array**, and the fact-immutability trigger deliberately omits it so
files can still be added after verification. Evidence may now grow and
never shrink, tested by set containment so a same-count swap is caught,
and `ACTIVE → DRAFT` is refused outright to close the two-statement
variant. Five regression tests; the legitimate DISCARD path still works.

**2. `organizations.capabilities` was freely rewritable.**
(`20260903160000`, commit `4ebfe73`.) Two separate gates —
`20260903120000`'s provenance wall and
`accept_sharing_grant_invitation`'s `CAPABILITY_NOT_HELD` check — argue
from "capabilities are append-only". The application was; the database
was not. An organisation could accept a producer's data and then drop
the capability that authorised the acceptance, stranding a grant whose
binding is immutable. Removal is now refused, including for the service
role. Three regression tests, on a throwaway org.

**3. `anon` and `authenticated` held TRUNCATE on every table in
`public`.** (`20260903170000`, commit `1b4a6c7`.) From the standard
Supabase bootstrap's `grant all`, inherited by every table added since.
Not directly reachable — PostgREST has no verb that issues a TRUNCATE,
and it is not reported as a one-request data-loss bug. What it is: the
one privilege in this schema that RLS does not constrain at all, on an
append-only compliance record. Revoked, including from the default
privileges.

#### I.2 Confirmed, **not** fixed — and §15 overstated its mitigation

**Calculation-result output forgery reaches the filed snapshot.** A
member can insert a `calculation_results` row through raw PostgREST with
the line's correct determination, quantity and unit, and a forged
`embedded_emissions_tco2e` — reproduced live: **0.001 against a true
139**.

The correction this pass must make to §15: the P14 filing clause
(`20260903110000`) checks that the calculation's **quantity** matches the
line's. A forgery that keeps the quantity honest and changes only the
emissions figure passes it — the probe returned "ACCEPTED — forged output
would be summed into the filed snapshot". `reproduceCalculationResult`
cannot detect it either, because it recomputes from the row's own inputs.

Bounds, stated fairly: it is the organisation's own data, requires raw
API access rather than the UI, and reaches no other tenant. The declarant
is the party who would be defrauding themselves or their own filing.

The database cannot fix this without duplicating engine semantics in SQL.
The correct fix is routing calculation writes through a SECURITY DEFINER
RPC that computes the figure server-side. That is a design change beyond
this pass's scope and is carried as **HIGH RISK** in **N**, not as
closed.

The first reproduction attempt failed twice and both failures are worth
recording, because each was a real control working: once because it
copied another user's `calculated_by_user_id`, and once because the
target shipment was LOCKED and the insert policy excludes
`LOCKED`/`VOID`. It succeeded only against a READY shipment.

#### I.3 Verified sound and unchanged

Every SECURITY DEFINER function sets `search_path`; RLS enabled on all
public tables; no cross-org write path; append-only `audit_events` and
`calculation_results`; storage policies scoped to the org prefix;
function security attributes (`prosecdef`/`proconfig`) confirmed
identical local vs production for all five replaced functions.

#### I.4 Not re-run against production

The deployed-release security re-check the brief describes assumes a
deployed release. Nothing is deployed, so this ran against the candidate
and local Postgres only. No production data was modified by any probe.

### J. Regulatory verification

`pnpm regulatory:verify` against **production**, 2026-09-03:

```
Canonical records: 12540
Source checksum                 PASS
Canonical identity uniqueness   PASS
Database records: 12540
Database identity uniqueness    PASS
Canonical/database identities   PASS
Field-level reconciliation      PASS (12540/12540)
Emission semantic invariants    PASS
Country coverage                PASS
CBAM goods coverage             PASS
Production route coverage       PASS

RESULT: VALID
```

**D1 — the required reminder, recorded verbatim in substance:** the D1
product decision is accepted and implemented; the **Annex II
applicability proxy remains a high-risk follow-up until it is replaced
with an exact versioned applicability dataset.** `ANNEX_II_SECTORS` in
`calculate-line-emissions.ts` is a sector-level proxy, not the
regulation's own goods list. It is not "fully solved", and this document
does not claim it is. The interpretation was not broadened beyond the
project's authoritative register.

The implementation matches the decision: for an Annex II good only
direct emissions enter the result; the reported indirect figure is
**stored and kept visible in the trace** as
`indirect_specific_excluded`; the `ANNEX_II_DIRECT_ONLY` step is emitted
**whether or not indirect is zero**, so a reader of a frozen calculation
can see the treatment was applied rather than infer it from a number
that happens to match.

R7/R9, UNLISTED, country mapping, production route, default values and
the actual/default separation are unchanged from §4 and re-verified by
the suites above. The EU-origin scope question is untouched and remains
the owner's (see **O**).

### K. Calculation verification

| Item | State |
|---|---|
| Engine version | **1.3.0** (bumped from 1.2.0 for D1, per the project rule) |
| Historical 1.2.0 rows | not rewritten |
| `ENGINE_VERSION_CHANGED` | expected and correct where semantics genuinely changed |
| Golden fixtures | pass; hand-authored from the source dataset, never engine-generated |
| Byte-equality contract | preserved — reproduction compares `DecimalString` with `===` |
| Precision | decimal.js, 40 digits, ROUND_HALF_UP, intermediate only |
| Units | allowlist behaviour pinned, including the known-imperfect cases |
| Frozen snapshots | unchanged |
| Reproduction | integration test against real local Postgres; the CI half that §3.7 of the plan had found missing now exists |

Older calculations are **not** claimed reproducible under the new
engine. That is the correct behaviour and it is not being papered over.

### L. Reporting / declaration verification

Verified by the suites on this tree: full precision preserved;
calculation-currency checks applied so stale results are excluded from
totals and listed as incomplete; provenance columns present and derived
from the **frozen** calculation rather than the line's current state;
declaration snapshots frozen; the filing gate intact; amendment
behaviour unchanged; the unbounded `.in()` that could render a FILED
declaration as "No member shipments yet." is batched and now fails closed
on a gateway error rather than returning a short list; no fabricated
rounding — RULE-EE-006 remains `UNRESOLVED_ESCALATED` and disclosed.

The one place the declaration system could still convert a refusal into
a wrong number is **I.2**, and it is recorded there rather than here.

### M. Owner UAT status — **NOT STARTED**

No UAT step in the plan's §14.4 script has been executed. Every item in
it depends on either a deployment or the hosted Auth templates, and
neither exists. The five items the plan flagged as needing to be
**re-earned** after this work (signup/confirmation, invitation receipt,
producer mobile nav, hamburger/dialog stacking) are still open, and none
of the pre-existing evidence for them survives the changes made here.

### N. Remaining risks

Classified as the brief requires. "Prevents controlled customer usage"
means: would this stop a small number of supervised, known customers
from using the product for real filings?

| # | Item | Class | Evidence | Prevents controlled use? |
|---|---|---|---|---|
| N.1 | **Calculation-result output forgery reaches the filed snapshot**; the quantity clause does not close it | **HIGH RISK** | live probe, forged 0.001 vs true 139, "ACCEPTED" | No — own-tenant, raw API only. But it is the weakest point in a compliance filing path and the fix (SECURITY DEFINER write RPC) should not wait long |
| N.2 | **Annex II applicability is a sector proxy**, not the regulation's goods list | **HIGH RISK** | `ANNEX_II_SECTORS`, `calculate-line-emissions.ts` | No, given D1 is an accepted owner decision — but it can mis-scope a real good, in either direction |
| N.3 | **E2E rate-limit bypass artifact hazard** | **CLOSED** this pass | D.3, byte-identical `.next` | — |
| N.4 | **GoTrue rate-limit buckets are project-wide**, so hosted per-IP limits apply to the shared Railway egress IP for all customers | **HIGH RISK** | `signInWithPassword` already server-side; token verification joins it | No, but it degrades for everyone at once; owner must record and raise the hosted limits |
| N.5 | **Magic-link re-invite** mails a genuine sign-in credential to any address an org ADMIN types | **HIGH RISK** | bounded by per-address cap + IP limiter + `shouldCreateUser:false` | No — requires ADMIN of an org; needs explicit owner acceptance |
| N.6 | **`/reset-password` accepts any live session without re-authentication** | **HIGH RISK** | strengthens a borrowed-device takeover | No; mitigated by enabling `secure_password_change` hosted |
| N.7 | **Redetermination has no compare-and-swap** — concurrent redeterminations are a lost update with two audit events naming the same previous determination | **POST-RELEASE** | `redetermineLineFromActualData` | No |
| N.8 | **A filed line's figure can never be corrected** — filing LOCKs every member and LOCKED lines are immutable; an amendment can add an omitted shipment, not fix a number | **HIGH RISK** | declaration lifecycle | **Possibly yes for a real filing**, and it is a product-shape question, not a bug. The owner should decide before the first real declarant files |
| N.9 | **Observability insufficient for an incident** — `createRequestId()` has zero production call sites, no SIGTERM graceful shutdown, no error tracker, no paging | **HIGH RISK** | code | No, but a production incident would be diagnosed blind |
| N.10 | **The capability gate is a scoping control, not a security boundary** — an org can still grant itself a capability; only removal is now blocked | **ACCEPTED, newly explicit** | `20260903160000` header | No — deliberate, and the dual-capability case is legitimate |
| N.11 | **The logical dump is not a recovery path** and a naive validation passes on a broken restore | **HIGH RISK** | F.2, 5 of 56 INSERT policies lost | No — but "we have backups" is not currently true in the sense that matters |

`.next-e2e` is git-ignored and Docker-ignored; the ignore was verified
empirically (by creating a probe file and observing `?? .next-e2e/`)
rather than trusted from `git check-ignore`, which had produced a
spurious match.

### O. Remaining owner decisions

Unchanged from §14 unless noted; none was silently converted into
product policy by this pass.

1. **EU-origin scope** — Option 1 (remain determinable via the R7
   fallback) or Option 2 (exclude, with the scope text and Annex III
   ingested as versioned datasets). Required before the first real
   declarant files. No EU-origin line may be created in production UAT
   until this is answered.
2. **Railway deploy branch / auto-deploy strategy** — now the single
   highest-leverage decision, because **B**, **D**, **E** and everything
   downstream are blocked on it.
3. **Backup tier / PITR** — `pitr_enabled: false` today; and authorise a
   throwaway hosted project for the restore drill (**F.3**).
4. **Production fixture cleanup** — test users and P13 orgs still live.
5. **The ABC installation name `btrim`** — a one-off owner-run update,
   deliberately not a migration.
6. **Direct CELEX re-read** (`32025R2621`, `32026R1740` Annex I) — the
   R7/R9 memo's own outstanding request.
7. **ACTUAL dataset period vs shipment period** — allowed today, shown in
   the picker, not recorded in the snapshot.
8. **Hosted Auth configuration** — Site URL, redirect allowlist,
   `secure_password_change`, CAPTCHA off, and the rate limits; plus the
   staged template paste (**G**).
9. **`tCO2/t` treated as CO2e** — a deliberate decision, and an open
   question for aluminium PFCs / fertiliser N2O.
10. **Navigation placeholders** — remove (recommended) or keep as a
    labelled "Planned" group.
11. **New:** whether `VERIFY` should refuse when the verifier is the
    record's creator. Production's own ABC dataset was self-verified.

### P. Final release recommendation

**RELEASE BLOCKED**

Not because this pass found the implementation unsound — it did not — and
not to hedge. Four mandatory certification gates have never executed:

1. **CI has never run on the release candidate SHA** (**D.1**), because
   the branch cannot be pushed without knowing whether that deploys to
   production (**B**).
2. **The actual-data determination end-to-end journey has never executed
   anywhere** (**E**) — the brief's own "most important missing
   functional proof". Locally the Storage container returns 503; in CI
   it is enabled and hard-failed, so this is one push away and blocked
   behind the same gate.
3. **No restore has ever been performed against a hosted project**
   (**F.3**), and the local drill proved the dump alone is not a
   recovery path.
4. **The hosted Auth templates are not live** (**G**), so the two-device
   recovery proof has not been run and assumption U1 is unverified.

Plus one substantive item that is not an environment gate: **N.1**, the
filed-snapshot forgery class, whose mitigation §15 described more
strongly than it deserves. That correction is made in **I.2** and the
class is carried as HIGH RISK, not closed.

What is true, and is a real change from §17: the release-process defect
that could have shipped a rate-limit-disabled artifact is **closed and
proven closed**; three further security defects — one of them a hole in
a gate this very audit had claimed as a fix — were found, reproduced,
corrected and pinned by regression tests; the migration ledger is clean
with nine well-ordered pending migrations; `regulatory:verify` is VALID
against production; and the local gate is 1616 tests passing with **zero
skips**.

That is a stronger candidate than the one §17 described. It is still not
a certified release, and every gap above is an absence of evidence, not
an assertion that the gap is harmless.

**Recommended next action, single and concrete:** read the Railway
service configuration for the production service and record the deploy
branch and auto-deploy setting (**B**). Everything else that remains
technically executable — CI on the exact SHA, the Storage-backed
actual-data E2E, the production smoke — unblocks from that one answer.

---

**This is not an independent review, and it is not an approval.** It was
written by the agent that implemented the work it assesses, including the
defect in **I.1(1)** that this same agent introduced earlier the same day
in this same document's name. The independent adversarial review and the
owner's UAT remain separate, and both remain outstanding.

---

## 19. P14.1 — security / recovery blocker remediation (2026-09-03)

Appended. §§1–18 stand as written, including where this section
supersedes them: §18's **N.1** carried the filed-snapshot forgery class
as HIGH RISK with the fix deferred. It was reclassified as a release
blocker and is now closed. §18 is not edited to pretend it always said
so.

Nothing was deployed. `main` untouched, the deploy branch untouched, no
migration promoted, no production data modified by any probe.

| Commit | Change |
|---|---|
| `acdb439` | negative quantities, emissions, certificates and liability refused |
| `a80e94c` | the trusted write model — the blocker |
| `06cea94` | restore posture: the comparator and the runbook correction |

Branch `phase14/release-hardening`, still unpushed. Migrations
`20260903180000` and `20260903190000` are applied to local Postgres and
pending against production, taking the pending count from 9 to 11.

### A. BLOCKER 1 — calculation-result output forgery

#### A.1 The original exploit

Reproduced live as an ordinary `authenticated` member of the line's own
organisation, inside a real `BEGIN … ROLLBACK` transaction with state
verified before and after:

```sql
insert into public.calculation_results (
    org_id, line_id, shipment_id, engine_version, parameter_datasets,
    quantity, quantity_unit, determination, steps,
    embedded_emissions_tco2e, calculated_by_user_id)
select sl.org_id, sl.id, sl.shipment_id, '1.2.0', '[]',
       sl.net_mass_tonnes, 'TONNES', sl.emission_determination, '[]',
       '0.001', auth.uid()
from public.shipment_lines sl where sl.id = '…';
-- INSERT 0 1

select * from public.record_declaration_filed('…', 'EU-REF-FORGED-1');
-- OK
-- filed_snapshot total: 0.001      (true value: 139)
-- shipment: FILED_RECORDED
```

The adversarial re-check found the class is wider than the reported
case. Every field that carries meaning was client-supplied:

| Field | Consequence of forging it |
|---|---|
| `embedded_emissions_tco2e` | the filed figure itself |
| `quantity` / `quantity_unit` | closed at filing by `20260903110000`, not at write |
| `determination` | compared at filing, not at write |
| `steps` | the derivation the "Why this number?" panel renders — a forged number could be given a plausible-looking trace |
| `engine_version` | **blinds the only detective control**: `reproduce-calculation-result.ts` returns `ENGINE_VERSION_CHANGED` *before* recomputing, so any value but the running one turns a MISMATCH into a benign-looking status |
| `parameter_datasets` | fabricated regulatory provenance |
| `certificates_due`, `liability_amount` | never written by the engine at all |
| `calculated_at` | when the calculation claims to have happened |

#### A.2 Root cause

`calculation_results_insert_own_org_as_self` (`20260829200000`) pinned
`org_id`, `calculated_by_user_id = auth.uid()` and the line→shipment
linkage, and refused a LOCKED/VOID shipment. All correct, and all about
**scope**. Nothing in it — or in any CHECK constraint — concerned the
**numbers**.

Every downstream wall passed the forgery for a defensible reason:

- the determination comparison in `20260829470000` passes, because the
  forged row carries the line's real determination;
- the quantity clause in `20260903110000` passes, because it carries the
  line's real quantity;
- `reproduceCalculationResult` passes, because it recomputes from the
  row's **own** frozen inputs — it can prove a stored number follows
  from the inputs stored beside it, and cannot prove those inputs came
  from the engine.

#### A.3 Why the database cannot simply recompute

The obvious fix is unavailable and was not faked. The engine is
TypeScript (`calculate-line-emissions.ts`, ENGINE_VERSION 1.3.0):
RULE-EE-001/EE-009, the Annex II direct-only rule from owner decision
D1, unit-basis matching, decimal.js at 40 digits ROUND_HALF_UP. A
plpgsql reimplementation would be a second, silently diverging copy of
regulatory semantics — precisely what the facts-as-datasets rule and the
protected regulatory zone exist to prevent, and worse than no check,
because a disagreement would surface as refusing to file a *correct*
declaration.

So the number was made **unforgeable** rather than verified.

#### A.4 The exact fix

`supabase/migrations/20260903190000_p141_calculation_results_trusted_write_only.sql`

1. `calculation_results_insert_own_org_as_self` dropped.
2. `revoke insert, update, delete … from anon, authenticated`. Append-only
   previously rested on the *absence* of UPDATE/DELETE policies while
   the grants were still held — one permissive policy away from mutable.
3. `public.record_calculation_result(...)`, SECURITY DEFINER,
   `set search_path = public`, **granted to `service_role` alone**.

Granting it to `authenticated` would have closed nothing: the member
would pass the forged number to the function instead of to the table,
and the function cannot tell. The trust boundary has to sit where the
engine runs.

The RPC re-imposes in SQL everything the dropped policy enforced — org
ownership, line/shipment linkage, editable shipment status — and adds
five bindings it never had:

| Binding | Refusal |
|---|---|
| determination must equal the line's current one, byte-for-byte | `DETERMINATION_MISMATCH` |
| quantity + unit must equal the line's own, by the same rule the app uses | `QUANTITY_MISMATCH` |
| actor must be a live, non-deactivated member of the org | `ACTOR_NOT_A_MEMBER` |
| org must hold `IMPORTER_DECLARANT` | `CAPABILITY_NOT_HELD` |
| `shipment_id` derived, `calculated_at` set from `clock_timestamp()` | — not accepted at all |

The capability re-check was added after an adversarial reviewer pointed
out its absence: under the service role RLS is not standing behind the
write, so an application-layer gate would have been the only thing
enforcing an importer-only workflow — and the premise of the whole
change is that a compliance record should not rest on one.

**Application side.** `calculateLine` no longer touches the table. It
takes a `CalculationResultWriter` port
(`src/application/calculations/calculation-result-writer.ts`); the
adapter (`src/infrastructure/calculations/get-calculation-result-writer.ts`,
`server-only`) holds a private service-role client and can do exactly
one thing. The Server Action composes it, as it already does for
`getRegulatoryRepository()`.

Deliberately **not** `admin-client.ts`: that module's own doc comment
makes its narrowness load-bearing ("without opening a general RLS-bypass
escape hatch to the rest of the schema"), and reusing it would have made
that sentence false for every existing caller. Deliberately **not** a
raw `SupabaseClient` parameter into `src/application/**` — three of the
reviewed designs proposed that, and it would have handed the application
layer a general RLS-bypassing client while technically passing the
layering test.

#### A.5 Live verification

Nine probes, real psql, every mutation rolled back:

| # | Probe | Result |
|---|---|---|
| 1 | direct INSERT as `authenticated` (the original exploit) | `permission denied for table calculation_results` |
| 2 | the RPC called as `authenticated` | `permission denied for function record_calculation_result` |
| 3 | forged determination via `service_role` | `DETERMINATION_MISMATCH` |
| 4 | forged quantity | `QUANTITY_MISMATCH` |
| 5 | non-member actor | `ACTOR_NOT_A_MEMBER` |
| 6 | cross-org | `LINE_NOT_FOUND` |
| 7 | legitimate write | `OK` + row id |
| 8 | UPDATE / DELETE as `authenticated` | `permission denied` (both) |
| 9 | SELECT as a member | still works — read surface intact |

Resulting grants: `authenticated` and `anon` hold `SELECT` (plus
`REFERENCES`/`TRIGGER`) and nothing else. One policy remains,
`calculation_results_select_own_org`. Function ACL:
`postgres=X/postgres service_role=X/postgres`.

#### A.6 Regression tests

`tests/integration/calculation-reproduction.test.ts` gains
**"P14.1 — the calculation-result write boundary"**, ten cases against
real Postgres, mapping one-to-one onto the ten the brief required:

1. forged emissions beside the line's own correct quantity — refused
2. forged emissions **and** forged quantity — refused
3. fabricated determination and steps — refused
4. no INSERT/UPDATE/DELETE privilege at all; RPC unreachable by the member, works for `service_role`
5. cross-org forgery — refused twice over (privilege, then the org binding)
6. the trusted channel refuses inputs the line does not carry (all three bindings)
7. a legitimate result is accepted, and `shipment_id`/`calculated_at` are derived, not accepted
8. a recalculation **appends**; the prior row is untouched
9. a result written through the trusted channel is byte-reproducible
10. a negative figure is refused; **zero is still accepted**

Two existing tests in `declarations-isolation.test.ts` asserted
`expect(forgeError).toBeNull()` — they positively required that a member
*could* insert a forged row. Their own comment said that if this ever
started failing, "the insert policy changed and this test's premise
needs revisiting rather than the assertion being relaxed." It did. Both
now assert the insert is **refused**, and each then plants the same row
with the service role writing directly to the table — deliberately
bypassing the RPC, which would reject it — so `record_declaration_filed`'s
own INCOMPLETE refusal is still measured. Neither assertion was weakened;
each test now covers two walls instead of one.

`calculate-line.test.ts`: the supabase mock's `calculation_results`
branch now **throws**. A mock that accepted a direct insert would be
more permissive than the database and would let the defect back in
silently.

`calculation-reproduction.test.ts`'s append-only test got stronger: the
UPDATE used to affect zero rows via RLS; it is now refused at the
privilege level and never reaches RLS.

#### A.7 Final status — **CLOSED**

The invariant now holds: no `anon` or `authenticated` caller can write a
calculation result by any route — not the table, not the function.

**Bounded honestly:** `service_role` retains its direct table grant.
This does not constrain the service role, which is the trusted boundary
by definition and whose key is server-only. One reviewed design proposed
a trigger binding `service_role` too, so that a leaked key could not
mint a fileable row. It was considered and **rejected for now**: as
specified it would also have broken the deliberately-tampered fixture
that is the only automated proof `reproduceCalculationResult` detects a
MISMATCH, the two filing-gate tests above, and the perf seed script.
Recorded as a follow-up, not as done.

### B. Defect found alongside — negative magnitudes accepted

**Exploit.** A member-planted row with
`embedded_emissions_tco2e = '-500000'` filed successfully. A negative
does not understate one line; it **subtracts** from the declaration
total, so one forged line can cancel several honest ones while the
snapshot still adds up internally.

**Root cause.** `calculation_results_numeric_format_ck` reused the
DecimalString shape `^-?[0-9]+(\.[0-9]+)?$`. That is correct for
`src/domain/shared/decimal.ts`, a general decimal type, and wrong for
four columns that are a mass, an emissions figure, a certificate count
and a money amount owed.

**Fix.** `20260903180000_p141_calculation_results_forbid_negative_magnitudes.sql`
removes the optional leading minus. Verified beforehand that all 21
existing local rows are non-negative, so it validates against existing
data.

**Deliberately not `> 0`.** Two of the reviewed designs proposed
rejecting `<= 0`, and both were caught by adversarial review: a
genuinely zero-emissions line is a real regulatory outcome, and a
positive-only guard would refuse it. Test (10) asserts `0` is still
accepted.

**Live verification.** `-500000` → `violates check constraint
calculation_results_numeric_format_ck`; `139.5` → accepted; `0` →
accepted.

**Status — CLOSED.**

### C. BLOCKER 2 — restore / security-posture loss

#### C.1 Root cause, measured rather than inferred

The dump was
`pg_dump --schema=public --schema=app --no-privileges`. Restoring it
into a throwaway database reproduced the reported symptom exactly and
then went further.

**Cause 1 — `--no-privileges` carried no grants at all.**

| | with the flag | without |
|---|---|---|
| `GRANT`/`REVOKE` statements in the dump | **0** | 116 |
| API-role table grants in the restored database | **154 of 506** | 506 of 506 |

The flag's stated rationale was that the target's roles "already exist
with their real grants from the applied migrations" — true only if the
target has had migrations applied, which is not the recovery this
artifact exists for. Nobody had ever looked at grants.

**Cause 2 — the `auth` schema.** 15 × `ERROR: schema "auth" does not
exist`, losing **5 of 56 policies, every one an INSERT policy**:
`audit_events_insert_own_org_as_self`,
`calculation_results_insert_own_org_as_self`,
`declarations_insert_own_org`, `import_batches_insert_own_org`,
`organization_invitations_insert_admin_or_owner` — each naming
`auth.uid()` directly in its own text, which is why these five failed
and the other 51 did not. Also **10 foreign keys to `auth.users`**.

Tables, columns, RLS flags, functions, triggers and indexes all matched
throughout. **The four things the original drill checked are exactly the
four things this failure does not touch.**

**Cause 3, and the one that matters most — `auth.users` rows.**
Re-running with privileges retained and the `auth` schema present
brought policies to 56/56 and grants to 506/506. Nine of the ten foreign
keys still could not be created:

```
ERROR: insert or update on table "memberships" violates foreign key
       constraint "memberships_user_id_fkey"
```

Those are `ADD CONSTRAINT` failures, not row failures — product rows
loaded fine, row counts matched source exactly across all twelve tables
checked. The constraints cannot be added because `auth.users` is empty,
and it is empty because it is not in this dump and never was.

**So the honest conclusion is stronger than "nobody can sign in": a
restore from this artifact alone cannot re-establish referential
integrity.** The logical dump is a supplement to the provider's backup,
never a replacement.

**Cause 4.** 12 × `ERROR: permission denied to change default
privileges`, from `ALTER DEFAULT PRIVILEGES … FOR ROLE supabase_admin`
statements the dump captures. `postgres` is neither a superuser nor a
member of `supabase_admin` (verified against `pg_auth_members`), so it
cannot replay them. Benign for the restored objects, but a zero-`ERROR`
restore is not achievable from this artifact and must not be presented
as the pass criterion.

#### C.2 The fix

- `--no-privileges` removed from the dump command, and the paragraph
  that justified it corrected in place rather than quietly deleted.
- `docs/runbooks/BACKUP_RESTORE.md` gains a **"Re-drill 2026-09-03"**
  section carrying all four findings with their measurements, an
  explicit contains/does-not-contain table, and the prerequisites a
  restore target must provide (verified by experiment: the `auth` schema
  with `uid`/`role`/`jwt`/`users`, the three API roles, `pgcrypto`,
  `uuid-ossp` — i.e. a fresh Supabase project, not a bare Postgres).
- **The acceptance test is no longer a checklist a human reads.**
  `scripts/ops/compare-database-posture.mjs` compares two databases
  object by object and exits non-zero on any difference: schemas,
  tables, columns, RLS flags, **full policy definitions including
  USING/WITH CHECK text**, **effective table grants**, schema USAGE
  grants, functions (with `prosecdef`, `proconfig` and a body hash),
  function grants, triggers, constraints, indexes, sequences,
  extensions — plus nine self-consistency checks that need only one
  database.

#### C.3 The tool was itself caught failing, and fixed

Its first version of the self-checks **passed on the broken restore** —
the exact failure mode it exists to prevent. `policy_references_resolve`
asked "is any policy referencing a missing `auth` schema?", which is
vacuously true when those policies are the ones that failed to restore;
`truncate_granted_to_api_roles` passed because a database with no grants
at all has no TRUNCATE grants either.

Rewritten as **positive** assertions: the `auth` schema and its four
objects must be present; foreign keys to `auth.users` must exist; every
RLS-enabled public table must have an INSERT policy (with an explicit
allowlist for the regulatory reference tables and the three tables
written only through SECURITY DEFINER RPCs); the API roles must hold a
non-empty grant set.

Result on the broken restore: **4 critical failures**, naming all five
lost INSERT policies. Result on the healthy database: all nine OK.

#### C.4 Final status — **PARTIALLY CLOSED, and named as such**

Closed: the two procedure defects, the acceptance test, and the measured
scope of the artifact.

**Not closed:** an actual restore into a throwaway **hosted** project
with `POSTURE MATCHES`. Provisioning one is a billable account-level
action outside this pass's authority. Recovery remains **unproven** —
what is proven is that the previous procedure would have produced a
broken database and reported success, and that it no longer can.

### D. TRUNCATE re-verification (brief item 3)

Re-verified after all schema changes settled.

| Check | Result |
|---|---|
| TRUNCATE grants for `anon`/`authenticated` on any public table | **0** |
| `truncate public.sharing_grants` as `authenticated` | `permission denied` |
| `truncate public.calculation_results` as `anon` | `permission denied` |
| A table created by the migration role (`postgres`) | no TRUNCATE for either role |
| `postgres` default ACL, schema public | `anon=rxtm`, `authenticated=arwdxtm` — no `D` |
| `postgres` and `service_role` | retain TRUNCATE — legitimate server-side operations unaffected |

The migration's documented omission is now **proven bounded** rather
than asserted: `select rolsuper from pg_roles where rolname='postgres'`
→ `f`, and `supabase_admin` is absent from `postgres`'s
`pg_auth_members`. So `alter default privileges for role supabase_admin`
is genuinely unreachable from a migration, and its ACL still carries `D`
for both roles. That residual applies only to a table created *by
supabase_admin* in `public`; every table in this application is created
by a migration running as `postgres`, whose default ACL is fixed.

Also now enforced continuously: `compare-database-posture.mjs`'s
`truncate_granted_to_api_roles` self-check, which a restore must pass.

**Status — VERIFIED.**

### E. Re-attacked surfaces

Stated precisely, because the brief lists more surfaces than this pass
genuinely re-attacked. The fresh adversarial effort — five parallel
read-only agents plus direct psql probing — targeted the
calculation-write boundary and the declaration filing path. The other
surfaces were **not** re-attacked from scratch; they are covered by the
existing regression suites (1,626 tests, zero skips) and, for two of
them, by new continuous assertions. **Storage could not be re-attacked
at all** — the local container returns 503, the same environment
blocker §18 E records.

Outcome by surface:

| Surface | Outcome |
|---|---|
| Calculation-result forgery | **closed** (A), by fresh adversarial work |
| Declaration filing integrity | re-attacked: gate intact; `filed_snapshot` immutable against both `authenticated` (RLS) and `service_role` (trigger); a LOCKED shipment refuses new calculations |
| RLS / cross-org isolation / active-org pinning | no fresh attack; regression suites pass |
| Sharing, evidence, invitation authorization | no fresh attack; regression suites pass |
| Auth/session, callback redirects, rate limiting | no fresh attack; regression suites pass |
| Storage, storage path probing | **not re-attacked** — local Storage returns 503 |
| SECURITY DEFINER `search_path` | all set, and now asserted continuously by a posture self-check |
| TRUNCATE on the API roles | verified (D), and now asserted continuously by a posture self-check |
| Service-role isolation | the new adapter holds a private client and exposes exactly one operation |
| Append-only history | **strengthened** — grants revoked, not merely policies absent |
| Capability boundaries | strengthened — the trusted write channel re-checks IMPORTER_DECLARANT in SQL |

One new, genuinely reachable finding, **not** fixed:

**`calculation_results.line_id` is `ON DELETE CASCADE`**, and
`shipment_lines_delete_parent_not_terminal` lets a member delete a line
on any shipment that is not LOCKED or VOID. Deleting a line therefore
deletes its calculation history. Assessed rather than assumed:

- filed data is protected — filing LOCKs every member shipment, and
  LOCKED lines cannot be deleted;
- `audit_events` has **no** foreign key to `shipment_lines` (verified),
  so `calculation.computed` events, carrying the emissions figure in
  their payload, survive the deletion;
- removing a line from an unfiled shipment is a legitimate product
  action.

Classified **HIGH RISK / POST-RELEASE**, not a blocker: it discards
draft work, not a filed record, and the audit trail is independent.

### F. Regression (brief item 4)

Run on the working tree, with `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` exported — which is what keeps the skip
count at zero, since without them the protected regulatory adapter's
real-database suites silently skip.

| Gate | Result |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm test` | **1,626 passed, 0 failed, 0 skipped, 0 todo**, 138 files |
| `pnpm regulatory:verify` (production) | **`RESULT: VALID`**, 12,540/12,540 |
| `pnpm build` | exit 0; `postbuild` artifact assertion OK |
| Playwright | see below |
| Migration ledger | 63 applied both sides, **11 pending**, no drift |

The test count rose from **1,616 to 1,626** — the ten
new write-boundary cases. Skips are taken from the machine-readable
reporter output (`numPendingTests: 0`, `numTodoTests: 0`), not from the
terminal summary.

**Playwright, reported honestly across two runs.** The first full run
returned **37 passed, 9 skipped, 0 failed, 2 flaky**. The gate protocol
(§18 D.2, and §10.5 of the execution plan) requires **0 failed and 0
flaky**, so that run did not pass and is recorded rather than discarded.

The two flaky specs were `importer-journey` and
`cross-org-sharing-journey` — the two longest journeys, and the first of
them exercises the calculate step this change touches, so it was
investigated rather than assumed environmental:

- re-run alone with `--retries=0`, both passed: 58.3 s and 1.2 m against
  a 180 s per-test budget;
- the whole 48-test suite took **4.3 m** in the flaky run versus **2.3 m**
  earlier the same day for the identical set — roughly 87 % slower;
- the calculate step itself completed normally in both attempts.

The full suite was then re-run once, unchanged:
**39 passed, 9 skipped, 0 failed, 0 flaky (3.4 m).**

Conclusion, stated with its limit: the evidence says machine contention
under a loaded host, not a defect in the new write path — a slower
elapsed time on the two specs already closest to their timeout, both
comfortably inside budget when not competing, and a clean rerun. It is
not proof. What would settle it is the same suite on CI, which is
§18 D.1's outstanding gate.

The nine skips are unchanged from the P14 baseline: eight desktop-only
journeys on `mobile-chromium`, plus the Storage-gated
`actual-data-determination` spec, which is §18 E's environment blocker
and not a mobile-layout skip.

**The E2E artifact hazard stayed closed throughout.** `.next` is
byte-identical before and after a full Playwright run
(`c9614f5591…617992e` both times), `assert-clean-production-artifact
--require-artifact` passes afterwards, and `.next-e2e` is the artifact
carrying `E2E_RATE_LIMIT_BYPASS_BUILD = "true"` — which is the proof the
test still genuinely exercises the bypass rather than having been
weakened.

### G. Status

**SECURITY/RECOVERY REMEDIATION STATUS: READY FOR NEXT CERTIFICATION GATE**

Blocker 1 is closed and proven closed at the database boundary. Blocker
2's defects are closed and its acceptance test now demonstrably catches
the failure the old one missed — but recovery itself stays unproven
until a hosted restore runs, which is an owner-authorised action, not a
defect in the work. Item 3 is verified. Nothing was deployed; the
downstream certification gates from §18 (CI on the candidate SHA, the
hosted Storage E2E, the hosted restore, Auth templates, production
smoke) are untouched and still outstanding.

This remains a self-audit by the agent that implemented the work. It is
not the independent adversarial review.

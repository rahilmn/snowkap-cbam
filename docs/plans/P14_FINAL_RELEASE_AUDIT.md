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

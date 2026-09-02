# SNOWKAP CBAM — FINAL P13 RELEASE READINESS REPORT

**Date**: 2026-08-29 (updated 2026-08-30 with the blocker-remediation
round's results — see §15 items 9–15 and §16.6; updated again 2026-08-30
after the verified 24-commit checkpoint push to
`origin/feature/full-product-build` and a fresh Railway re-check — see §29;
updated again 2026-08-30 with a CI reliability fix, a documentation
correction, and a final coverage-backfill round closing every remaining
zero-coverage file — see §16.10; updated again 2026-08-30 with the R7/R9
regulatory resolver fix, its independent adversarial review, and two
real follow-up fixes the review found — see §11 and §16.6's "Iteration 7")
**Repository**: https://github.com/rahilmn/snowkap-cbam
**Branch**: `feature/full-product-build`
**HEAD**: `5ae588c` (pushed to and confirmed synchronized with
`origin/feature/full-product-build`; the 12-dimension adversarial audit
referenced throughout this report was launched while HEAD was `28bc578`,
completed and its results are fully incorporated in §16; commits between
this report's original `4eb4ff5` HEAD and current HEAD are the audit's own
§16.6 triage table, the blocker-remediation round that acted on it, R7/R9's
resolution and its own adversarial-review follow-up fixes (§11/§16.6), and
the CI fix/documentation/coverage-backfill round in between (§16.10))

This report supersedes any prior status summary given mid-session in this
conversation. Where this document and an earlier message in this session
disagree, trust this document.

---

## 1. Executive summary

Snowkap CBAM is a substantially built, extensively locally-verified,
multi-tenant CBAM compliance platform. Both required experiences —
**Importer/Declarant** (shipment intake → CN/TARIC classification →
regulatory resolution → deterministic calculation → full explainability →
reporting/export → declaration preparation) and **Third-country
Producer/Operator** (installation registration → actual emissions entry →
evidence → verification → controlled cross-org sharing) — exist, are
implemented, and were re-verified live in this session against a real local
Supabase instance, not mocks. The regulatory foundation remains protected
and passes its own integrity gate (`pnpm regulatory:verify`: `RESULT: VALID`,
12,540/12,540 records reconciled).

This session (a continuation of prior P7–P13 work) found and fixed
**thirteen additional confirmed defects** through direct investigation, plus
ran a final 12-dimension, 204-sub-agent adversarial audit (§16) that
independently confirmed **53 further findings** — 34 security, 19
regulatory. A dedicated blocker-remediation round then acted on that
triage (§15 items 9–15, §16.6): **13 of the 53 are now confirmed fixed** —
6 landed in this round (S10, S5, S6, S16, S17, S4, plus the single most
severe finding S12, the `shipment_lines.emission_determination` forgery,
which took 6 iterations and 3 independent adversarial reviews to actually
close; see §16.6's dedicated write-up), and 4 more (S7, S8, S9, S11) turned
out to already be fixed from an earlier round of this same session but had
been left incorrectly marked "Open" until this update corrected them. Two
more are documented as owner-decision memos rather than code fixes (the
regulatory pipeline's reference-table mutation, and the local-only
email-confirmation setting). Roughly 37 remain open and are fully triaged
and recorded by severity in §16, not silently left for a future reader to
discover. Every fix in this report follows the
same discipline: reproduce first (almost always live, against real local
Postgres, in a rolled-back transaction), fix the smallest safe scope, add
regression coverage, independently re-verify — and, for the highest-stakes
finding, independently re-review with a fresh adversarial pass before
trusting the fix at all. This session also ran a full
documentation-completeness audit and closed the highest-value gaps found
(stale counts, two outright false claims, a missing migration log).

**The Railway production deployment at
`https://snowkap-cbam-production.up.railway.app` is currently NOT reachable
— it returns a persistent `502 Bad Gateway` / "Application failed to
respond"** on every path checked, confirmed across multiple checks spanning
a significant time window with substantial other work done in between (not
a transient blip). This session has no Railway CLI, API token, dashboard, or
MCP connector — it cannot view deploy logs, build status, or environment
variable configuration, and cannot diagnose the root cause beyond what the
public edge response itself shows. **This is the primary blocker.**

**A second item, previously requiring owner input, is now resolved.** A
real, evidence-backed contradiction between the documented regulatory
country-fallback rule (R7/R9) and the resolver's actual behavior was
identified and, in a later round, resolved: the primary source (Commission
Implementing Regulation (EU) 2025/2621, Annex I, and its correction (EU)
2026/1740) was read directly once EUR-Lex's earlier platform outage
cleared, confirming the documented rule was correct all along. The resolver
was fixed via TDD and verified against real production data — see §11 for
the full analysis and resolution.

**Final classification: RELEASE BLOCKED — but on one blocker now, not
two.** See §37 for the exact, complete, current list. This is not a
disguised "minor limitations" framing — Railway is genuinely down and
cannot be independently fixed from this session without dashboard/log
access this session does not have.

---

## 2. Exact Git HEAD

```
5ae588c docs: record the R7/R9 adversarial review, its two follow-up fixes, and the governance question raised
```

Full HEAD SHA: `5ae588c6e152095ad65532dfcf9e8ffa9c99a756` (see `git rev-parse
HEAD` in the repository to reconfirm at any time). **Superseded note**: this
section previously cited `28bc578` — that was the HEAD when this report's
adversarial-audit-derived sections (§15/§16) were last substantively
updated, not a claim that nothing landed afterward. §16.10 and §11/§16.6's
"Iteration 7" write-up document everything committed between `28bc578` and
this current HEAD.

## 3. Branch / remote state

- Active branch: `feature/full-product-build`
- Working tree: **clean** (`git status` — nothing to commit)
- Remote sync: **pushed and confirmed synchronized** with
  `origin/feature/full-product-build` (0 ahead, 0 behind, verified via
  `git fetch` + `git rev-list --left-right --count` immediately before this
  update) — per standing instruction, still **never merged to `main`**
- `git diff --check`: clean (no whitespace errors)
- No secrets, generated artifacts, or debug files found in tracked output
  (re-ran the CI secret-scan pattern independently against the full
  working tree, using the same hardened check §16.10 describes: zero
  matches beyond the two already-allow-listed, genuinely non-secret
  local-dev markers)
- **Not merged to `main`** — per explicit instruction, this session never
  touched `main`

## 4. All completed phases

| Phase | Status |
|---|---|
| P0 | Done (repository/architecture audit) |
| P1 | Done (foundation hygiene, reproducibility, R7 fix, provenance, CI, domain foundation) |
| P2 | Done (Next.js shell, design system, staging skeleton scope — staging itself never provisioned) |
| P3 | Done (organizations, tenancy, minimal auth, audit spine) |
| P4 | Done (shipment intake, CN/TARIC classification) — CSV/XLSX bulk import explicitly NOT built (manual entry only) |
| P5 | Done (regulatory resolution integration, snapshots, resolution UI) |
| P6 | Done (calculation-rule register, embedded-emissions engine) |
| P7 | Done (actual emissions, producer workspace, installations/operators, evidence, verification, sharing) |
| P8 | Done (explainability, audit UI, reproduction proof) |
| P9 | Done (reporting, exports, declaration preparation) |
| P10 | Done (org management, roles, authorization hardening) |
| P11 | Done, independently re-verified against real local Supabase this session (security, observability, performance, backup/restore) |
| P12 | **Railway production deployment initiated by the owner but currently non-functional (502)** — BLOCKED |
| P13 | This report; final Opus-assisted security + regulatory audit completed this session (see §15/§16); documentation-completeness audit completed and highest-value gaps closed |

## 5. Product functionality

Screen-by-screen classification (verified against actual routes/code this
session and in the immediately preceding documentation-completeness audit,
not against documentation's own claims):

**Fully implemented (22 of 35 master-plan §27 screens)**: sign in/up/reset
(forgot-password + reset-password landed in the blocker-remediation round,
`7797e12` — see §16.6's S4 write-up; verified end-to-end against real local
Supabase + Mailpit, not merely unit-tested), onboarding, accept invitation,
org switcher, System/status, 404/500 error pages (no 403), shipments
list/create/detail, line editor, classification, emissions (importer),
suppliers, "Why this number?" panel, audit history, reports, declaration
preparation, org settings, team, installations, emission data entry,
evidence, verification actions, sharing, shared-data status.

**Explicitly, honestly not built** (matches README's own disclosure):
CSV/XLSX shipment import, a standalone resolution explorer/batch-resolve UI,
real importer/producer dashboards (post-sign-in landing at `/` is still the
literal Phase-2 placeholder page — `app/page.tsx`'s own comment still reads
"Application shell walking skeleton (Phase 2). Product screens begin at
Phase 4." — every other screen is reachable via the sidebar, not via this
landing page; re-confirmed live in this round via a local browser check), a
user-profile screen, a 403 error page, an importer-side
installations/operators view, a dedicated calculations route (the capability
exists inline in the shipment detail view).

None of these gaps were newly discovered as silent omissions this session —
all are now disclosed in `README.md` (five of them were undisclosed before
this session's documentation audit; see §31).

## 6. Importer journey

Verified live, locally, this session (not Railway — see §28 for why):
sign-up → email auto-confirmed (local dev) → onboarding with capability
selection → organization created → shipment created (`SHIP-VERIFY-001`,
release date 2026-03-15, reporting period auto-derived as 2026) → line added
via the CN/TARIC combobox (searched "cement" by description, selected a real
CN8 match `25232100` "White Portland cement") → origin `IN` + quantity `100`
tonnes → **default value resolved**: `EXACT_CN8_MATCH` → **calculated**:
`147 tCO2e` → expanded the full "Why this number?" trace (see §18) →
verified byte-identical reproducibility via the in-app "Verify
reproducibility" button, which returned "Reproducible — recomputing this
result from its stored inputs and recorded engine version produces an
identical output."

Also separately verified this session by the two E2E fixtures/specs
committed earlier (`tests/e2e/importer-journey.spec.ts`,
`tests/e2e/importer-auth-smoke.spec.ts`), which exercise the full
intake→LOCK path against real local Supabase.

Declaration preparation, reporting/export, and the full LOCK/declare flow
were not re-walked manually in this session's browser pass (time-scoped
decision) but are covered by the existing, passing E2E suite and by direct
unit/integration tests for `generateOrRefreshDeclarationDraft`,
`markDeclarationReady`, `recordDeclarationFiled`.

## 7. Producer/operator journey

Verified this session: signed into a producer-capability test
organization, confirmed the producer-side navigation (Installations,
Production data, Emissions, Evidence, Verification, Sharing, Activity) is
present and correctly capability-gated, confirmed the Installations screen's
empty state and operator/installation registration form render correctly.

**Correction (2026-08-30, found stale during this round's own live
verification)**: the paragraph above previously said "the same
dual-capability test organization" — inaccurate. `deriveExperience()`
(`components/shell/app-shell.tsx`, unchanged since it was first
introduced, per its own commit's history) shows the producer sidebar
**only** when an org holds `PRODUCER_OPERATOR` and *not*
`IMPORTER_DECLARANT` — a dual-capability org (both capabilities held)
gets the importer sidebar, by explicit, documented, tested design (its
own doc comment: "A real experience switcher for dual-capability orgs
is not yet built... a reasonable default until it is"). Live-confirmed
directly this round: adding `PRODUCER_OPERATOR` to an already-
`IMPORTER_DECLARANT` org via Organization settings, then hard-reloading,
still shows only the importer sidebar — producer screens remain fully
functional and correctly rendered, just reachable only by direct URL,
never via the sidebar, for a dual-capability org. Not a regression;
this has always been the behavior. See §35 for this now added as its
own disclosed limitation, since it wasn't listed there before.

Full data-entry → evidence → verification → sharing was not re-walked
end-to-end in this session's own browser pass (time-scoped decision, and the
existing E2E suite already covers it) — `tests/e2e/producer-journey.spec.ts`
and `tests/e2e/producer-auth-smoke.spec.ts` (committed and passing earlier
this overall effort) do exercise onboard→installations→data→evidence→verify→share
end-to-end against real local Supabase, and honestly document the one real
local limitation: Supabase Storage cannot run on this Windows host (confirmed
three separate times across this overall effort), so evidence-file upload's
Storage-layer RLS is shim-verified only, never against the real
`storage.objects` table, locally. Cross-org sharing (`tests/e2e/cross-org-sharing-journey.spec.ts`)
covers grant→consume→revoke→history-intact with two concurrent browser
contexts.

## 8. Emissions calculation engine

Live-verified this session (see §6): a real regulatory resolution and
calculation for 100 t of CN8 `25232100` from India produced `147 tCO2e`,
citing `RULE-EE-001` and its exact formula
(`line_embedded_emissions = quantity * resolution.values.total.value`),
with `quantity=100`, `specific_embedded_emissions=1.470`, direct `1.330` +
indirect `0.140`. The calculation-rule register
(`docs/regulatory/CALCULATION_RULE_REGISTER.md`) was independently audited
(via this session's documentation-completeness audit) and found to be the
strongest-verified document in the repository: no orphan rule IDs in either
direction, a clean FUTURE-DEFERRED boundary (a full repo sweep for hardcoded
markup/benchmark/certificate-price/de-minimis constants found none —
`parameter_datasets` persists as `[]`, liability fields stay `NULL`, never a
guessed zero), determinism and full-precision-preservation implemented and
tested. One found defect: a fixture the register cites (an
`OTHER_COUNTRIES_FALLBACK`/UNLISTED golden case for `RULE-EE-001`) does not
actually exist in the test file — a documentation-accuracy gap, not a
calculation-correctness one, left as a known limitation (§35) given time
budget.

## 9. Default vs actual

Confirmed via code review this session (not re-derived from scratch — this
was extensively built and tested in the P7 phase, and this session's
adversarial audit re-checked it): `DEFAULT` and `ACTUAL` methods are never
silently mixed. Falling back from a rejected/unresolved ACTUAL determination
to DEFAULT requires an explicit user action, never happens automatically.
Only `ACTIVE` + `VERIFIED` emission_data is eligible to back an ACTUAL
determination — enforced at both the application layer and, as of this
session's `20260829480000` migration, additionally at the database layer
(a direct client write of `status='ACTIVE'` bypassing the verify workflow is
now blocked by a trigger, closing a live-reproduced gap).

## 10. Regulatory resolution

The resolver (`src/domain/regulatory/resolve-default-value.ts`, protected
zone) implements rules R1, R3, R5, R6, R7 (clause 1), R8 (partially — see
below), R9–R11, R13, R14. This session found and fixed one genuine defect
(§14, protected-zone fix `e52b279`): the final "unique usable exact match"
fallback could silently substitute a different, non-requested production
route's value when the requested route's own record existed but was
unusable. Fixed, regression-tested, `pnpm regulatory:verify` reconfirmed
`RESULT: VALID` immediately after.

**Known incompleteness, not touched this session** (documentation-audit
finding, not independently re-verified by code inspection in this pass):
R8's "identify whether a more specific applicable source record exists" is
not implemented — `REFERENCE_REQUIRED` returns immediately rather than
attempting a child-record search; R12 defines 8 required trace elements,
7 are emitted (the "final reason" lives on the result object, not as a
trace step); `ValueStatus = "SOURCE_TEXT"` has no resolver branch and
degrades silently to `NO_MATCH` with no test. None of these are
newly-introduced regressions — they are pre-existing incompleteness this
session's documentation audit surfaced and is now recording honestly rather
than either fixing under time pressure or leaving undocumented.

## 11. Provenance / R7-R9 regulatory contradiction — RESOLVED (2026-08-30)

**Full standalone decision memo, now resolved:**
[`docs/regulatory/R7_R9_COUNTRY_FALLBACK_DECISION_MEMO.md`](../regulatory/R7_R9_COUNTRY_FALLBACK_DECISION_MEMO.md)
— §1–§11 preserve the original decision-request analysis verbatim; §12
records the resolution. This section summarizes both; the memo is the
authoritative version if the two ever diverge.

**Resolution**: EUR-Lex's platform outage (documented in the memo's own §8
as the reason this remained an owner-decision memo rather than an
implemented fix) had cleared. Both the primary source — Commission
Implementing Regulation (EU) 2025/2621, Annex I, fetched and read directly
at `https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32025R2621`
— and its correction — (EU) 2026/1740, `CELEX:32026R1740` — were read
directly, live, in a real browser session, not inferred or summarized.
Both state the identical rule, verbatim: *"Where a country or territory is
explicitly listed but no value is provided or the relevant field shows
'–', the default value for the respective good from the table 'Other
countries and territories' needs to be selected."* This confirms
Interpretation A: this repo's own R7 clause 2 / R9 text was correct all
along; the resolver's prior "authoritative once listed, never bypass"
behavior was the thing that needed to change.

**What was fixed** (`src/domain/regulatory/resolve-default-value.ts`,
commit `6094593`, TDD, smallest diff): the "requested country's exact
match is authoritative" early return is now scoped to exclude the specific
case where that match's own status is `UNAVAILABLE` — that case falls
through to the existing Other Countries and Territories fallback attempt
(the code path already existed for genuinely-unlisted countries; only the
guard needed narrowing, exactly as the memo's own §9 predicted before the
decision was reached). `REFERENCE_REQUIRED`, `NOT_APPLICABLE`, and
`AMBIGUOUS` are unaffected and remain fully authoritative, never bypassed —
R7 clause 2 / R9 name only the blank/"–" case; this scoping was already
established empirically in the memo's §7 and the fix matches it exactly.

**Verified against real production data, not just synthetic fixtures**:
India / TARIC `2507008080` is a real row in the ACTIVE dataset with status
`UNAVAILABLE` — confirmed live to now resolve via `OTHER_COUNTRIES_FALLBACK`
with a genuine non-zero value, one of the 361 (country, good) pairs the
memo's own investigation had already identified as affected.

**Gates**: `pnpm typecheck` clean; `pnpm test` — **1344 passed
/ 14 skipped / 0 failed** at final count; `pnpm regulatory:verify` — **RESULT: VALID**
(the dataset itself is untouched; only resolver logic changed). Full
detail, including the exact quoted primary-source text and every
downstream test affected, in the memo's §12 and commit `6094593`'s own
message.

**Independently adversarially reviewed, and two real follow-up fixes
landed** (memo §13, same day, later still): two independent agents
reviewed this fix — one adversarially re-derived the resolver logic by
hand, the other swept the UI/application layer. Both found real issues,
fixed via TDD/matching UI changes, not folded silently into the original
account: (1) a second, previously-untested resolver edge case (the
requested country itself being the Other Countries and Territories
sentinel — confirmed unreachable in production today, fixed anyway since
it's a protected-zone function); (2) the one genuinely material finding —
this fix made a combination reachable that an **unrelated** hardening
migration (`20260829610000`, the S12 forgery-fix trigger, §16.6) had never
anticipated and rejected outright, surfacing to real users as a misleading
"shipment is locked or void" error; found only by driving the real UI
end-to-end against real local Postgres, not by any unit test, typecheck,
or `pnpm regulatory:verify` run — all stayed green throughout. Fixed in a
new migration (`20260829620000`, forgery-fix iteration 7, three new live
integration tests) — see §16.6 and `docs/architecture/MIGRATION_LOG.md`.
Also fixed: `why-this-number-panel.tsx`'s "Why this number?" caption,
which inferred fallback usage from the wrong field and would have shown
"Origin mapped to 'India'" with no disclosure that the values shown
actually came from the fallback table. Live end-to-end verification
(fresh signup → real shipment → real line → real UI resolve action → real
"Why this number?" panel) confirmed the complete, correct chain — domain
resolver → database trigger → server action → React UI — working
together, not just individually passing tests.

**A governance point, addressed directly, not dismissed**: the resolver
reviewer flagged that the same session both judged the primary-source
evidence sufficient and implemented the fix, 46 seconds apart, matching
CLAUDE.md's "material regulatory behavior change" escalation category on
its face. The memo's own §13 addresses this directly: the user's own
standing instruction this round was explicit and conditional — implement
only if authoritative evidence established the answer unambiguously,
escalate otherwise — which is the human decision point exercised in
advance, not bypassed. The memo still explicitly invites the owner to
independently re-read the two primary-source URLs directly before treating
this as final for actual filings, rather than asking the reviewer's
concern to be taken on faith either way.

**What remains open, unrelated to this fix**: the memo's §7 scope note and
§35 below both still name the separate EU-origin/CBAM-scope question
(whether EU-origin goods should reach this resolver's fallback path at
all) as a distinct, still-open issue this fix does not touch.

## 12. Sharing

Cross-org sharing (issue grant → accept → consume shared ACTUAL data →
revoke → verify historical calculations remain reproducible after
revocation) is built, tested at the unit/integration level, and covered by
a dedicated E2E spec (`cross-org-sharing-journey.spec.ts`) using two
concurrent browser contexts, established and passing earlier this overall
effort. Not re-walked manually in this session's own browser pass
(time-scoped decision).

## 13. Auth / authorization

Extensively hardened this session and in the immediately preceding P13
adversarial-audit round. New in this session, most severe first: the
Auth email-link callback could no longer establish a session in any
browser that had signed in before, a critical regression this session's
own earlier httpOnly cookie hardening had introduced — fixed by moving
session establishment to a Server Action calling the SERVER client's
`setSession()` instead of the browser client's (commit `c34656a`); see §6
for the live, end-to-end reproduction-then-verification. Also:
`updateOrganizationProfile`
(the OWNER-only "danger zone" org-profile editor, including the
`capabilities` field every capability gate trusts) previously had no
role check inside the application service itself — only in its one Server
Action caller, unproven by any test. Fixed: the service now takes a full
`OrgContext` and rejects any non-OWNER caller with `PERMISSION_DENIED`
before touching the database; new tests prove ADMIN and MEMBER are both
rejected and OWNER still succeeds (commit `694218c`).

Earlier this overall effort: closed an open-redirect + session-fixation hole
on the Auth callback, an ADMIN-to-OWNER privilege escalation (both
application and RLS walls), a missing auth+rate-limit gate on
`searchCbamGoodsAction`, and wired capability enforcement
(`IMPORTER_DECLARANT`/`PRODUCER_OPERATOR`) into every gated service that was
missing it.

**Known, named, not fixed this session**: capability enforcement is Wall 1
(application) only — no RLS policy filters on `organizations.capabilities`
anywhere in the schema. This does not cross tenant boundaries (a caller can
still only touch their own org's rows), but "an org without
`PRODUCER_OPERATOR` cannot have installations" is an application convention
today, not a database-enforced invariant. Closing it is a schema-wide change
(a capability predicate added to every gated table's write policy) — named
explicitly in `AUTHORIZATION_MATRIX.md` as scoped to its own future
migration, not squeezed into this pass.

## 14. Tenancy / RLS

RLS is enabled on every product table; the standing two-org isolation test
suite (`tests/integration/*-isolation.test.ts`) runs for real against local
Postgres in this environment (confirmed: `supabase status` shows the API +
DB services up throughout this session). The final adversarial audit
workflow (§16) independently re-checked this dimension with extensive live
psql probes and found several real, if mostly narrow-blast-radius, gaps —
see §16.1's `rls-tenant-isolation` and `idor-org-ownership` dimension
findings (S5, and the several medium/low active-org-check gaps in the
"MEDIUM and LOW" list) — not fixed in this session, fully triaged there.

## 15. Security findings and fixes (this session)

Reproduced, fixed, regression-tested, and independently re-verified:

1. **Protected-zone regulatory resolver** — silent route substitution
   (`e52b279`). `pnpm regulatory:verify`: `RESULT: VALID` immediately after.
2. **`emission_data` verification transitions had no CAS guard** (`8c208b6`)
   — two concurrent legitimate transitions (e.g. one admin's VERIFY racing
   another's REJECT) could silently lose an update. Now returns
   `CONCURRENT_MODIFICATION` on a lost race, matching this codebase's
   already-established pattern elsewhere.
3. **`evidence_file_ids` anti-join crashed on a malformed entry**
   (`6d35bb8`) — a bare `::uuid` cast raised a raw Postgres `22P02` instead
   of a clean `42501` policy rejection. Required working around Postgres's
   own query-planner short-circuiting twice to actually force the cast to
   execute and prove the bug was real before fixing it. New migration
   (`20260829490000`) using the same `app.try_cast_uuid()` pattern this
   codebase already established for the identical defect class in
   `storage.objects`.
4. **`updateOrganizationProfile` had no service-layer role check**
   (`694218c`) — see §13.
5. **Installation-delete rejection message told users to do something that
   can never actually unblock deletion** (`e94fb60`) — corrected to state
   the real, permanent invariant (FK `ON DELETE RESTRICT` fires on row
   existence, not status; discard/revoke never delete the row).
6. Six accessibility/UX findings (`e80f03c`) — see §20.

Plus, from the full adversarial security+regulatory audit workflow run this
session (12 dimensions, 204 sub-agents, 3-skeptic adversarial verification
per finding — see §16 for the complete, final results):

7. **CRITICAL: Auth email-link callback could no longer establish a
   session in any browser that had signed in before** (`c34656a`) — a
   regression this session's own earlier httpOnly cookie hardening (item 8
   below, from `4b4f0bd` in this overall effort) had introduced. See §13/§6
   for the fix and its live, end-to-end reproduction-then-verification.
8. **Emission-unit guard validated only the denominator, never the
   numerator** (`4eb4ff5`) — `kgCO2e/t` silently accepted and computed as
   if it were `tCO2e/t`, a 1000x overstatement risk. `ENGINE_VERSION`
   bumped 1.1.0 → 1.2.0.

**Fixed in the blocker-remediation round that followed** (Bucket B triage,
§16.6 — full detail there, summarized here for this section's own
chronology):

9. **`shipment_lines.emission_determination` forgery** (S12) — 6
   remediation iterations, 3 independent Opus reviews, migrations
   `20260829500000` through `20260829610000`. See §16.6's dedicated
   write-up; this is the single largest piece of work in this round and
   deserves reading in full, not just this one-line summary.
10. **Last-active-OWNER cross-row race** (S10, `8dd2b06`) — a DB trigger
    closing a race no per-row CAS guard could reach.
11. **OWNER danger-zone RLS wall** (S5, `10b1dc6`).
12. **Evidence deletable from VERIFIED records** (S6, `4f5dda3`).
13. **ACTUAL determination `cn_scope` validation** (S16, `a3c2a41`).
14. **Rate limiting for 19 remaining mutation actions + 1 route handler**
    (S17, `14c7c3f`).
15. **Password reset flow** (S4, `7797e12`) — a genuine new feature, not a
    defect fix; see §16.6's own summary of the two bugs building it
    surfaced and closed along the way.

Two findings were originally left deliberately **not** code-fixed, each for
a stated, non-negligent reason — see §16.5: R7/R9 (S14, a regulatory
interpretation question genuinely requiring owner input) and the
regulatory pipeline's reference-table mutation (S13, inside the protected
zone, a policy decision rather than an obvious-fix defect). **S14/R7-R9 is
now RESOLVED** — see §11's full rewrite; the primary source was read
directly in a later round and the fix landed via TDD. S13 remains open,
genuinely still an owner-decision item. `enable_confirmations` (S3) was
documented as a required pre-go-live step rather than "fixed," since the
actual gap (no staging/production Supabase project exists to configure) is
not something this repo's own files can close.

37 further findings from the original 53-finding audit remain confirmed but
not individually fixed in this session — each is triaged by severity in
§16.1/§16.2/§16.6 (Bucket C/D), and none is silently dropped.

## 16. Final adversarial security + regulatory audit

Completed: a 12-dimension workflow (8 security, 4 regulatory), each
dimension independently searched by its own agent, every candidate finding
then adversarially re-verified by 3 independent skeptics (majority-must-not-
refute to survive). **204 sub-agents, 6,193 tool calls, ~2 hours of wall
time.** Every finding below was live-reproduced against this session's real
local Postgres instance (127.0.0.1:54322), almost entirely inside rolled-back
transactions — one finder's REST-API reproduction did not actually roll back
(a `Prefer: tx=rollback` header PostgREST does not honor) and left one
`shipment_lines` row holding a forged value; I found this immediately on
reading its own report, verified the forgery was real, ran its supplied
restore script, and confirmed the row's original data was recovered before
doing anything else with these results.

**Totals: 41 security candidates → 34 confirmed, 7 refuted. 23 regulatory
candidates → 19 confirmed, 4 refuted.** This is, bluntly, a lot of real
findings — this codebase has been through multiple prior review rounds this
session and in the phases before it, and this pass still surfaced 53
independently-confirmed issues. That is a genuine, material data point about
this platform's current state, not a reason to distrust the audit; every
confirmed finding carries a live reproduction, and the refuted ones (§16.4)
show the adversarial process does actually kill weak findings, not just
rubber-stamp everything found.

**Fixed across this session** (§16.1/§16.6 mark these as FIXED inline, with
commits): 12 of Bucket B's 16 HIGH findings, including the single most
severe one (S12, the `emission_determination` forgery, closed only after 6
iterations and 3 independent adversarial reviews — see §16.6's dedicated
write-up before trusting the one-line status). Of the remaining 4: S15 is
partially fixed, S3 and S13 are documented as owner-decision items rather
than code defects, and S7 is fixed in code but not fully verified end-to-end
(no real Storage service available on this host) — none of Bucket B's 16
distinct entries are simply "still open with nothing done," though S7's
verification gap is real and stated as such, not glossed over. Every one is
triaged and recorded honestly below, not silently left for a reader to
discover, per this codebase's own standing documentation convention.

### 16.1 Security — confirmed (34), by severity

**CRITICAL / self-inflicted — FIXED**

| # | Finding | Status |
|---|---|---|
| S1 | Auth email-link callback could no longer establish a session in any browser that had signed in before — this session's own earlier httpOnly-cookie hardening made the browser silently reject the client-side `setSession()` cookie write, so an invited/magic-link user kept acting as their original identity with no error surfaced | **FIXED** — `c34656a`: session now established via a Server Action calling `setSession()` on the server client (real `Set-Cookie` headers, which the browser cannot refuse). Verified live end-to-end reproducing the exact scenario (see §6/§13). |

**HIGH — 12 fixed (1 of those, S7, fixed in code but not fully verified end-to-end), 2 documented (owner decision pending), 1 partially fixed, 1 open by design (regulatory)**

| # | Finding | Status |
|---|---|---|
| S2 | Emission-unit guard validated only the denominator, never the numerator — `kgCO2e/t` silently accepted and computed as if it were `tCO2e/t`, a 1000x overstatement | **FIXED** — `4eb4ff5`: numerator now validated against the codebase's two established unit conventions; `ENGINE_VERSION` bumped 1.1.0→1.2.0. |
| S3 | The "confirmed email" authorization gate is vacuous under the Auth config this repo ships (`enable_confirmations = false` in `supabase/config.toml`) — six RLS policies and three RPCs trust `email_confirmed_at`, but GoTrue stamps it at signup with zero verification when confirmations are disabled | Documented, not code-fixed (`d4dd505`) — the setting only governs local dev; no staging/production Supabase project exists in this environment to configure. `docs/runbooks/DEPLOYMENT.md` §5 carries this as an explicit pre-go-live requirement. See §16.5. |
| S4 | No password reset or password-change flow exists anywhere — a promised P3/master-plan deliverable; a forgotten password or an invited account (provisioned with no password) is permanently unrecoverable through the product | **FIXED** — `7797e12`: `/forgot-password` + `/reset-password`, rate-limited, verified end-to-end in a real browser (request → real Mailpit email → PKCE code exchange → new password → signed in). Also fixed two bugs this surfaced: the auth callback page only handled the implicit hash-fragment link shape, not the PKCE `?code=` shape `resetPasswordForEmail` actually produces; and Supabase's password-complexity rejection needed a specific message instead of a generic one. |
| S5 | OWNER-only org "danger zone" has no RLS wall — any ADMIN can rewrite EORI/declarant-status/**capabilities** via a direct PostgREST call, with zero audit trail (no `organization.*` event type exists at all) | **FIXED** — `10b1dc6`: `organizations_update_admin_or_owner` replaced with `organizations_update_owner`, gated on `app.user_is_owner_of()`. The one existing test that had encoded the old ADMIN-permitted behavior as correct baseline (predating this session's Wall-1 fix) is updated. |
| S6 | Evidence backing an ACTIVE/VERIFIED — and already-filed — emission record can be permanently deleted from Storage by any plain org member; no lifecycle gate at any layer | **FIXED** — `4f5dda3`: both `removeEvidenceFile` and `evidence_files_delete_own_org` now refuse deletion once the owning record's `verification_status = 'VERIFIED'`, keyed so a DRAFT+REJECTED record stays fixable before resubmission. |
| S7 | The 'evidence' Storage bucket sets neither `file_size_limit` nor `allowed_mime_types` — the entire upload-safety control set (size cap, MIME/extension allowlist, executable block) is application-layer-only and bypassable with a direct Storage API call using the (intentionally) public anon key | **FIXED in code** (`d40d143`, migration `20260829510000`) — mirrors `MAX_EVIDENCE_FILE_SIZE_BYTES`/`ALLOWED_MIME_TYPE_EXTENSIONS` exactly. **Cannot apply locally** (`storage.buckets` does not exist on this host — confirmed via `to_regclass`), tracked applied via `supabase migration repair` per this repo's established precedent for storage-touching migrations; genuine end-to-end verification against a real Storage service remains outstanding, not fabricated as done here. |
| S8 | `audit_events.occurred_at` is entirely client-supplied and unconstrained — any MEMBER can backdate/future-date events, and 200 forged rows permanently push every real event off the org's only Audit screen (no pagination, no UPDATE/DELETE policy) | **FIXED** (`6cd0b4b`, migration `20260829520000`) — a trigger unconditionally overwrites `occurred_at := now()`. This session's own report previously left this row marked "Open" after the fix had already landed; corrected here after re-confirming live (a claimed `2999-01-01` insert is silently overwritten with the real current timestamp). |
| S9 | `removeEvidenceFile`'s array update is unguarded AND its error is uniquely uncaptured among this file's write paths — a lost race can leave `emission_data.evidence_file_ids` referencing a deleted file, which the P13 evidence integrity `WITH CHECK` then permanently rejects every future UPDATE against — bricking the record | **FIXED** (`b908cfb`) — the write's error is now captured, and on failure it retries once against a fresh read. Same stale-status correction as S8 above; re-confirmed the retry logic is present in the current code. |
| S10 | Last-active-OWNER invariant has no DB backstop and no CAS guard can cover it (the race is cross-row) — two concurrent demotions/deactivations by different ADMINs can leave an org with zero OWNERs, unrecoverable through the product | **FIXED** — `8dd2b06`: a `BEFORE UPDATE OR DELETE` trigger on `memberships` locks every other active-OWNER row via `SELECT ... FOR UPDATE` before counting, closing the cross-row race. A real bug (`SELECT count(*) ... FOR UPDATE` is invalid PostgreSQL) was caught and fixed before this landed. |
| S11 | `transitionShipmentStatus` is the one remaining state-transition service with no CAS guard — a lost race can write a fabricated permanent `shipment.locked`/`.voided` audit event, or drive DRAFT straight to terminal LOCKED bypassing the domain state machine | **FIXED** (`7aadfa5`) — the same `.eq("status", shipment.status)` CAS guard every other state-transition service in this codebase already uses, reporting `CONCURRENT_MODIFICATION` on a lost race. Same stale-status correction as S8/S9. |
| S12 | `shipment_lines.emission_determination` — the frozen regulatory provenance snapshot every "Why this number?" render and filed declaration trusts — is unvalidated JSON any org member can forge via a direct PostgREST write, with no audit event; live-reproduced (and, per the process note above, accidentally committed then restored) | **FIXED**, after 6 remediation iterations and 3 independent Opus reviews — see §16.6's dedicated write-up for the full, honest account (the first two attempted fixes were themselves found broken by independent review). Do not treat this one-line status as sufficient evidence on its own. |
| S13 | Regulatory pipeline mutates the shared `cbam_goods`/`countries`/`production_routes` rows in place — "supersede, never mutate" holds only for `default_emission_values` | Documented, not code-fixed (`236207f`) — inside the protected regulatory zone; a decision memo (`docs/regulatory/REGULATORY_REFERENCE_DATA_MUTATION_DECISION_MEMO.md`) presents options, pending an owner decision on which one to take. See §16.5. |
| S14 | R7 clause 2 / R9 country fallback confirmed as a live, reachable defect affecting 361 real (country, good) pairs at the CN8/TARIC10 level a shipment can actually declare | **FIXED** — `6094593`, a later round: the primary source (Commission Implementing Regulation (EU) 2025/2621, Annex I, and its correction (EU) 2026/1740) was read directly, confirming Interpretation A; fixed via TDD, verified against real production data, `pnpm regulatory:verify` RESULT: VALID. See §11. |
| S15 | `ENGINE_VERSION` not bumped across three historical behavioral engine changes | Partially fixed — current/future changes now correctly bump the version (`4eb4ff5`); the three historical unbumped changes cannot be retroactively fixed without violating the append-only history guarantee |
| S16 | ACTUAL determination never validates the emission_data record's `cn_scope` against the line's CN code — only the picker's list query enforces it; a hand-built request can attach a cement installation's data to a steel line | **FIXED** — `a3c2a41`: `determine-from-actual-data.ts` now cross-checks `cn_scope` against the line's `cn_code` via the existing `cnScopeCoversCnCode` predicate. |
| S17 | Rate limiting covers 9 endpoints, not the "mutation" endpoints master plan §28 requires — 17+ create/delete/transition Server Actions (including calculation and declaration actions) run unbounded | **FIXED** — `14c7c3f`: all 19 target Server Actions plus the evidence-download Route Handler now rate-limited, per-action limits reasoned from each action's own abuse/cost profile. |

**MEDIUM (12) and LOW (5) — open, full detail retained in the workflow transcript, not reproduced verbatim here for length:**
transitionShipmentStatus's earlier-reported CAS gap (medium variant) · organization capabilities enforced at Wall 1 only, no RLS reads `organizations.capabilities` (low — confined to the attacker's own tenant) · evidence_files DELETE has no lifecycle gate (low) · `recordDeclarationFiled` performs no active-org check on `declarationId` · `getShipmentDetail` takes no `OrgContext`/active-org check · `addLine` doesn't verify the parent shipment belongs to the caller's active org (unlike `updateLine`/`removeLine`, which do) · a grantee can never resolve the grantor org's name ("Unknown organization" everywhere) · an expired sharing grant still discloses the grantee org's full row · sharing-grant lifecycle events write to only one org's audit stream · a dual-membership user can accept an EXPIRED grant via policy OR-composition · a transient name-lookup error hides all pending sharing invitations · evidence downloads discard the original filename and serve inline (UUID filename on save) · an unhandled TypeError in the evidence MIME allowlist for prototype-chain keys (`constructor`, `__proto__`, etc.) · a malformed evidence id returns 500 instead of 404 · `activateEmissionData`'s supersede/activate writes have no CAS guard (false `emission_data.superseded` audit events possible) · `uploadEvidenceFile`'s array read-modify-write has no CAS (a concurrent upload can silently lose an attachment) · organization capability grants and EORI/declarant-status changes are entirely unaudited · `removeOperator`/`removeInstallation`/`removeSupplier` DELETEs have no row-count check (duplicate audit events on a race, not an auth bypass) · `APP_URL` unset in every environment means production team-invitation emails would link to `localhost:3000` · the structured logger has exactly one call site in the whole application (rate-limit rejections, auth failures, and 16+ swallowed persistence errors are invisible in production) · the sign-in rate limiter is bypassable by calling Supabase Auth directly with the (intentionally) public anon key, at 3x the rate the app believes it enforces.

### 16.2 Regulatory — confirmed (19), by severity

**HIGH (5)**

- **`shipment_lines.emission_determination` forgery** — same finding as S12 above (this dimension found it independently too, confirming it from the regulatory-integrity angle). **FIXED** — see S12's row and §16.6's dedicated write-up.
- **R7/R9 country fallback** — same finding as S14 above; independently confirmed via a live join across the ACTIVE dataset (361 affected pairs, 108 countries, 18 goods at the CN8/TARIC10 level; 0 pairs where REFERENCE_REQUIRED co-occurs with an available fallback, so the finding is precisely confined to the literal `UNAVAILABLE`/"–" case R7 clause 2 names). **FIXED** in a later round — see §11.
- **Emission-unit numerator gap** — same finding as S2; **FIXED** (`4eb4ff5`).
- **`ENGINE_VERSION` not bumped** — same finding as S15; partially fixed (`4eb4ff5`).
- **ACTUAL determination never validates `cn_scope` against the line's CN code** — same finding as S16. **FIXED** (`a3c2a41`).

**MEDIUM (10)**: regulatory pipeline mutates shared reference rows in place (= S13, documented via decision memo, not code-fixed — see §16.5) · no staleness signal exists for DEFAULT determinations when a newer regulatory dataset is activated (the ACTUAL path has one via `checkActualSnapshotStaleness`; DEFAULT has nothing) · `calculation_results.quantity`/`embedded_emissions_tco2e` carry no canonical-decimal CHECK and RLS permits a direct client INSERT — a literal `'NaN'` value passes every guard and propagates into the filed declaration's total · neither the picker nor the write path matches the ACTUAL dataset's reporting period to the shipment's, and the period is never shown to the user, so a prior-year dataset can be silently applied to the current year · `ActualEmissionSnapshot` omits the source record's `cn_scope`/period/owning org, so it isn't self-sufficient and the staleness check ends up comparing across different per-period lineages · the EU-origin CBAM scope gap (§35, already known) is disclosed nowhere in the *product* — no UI copy anywhere says "third country" or "CBAM scope"; only internal docs name it · Annex II sector membership is a hardcoded two-sector set with HYDROGEN's exclusion unexplained in the register.

**LOW (4)**: `checkRegulatoryResolutionSnapshotCompleteness` is dead code, never called in production, over provenance fields the DB nullably permits but currently never contains null · nothing at the DB level enforces "at most one ACTIVE dataset per type" (detective health check only, no preventive constraint) · CBAM-goods search/production-route lookup ignore effective-dating that the code-lookup path enforces (picker can offer what classification then rejects) · `resolveGoodSectorForActualLine` takes `candidates[0]` from an unordered, unconstrained multi-row lookup with no schema guarantee of uniqueness · SOURCE_TEXT total-emissions status has no terminal branch, reported as the more alarming NO_MATCH rather than its own honest reason · terminal unresolved-reason scan can report a reason belonging to a route the caller didn't request · `input.production_route` tested for truthiness rather than null-check, so an (unreachable-today) empty string would disable the route-substitution guard this session's own protected-zone fix (`e52b279`) added.

### 16.3 Cross-check against this session's own prior work

Several confirmed findings sit directly on top of fixes already landed this
session, and are worth calling out explicitly rather than leaving a reader
to reconcile them against §13/§15:

- S1 (auth callback) was **caused by** this session's own httpOnly fix
  (`4b4f0bd`, landed earlier in this overall effort) — now fixed (`c34656a`).
- S5 (org danger-zone RLS) sat directly next to this session's own Wall-1
  fix (`694218c`) — the audit confirmed Wall 1 held and Wall 2 didn't; Wall
  2 is now also fixed (`10b1dc6`, §16.6).
- S12/regulatory's `emission_determination` forgery is a close sibling of
  the `emission_data` forgery this session's predecessor work already fixed
  (migration `20260829480000`) — that fix never covered `shipment_lines`,
  which holds the equivalent frozen snapshot for the DEFAULT/importer side.
  Now fixed too, after the six-iteration process §16.6 documents in full.
- The R7/R9 finding (S14) independently reaches the identical conclusion
  §11 already reached before this workflow's results came back, now with a
  concrete, live-derived blast radius (361 pairs) instead of the external
  corroboration §11 had to rely on. §11 is retained as written; treat "361
  affected pairs, 108 countries, 18 goods" as the authoritative scope figure
  going forward. **This finding is now fixed** in a later round — see §11's
  full rewrite; this paragraph is preserved as the historical record of
  what the independent audit found, not a claim that it's still open.

### 16.4 Refuted (11 total — the adversarial process working as intended)

Confirmed false positives / already-mitigated / mischaracterized, each with
its own live counter-evidence in the workflow transcript: declarations
"readable by any MEMBER via RLS" (RLS actually matches the ADMIN+ page gate)
· `activateEmissionData`'s CAS gap (re-characterized as lower severity,
folded into the confirmed medium-severity version above) · `getCurrentOrgSummary` relying on RLS alone for deactivated-row filtering (RLS does correctly filter, live-verified) · `revokeInvitationAction` having no
application-layer authorization (RLS-only was found to be the intended,
sufficient design for this one action) · the evidence download route
lacking a rate limiter (assessed low-severity-refuted: no per-call cost
asymmetry that a limiter would meaningfully close) · the sign-in GoTrue
bucket shared across all users (re-verified as per-IP, not global) ·
`/api/health` being unauthenticated/unrated-limited (refuted at length —
the finding's own "service-role connection pool" premise doesn't exist in
this codebase's actual health-check implementation, and the endpoint is a
Railway platform healthcheck target that must stay reachable) · four
regulatory findings re-characterized as already covered by existing
controls once traced fully (`good_sector` snapshot completeness, duplicate
declaration/period total implementations, the Annex II direct-only rule's
DEFAULT-path enforcement, and the regime-boundary year being hardcoded —
each downgraded from its original framing after independent re-verification
found the actual risk narrower than first stated).

### 16.5 Findings needing owner-level attention beyond a routine fix

**`shipment_lines.emission_determination` forgery (S12) is no longer in
this section** — it went through six remediation iterations across a later
work session (§16.6's dedicated write-up has the full, honest account) and
is now fixed and independently re-verified. **§11's R7/R9 contradiction
(S14) is also no longer open** — a later round read the primary source
directly and implemented the fix (§11's full rewrite). One item remains
here, genuinely a policy/environment decision, not a code defect a fix
commit can resolve unilaterally:

1. **Regulatory pipeline reference-table mutation** (S13) — a decision memo
   (`docs/regulatory/REGULATORY_REFERENCE_DATA_MUTATION_DECISION_MEMO.md`)
   documents the mechanism and presents three options; no pipeline code was
   changed pending an owner decision on which one to take, per the same
   protected-zone discipline §11's own memo follows.

Also open, narrower in scope: `enable_confirmations = false` (S3) needs an
explicit decision — is this acceptable for local/dev only, with a
deployment-time requirement that any real environment sets it `true` (and,
correspondingly, a real transactional email provider, since Supabase Auth's
own SMTP is not production-grade), or does the whole email-confirmation
authorization premise need rethinking? Not decided or changed in this
session — flagged for the same reason §11's regulatory question is: a
material security-boundary/config decision, not a routine fix.
`docs/runbooks/DEPLOYMENT.md` §5 now carries this as an explicit,
checkbox-tracked requirement for whoever provisions the staging/production
Supabase projects, rather than leaving it as a bare open question.

### 16.6 Formal triage — every confirmed finding, one bucket each

Per explicit instruction: **A = RELEASE BLOCKER, B = HIGH (must fix before
release), C = MEDIUM (fix where safe and clearly in scope), D = LOW (may
remain documented)**. No finding is silently dropped — every one of the 53
originally-confirmed findings appears exactly once below. **12 of Bucket
B's 16 distinct entries are now ✅ FIXED** (up from 2 as of this table's
first version) — S2, S7, S8, S9, S11 fixed earlier in this session but not
correctly reflected as such when this table was first written (corrected
here after re-confirming each fix live), plus S12, S4, S5, S6, S10, S16,
S17 from the blocker-remediation round documented in §16.6's S12 write-up
and the table below. S15 is partially fixed (see its own row); S3 and S13
are documented, owner-decision items rather than code defects (see §16.5);
S14 duplicates Bucket A's regulatory entry. Every ✅ carries the
commit, kept in its original bucket so the triage itself stays an honest
record of severity, not retroactively softened once addressed.

**Bucket A — RELEASE BLOCKER (originally 2; now 1, per §37's current
state):**

| Finding | Status |
|---|---|
| Railway production deployment down (502) | Open — external, cannot fix from this session (§29) |
| R7/R9 regulatory fallback contradiction | ✅ **FIXED**, a later round (`6094593`) — primary source read directly, confirming Interpretation A; TDD, `pnpm regulatory:verify` RESULT: VALID (§11). No longer a release blocker. |

**Bucket B — HIGH, must fix before release (16 distinct findings; S14 listed once more below as a cross-reference to Bucket A):**

| Finding | Status |
|---|---|
| S1 Auth callback session regression | ✅ **FIXED** (`c34656a`) |
| S2 / regulatory Emission-unit numerator gap | ✅ **FIXED** (`4eb4ff5`) |
| S12 / regulatory `shipment_lines.emission_determination` forgery | ✅ **FIXED**, after 6 iterations and 3 independent Opus reviews — see the dedicated write-up immediately below this table; do not trust the one-line summary alone |
| S7 Storage bucket size/MIME limits | ✅ **FIXED** (`d40d143`) |
| S8 `audit_events.occurred_at` unconstrained | ✅ **FIXED** (`6cd0b4b`) |
| S9 `removeEvidenceFile` unguarded array update | ✅ **FIXED** (`b908cfb`) |
| S11 `transitionShipmentStatus` no CAS guard | ✅ **FIXED** (`7aadfa5`) |
| S15 `ENGINE_VERSION` not bumped (regulatory) | Partially fixed (`4eb4ff5`) — current/future changes now bump correctly; 3 historical unbumped changes cannot be retroactively fixed without violating append-only history |
| S3 `enable_confirmations = false` vacuous email gate | Documented, not code-fixed (`d4dd505`) — `supabase/config.toml`'s setting only governs local dev; there is no staging/production Supabase project in this environment to actually configure. `docs/runbooks/DEPLOYMENT.md` §5 now carries an explicit, checkbox-tracked pre-go-live requirement instead of a silent local-file "fix" that would not touch the real gap |
| S4 No password reset flow | ✅ **FIXED** (`7797e12`) — `/forgot-password` + `/reset-password`, rate-limited, verified end-to-end in a real browser against local Supabase + Mailpit (request → real email → PKCE code exchange → new password → signed in). Building this surfaced and fixed two adjacent bugs: the existing auth callback page only handled the implicit hash-fragment link shape, not the PKCE `?code=` shape `resetPasswordForEmail` actually produces (would have rejected every real reset link as "invalid or expired"); and Supabase's own `password_requirements` policy needed a specific, actionable error message instead of a generic fallback |
| S5 OWNER danger-zone has no RLS wall | ✅ **FIXED** (`10b1dc6`) — `organizations_update_admin_or_owner` replaced with `organizations_update_owner`, gated on `app.user_is_owner_of()`; the one stale test that had encoded the old ADMIN-permitted behavior as correct baseline is updated, plus a new dedicated RLS-level test |
| S6 Evidence deletable from ACTIVE/VERIFIED records | ✅ **FIXED** (`4f5dda3`) — both `removeEvidenceFile` (Wall 1) and `evidence_files_delete_own_org` (Wall 2) now refuse deletion once the owning `emission_data` record's `verification_status = 'VERIFIED'`, keyed on verification status alone (not `status`) so a DRAFT+REJECTED record stays fixable before resubmission |
| S10 Last-active-OWNER invariant has no DB backstop | ✅ **FIXED** (`8dd2b06`) — a `BEFORE UPDATE OR DELETE` trigger on `memberships` locks every other active-OWNER row via `SELECT ... FOR UPDATE` before counting, closing the cross-row race a per-row CAS guard cannot. Caught and fixed a real bug in this same migration before committing: `SELECT count(*) ... FOR UPDATE` is invalid PostgreSQL (aggregates and row locking can't combine in one query) — split into a `PERFORM ... FOR UPDATE` lock statement followed by a separate `SELECT count(*)`. Exempts service-role callers (no application code ever deletes an organization outright; only test/ops cleanup does, via a whole-org cascade that would otherwise trip this same invariant) |
| S13 Regulatory pipeline mutates shared reference rows in place | Documented, not code-fixed (`236207f`) — a decision memo (`docs/regulatory/REGULATORY_REFERENCE_DATA_MUTATION_DECISION_MEMO.md`), same posture as the R7/R9 memo: the pipeline's `countries`/`production_routes`/`cbam_goods` upsert-by-natural-key pattern is confirmed real and latent (never fired, since only one dataset has ever been loaded), but whether "keep reference data fresh on reload" or "reference data is append-only" is the correct design intent is a policy decision, not a defect with one obvious fix — changing protected-zone pipeline behavior without that decision would itself violate CLAUDE.md's discipline |
| S16 ACTUAL determination doesn't validate `cn_scope` against the line's CN code | ✅ **FIXED** (`a3c2a41`) — `determine-from-actual-data.ts` now cross-checks the chosen `emission_data` record's `cn_scope` against the line's own `cn_code` via the existing `cnScopeCoversCnCode` predicate, which the picker already used but the commit path never did |
| S17 Rate limiting doesn't cover 17+ mutation actions | ✅ **FIXED** (`14c7c3f`) — all 19 target Server Actions plus the evidence-download Route Handler now rate-limited on the established `createInMemoryRateLimiter` + `getClientIp()` pattern, with per-action limits reasoned from each action's own abuse/cost profile (60/10min for ordinary bulk creates down to 10/10min for recording a declaration as officially filed) |
| S14 R7/R9 (regulatory) | Same item as Bucket A's regulatory entry — listed once, in Bucket A. ✅ **FIXED**, a later round (`6094593`). |

#### S12 in full: the `shipment_lines.emission_determination` forgery fix, honestly accounted

This was explicitly the highest-priority finding of this remediation round,
and it earned that priority: the first attempted fix was completely broken,
and every subsequent iteration's independent review found something real.
Six iterations landed, three of them via a dedicated Opus review agent, one
finding self-discovered by re-reading the previous iteration's own fix
before the next review even ran. This section exists so a reader trusts the
✅ in the table above for the right reason — because the process held up
under repeated adversarial pressure, not because it went smoothly.

1. **Iteration 1** (migration `20260829500000`, commit `6b6a5a5`) — a
   `WITH CHECK` validating a DEFAULT/ACTUAL determination's claimed
   identity and values against the real regulatory dataset / `emission_data`
   table. **First independent Opus review found it completely bypassable**:
   the method-gate logic treated anything that wasn't the literal string
   `"DEFAULT"` as `"skip validation"`, including a *missing* `method` key —
   live-reproduced with a 250x understatement — and the `ACTUAL` branch was
   entirely unvalidated (the review's own test suite's 8th test asserted
   that gap as *intended* behavior).
2. **Iteration 2** (migrations `20260829530000`/`20260829540000`) — a full
   rewrite closing the method-gate inversion, adding real ACTUAL-branch
   validation, and (once a self-caught bug during re-verification showed the
   new SECURITY DEFINER function created a cross-tenant boolean-oracle
   disclosure — an org with zero relationship to an installation could
   probe a real row's private values by guessing and reading accept/reject
   outcomes) closing that too, gated on an org actually holding a sharing
   grant.
3. **Iteration 3/4** (migration `20260829580000`) — a **second** independent
   Opus review found the oracle from iteration 2 was *still* live (an
   INVITED-but-never-accepted, or REVOKED/EXPIRED, grant still let an
   unrelated org probe a DRAFT/SUPERSEDED record), the ACTUAL branch
   validated only 5 of `ActualEmissionSnapshot`'s 11 fields, Wall 2 enforced
   none of the status/evidence/cn_scope gates the application layer already
   did, and a DELETE destroyed a determination with zero audit trail. Rather
   than patch a fourth time, this iteration **rearchitected**: validation
   moved out of `shipment_lines`' `WITH CHECK` (re-evaluated on every
   UPDATE, which is what made two separate retroactive-breakage bugs
   possible) into a `BEFORE INSERT OR UPDATE` trigger that only validates
   when `emission_determination` itself changes — which in turn made it
   safe for the ACTUAL branch to finally require *current* authorization
   (an ACTIVE, unexpired grant) without the earlier oracle-vs-breakage
   tension.
4. **Iteration 5** (migration `20260829600000`) — a **third** independent
   Opus review found the DEFAULT branch, even after the rearchitecture,
   never verified the matched regulatory record had anything to do with the
   *calling line's own* declared `cn_code`/`origin_country` — live-
   reproduced as a real 100% understatement (a real, genuinely-matching
   record from a different good/country, e.g. Mali cement at 0.000 t, was
   accepted onto an India/steel line). This iteration tied both fields to
   the line, fixed a mutable-field bypass of the new cn_scope check (an
   attacker could change `cn_code` in a *separate* statement without
   re-triggering validation), replaced `=` with `is not distinct from`
   throughout (a missing jsonb key's SQL NULL had been silently passing),
   replaced a SQL `LIKE`-based prefix check with a literal one (a
   producer-controlled `%` in `cn_scope` could act as a wildcard), and
   added the DEFAULT branch's missing `resolved_at` check.
5. **Iteration 6** (migration `20260829610000`) — **self-discovered** while
   re-reading iteration 5's own cn_code/country fix before asking for a
   fourth external review: the identical binding had never been applied to
   `production_route_indicator`. Live-reproduced with a real
   production-route-specific record (a route can carry a substantially
   different value than the route-independent default for the same
   good/country) accepted onto a line declaring no route at all. Fixed with
   a 5th parameter and the same binding pattern.

**What did NOT happen, stated plainly**: no Opus finding was accepted
without this session's own independent live reproduction first (documented
in-session via rolled-back `psql` transactions, per CLAUDE.md's own
adversarial-testing discipline); no fix was declared complete without a
positive control proving legitimate determinations (same-org DEFAULT,
same-org ACTUAL, cross-org ACTUAL via an active grant, and the
`OTHER_COUNTRIES_FALLBACK` edge case specifically) still succeed; and this
write-up does not claim iteration 6 is provably the last one needed — the
honest position, given the demonstrated pattern of each pass finding
something the last one missed, is that this fix has now survived
substantially more adversarial pressure than anything else in this
codebase, not that it is mathematically proven complete. A fourth
independent review was not dispatched after iteration 6 given the
diminishing-but-nonzero marginal value against the token cost already spent
(three full review passes, ~550k tokens of adversarial analysis) — a
reasonable place to stop, not a claim that stopping was risk-free.

Every iteration's test suite (`tests/integration/shipment-line-determination-hardening.test.ts`,
30 tests as of iteration 6) was updated alongside its migration, `pnpm
typecheck`/`pnpm test` re-run clean after each, and each iteration is its
own separate, revertible commit: `6b6a5a5` (iteration 1, broken),
`34a9c35` + `e22fab1` (iteration 2, the rewrite plus the self-caught
oracle fix), `82d14f8` (iteration 3/4, the rearchitecture),
`62c4c25` (iteration 5, cn_code/country binding), `18c4aaf` (iteration 6,
production-route binding). One more real, separate bug surfaced while
testing iteration 5's own retroactive-breakage fix and is fixed in its own
commit (`f559143`): `service_role` had never been granted schema `USAGE`
on `app` at all, nor `EXECUTE` on several individual RLS-helper functions —
invisible until now because these were only ever reached via an RLS policy
evaluation, which `service_role` always bypasses, until a *trigger* (not a
policy) reached one of them for the first time. Purely an operational
reliability fix (`service_role` already bypassed every policy these
helpers back), not a security boundary change.

**Iteration 7** (migration `20260829620000`) — the epistemic humility in
the paragraph above turned out to be exactly right: this fix had not
survived every combination after all. Found not by a fourth adversarial
review of this trigger itself, but as a side effect of a *later,
unrelated* fix (the R7 clause 2 / R9 regulatory resolver fix, §11,
commit `6094593`) making a new combination reachable that iteration 6
had never anticipated — `country_mapping.status = 'MAPPED'` paired with
`reason = 'OTHER_COUNTRIES_FALLBACK'` (a listed country whose own record
is `UNAVAILABLE`, falling back to Other Countries and Territories; the
"OTHER_COUNTRIES_FALLBACK edge case" the iteration-6 positive controls
tested was specifically the *`UNLISTED`*-country version of that reason,
the only one reachable before §11's fix — a real but narrower
combination than the `MAPPED` one). Iteration 6's very first identity
check was unconditional and rejected the new combination outright,
surfacing to a real user as a materially misleading **"This shipment is
locked or void and can no longer be edited"** error — live-reproduced by
driving the real UI end-to-end (fresh signup → real org → real shipment
→ a real ACTIVE-dataset line, India/TARIC `2507008080` → "Resolve
default value") rather than by another round of adversarial code review;
neither `pnpm typecheck`, `pnpm test`, nor `pnpm regulatory:verify`
caught it, since nothing in the existing suite exercised this specific
reason/status combination against the trigger layer. Fixed with a
dedicated new branch validating the two halves of the new claim
separately (is the claimed country name real; does the matched record
genuinely come from the fallback table), leaving every other combination's
existing validation completely unchanged, plus three new live integration
tests (one positive, two negative controls proving the fix doesn't
weaken any existing anti-forgery check). `docs/regulatory/R7_R9_COUNTRY_FALLBACK_DECISION_MEMO.md`
§13 has the full account, including an independent adversarial review's
own write-up and a direct, unhedged response to a fair governance
question that review also raised.

The honest lesson, stated for whoever reads this next: a fix to one
subsystem (the regulatory resolver) silently invalidated an assumption
baked into a completely different subsystem's own hardening (the
forgery-fix trigger), and the only thing that caught it was *actually
using the product end-to-end*, not any of the automated gates. This is
exactly the scenario CLAUDE.md's "no artificial completion" section
describes and this report's own §42-equivalent standard exists to guard
against — recorded as a genuine instance of it working, not a footnote.

**Bucket C — MEDIUM, fix where safe and clearly in scope (17, not individually
fixed this round — each is real but narrower in blast radius than the
Bucket B items above, per the audit's own severity call):**

`transitionShipmentStatus`'s medium-severity variant (folded into the S11
fix above) · `recordDeclarationFiled` no active-org check on `declarationId`
· `getShipmentDetail` no active-org check · a grantee can never resolve the
grantor org's name ("Unknown organization") · an expired sharing grant
still discloses the grantee org's full row · sharing-grant lifecycle events
write to only one org's audit stream · evidence downloads discard the
original filename (UUID on save) · `activateEmissionData`'s supersede/
activate writes have no CAS guard · `uploadEvidenceFile`'s array
read-modify-write has no CAS · organization capability grants/EORI/
declarant-status changes are entirely unaudited · `APP_URL` unset means
production invite emails would link to `localhost:3000` · the structured
logger has one call site in the whole app · regulatory: no staleness
signal for DEFAULT determinations when a dataset is superseded ·
`calculation_results.quantity`/`embedded_emissions_tco2e` carry no
canonical-decimal CHECK · neither picker nor write path matches ACTUAL
dataset period to the shipment's · `ActualEmissionSnapshot` omits
`cn_scope`/period/owning org · EU-origin scope gap disclosed nowhere in the
product UI (the underlying gap is Bucket-A-adjacent by nature — already
covered in §35 — this is specifically the "say so in the UI" half) ·
Annex II sector membership hardcoded with HYDROGEN's exclusion unexplained.

**Bucket D — LOW, may remain documented (14):**

`addLine` doesn't verify parent shipment's active org (unlike sibling
functions) · organization capabilities Wall-1-only (confined to the
attacker's own tenant) · `evidence_files` DELETE no lifecycle gate (the
narrower, lower-severity companion to S6 above) · a dual-membership user
can accept an EXPIRED grant via policy OR-composition · a transient
name-lookup error hides pending sharing invitations · unhandled TypeError
in the evidence MIME allowlist for prototype-chain keys (`constructor`,
`__proto__`) · a malformed evidence id returns 500 instead of 404 ·
`removeOperator`/`removeInstallation`/`removeSupplier` DELETEs have no
row-count check (duplicate audit events on a race only, no auth-bypass
angle) · sign-in rate limiter bypassable via the (intentionally public)
anon key · regulatory: `checkRegulatoryResolutionSnapshotCompleteness` dead
code · no DB-level "at most one ACTIVE dataset" constraint (detective
check only) · CBAM-goods search ignores effective-dating the code-lookup
path enforces · `resolveGoodSectorForActualLine` takes an unordered
`candidates[0]` · SOURCE_TEXT status has no terminal branch · terminal
unresolved-reason scan can report a reason from an unrequested route ·
`input.production_route` truthiness check (an empty string, unreachable
today, would disable the route-substitution guard `e52b279` added).

**Refuted findings (11)** are not re-listed here — see §16.4; they received
no bucket because independent re-verification found them to be false
positives, already-mitigated, or mischaracterized.

CAS guards (`.eq()` predicates matching the pre-fetched state, rejecting
`CONCURRENT_MODIFICATION` on zero rows affected) are present on
`mark-declaration-ready.ts`, `generate-or-refresh-declaration-draft.ts`,
`resolve-line-emissions.ts`, and `manage-emission-data.ts`'s
`applyTransition` (fixed this session, §15 item 2). **The final audit
workflow (§16), specifically tasked with checking every other write path
for the same gap, found it is still missing in several more places**:
`transitionShipmentStatus` (no CAS guard at all — the one state-transition
service that still lacks it, S11), `activateEmissionData`'s supersede/
activate pair, `uploadEvidenceFile`'s and `removeEvidenceFile`'s
`evidence_file_ids` array read-modify-write, and `removeOperator`/
`removeInstallation`/`removeSupplier`'s DELETEs (row-count check only, lower
severity since RLS bounds these to org membership with no auth-bypass
angle). None fixed in this session — see §16.1 for each finding's exact
severity and failure scenario. The concurrency-hardening work done earlier
this overall effort was real and is not undone by this — it simply did not
reach every write path, and this audit is the first pass thorough enough to
find exactly which ones remain.

### 16.7 Final non-blocked-work audit, second round (2026-08-30)

Per the explicit instruction to continue all non-blocked work while §11
(R7/R9) and §29 (Railway) remain pending, a second, narrower audit ran
after the verified 24-commit checkpoint push — six parallel agents
(documentation accuracy, a *targeted* security review of files newer
than or not covered by §16's own launch point, test-coverage gaps,
production-config review, backup/rollback runbook accuracy, plus one
adversarial verify pass on the security finding), followed by direct
manual local browser verification (importer/producer sign-up,
onboarding, both nav trees, theme switching, mobile responsive, keyboard
focus). This did not repeat §16's own 204-subagent sweep — it targeted
what §16 couldn't have covered (files/commits that postdate its launch)
plus categories §16 didn't scope into (documentation, test coverage,
ops-runbook accuracy).

**Fixed in this round** (TDD where behavioral, typecheck+test re-run
clean after each, each its own commit):

- **Missing rate limiting, `app/team/actions.ts`** (adversarially
  confirmed) — `changeRoleAction`, `removeMemberAction`,
  `deactivateMemberAction`, `reactivateMemberAction`, and
  `revokeInvitationAction` had zero rate limiting, despite the S17
  remediation's own commit message citing this file as an example of
  "the pattern already established" — that was only ever true for
  `inviteMemberAction`. An authenticated ADMIN/OWNER session (including
  one from a stolen/leaked cookie) could otherwise script an unbounded
  loop of role/membership churn, flooding the audit trail on every call.
  Fixed with the same 30-per-10-minutes shape as the direct sibling,
  `revokeSharingGrantAction`. Commit `8345a03`.
- **Misleading hardcoded `snowkap.com/` URL prefix, onboarding form** —
  found live in the browser: the org-slug field displayed
  `snowkap.com/{slug}` as if that were the org's real URL. This app is
  not hosted at snowkap.com (the separate marketing site) and the slug
  is never used to build a URL under any domain anywhere in the code
  (grep-confirmed). Relabeled honestly instead. Commit `a47dcc8`.
- **Fourteen documentation files** with stale counts, drifted
  file:line citations, an overclaimed test-fixture case, an overclaimed
  ADR description, and five runbooks that predated Railway's existence
  and still said so. Full list and reasoning in commit `a46be77`'s own
  message; summarized: README/DATABASE_SCHEMA/MIGRATION_LOG's
  44-migration/967-test counts (now 56/1032); ENVIRONMENT.md's five
  drifted citations plus undercounted `SUPABASE_LOCAL_*` consumers plus
  a stale `.env.example` cross-check (corrected to 9-of-15, and the one
  genuinely missing var, `SUPABASE_LOCAL_JWT_SECRET`, added to
  `.env.example` itself); `CALCULATION_RULE_REGISTER.md`'s overclaimed
  UNLISTED/fallback fixture case; `ADR-0012`'s overclaimed
  signed-token-email transport (the real mechanism is a bare
  `invited_email` text match, no token, no email — README's own
  "Current state" already said so; the ADR now does too);
  `docs/runbooks/{DEPLOYMENT,ROLLBACK,INCIDENT_RESPONSE,SECRET_ROTATION,
  OPERATIONAL_DIAGNOSTICS}.md`'s "no Railway project is connected"
  claims, now materially wrong given §29's repeatedly-confirmed real
  (if down) deployment; `AUTHORIZATION_MATRIX.md`'s already-disclosed
  "~20 stale citations" confirmed *worse* on re-sampling (some now
  500+ lines off — a staleness disclosure was added, not a full
  re-grounding, given the scope); `BACKUP_RESTORE.md`'s drill-evidence
  function/trigger counts, now stale by the same 12 undocumented
  migrations.
- **Route-level capability gate was UI/UX-only for reads, not
  access-denial** (a follow-up round, after this subsection was first
  written) — found live in the browser, distinct from and more specific
  than §13's already-disclosed "no RLS wall for capability": navigating
  directly to `/shipments` (an importer-only route) as a
  producer-only-capability org rendered the full page shell (empty
  list, a working "New shipment" button, a working form) rather than an
  immediate "you don't have access" state — the sidebar correctly hid
  the link, but the route itself had no server-side capability guard on
  the read path. The write path itself was never a security hole
  (submitting correctly returned "Your organization is not set up as a
  CBAM importer/declarant" — Wall 1 held on the actual mutation), so
  this was a confusing/wasteful UX gap, not a data-integrity or
  authorization breach — **this distinction still stands**: fixing it
  does not close §13/§35's separately-disclosed "capability enforcement
  has no RLS wall" gap, which remains exactly as open as before (a
  different wall, a different layer). Fixed by adding one `layout.tsx`
  per route group (`app/(importer)`, `app/(producer)`) that checks the
  capability once and renders a shared denial component
  (`components/shell/capability-not-available.tsx`) instead of
  `children` when missing — covers all 14 pages under both groups
  without duplicating the check into each one. Verified live in both
  directions (producer-only org denied on `/shipments`, still works on
  `/installations`; a fresh importer-only org works on `/shipments` and
  `/shipments/new`, denied on `/installations`) — not merely typechecked.
  Commit `3b670df`.

**Found and reported, not fixed this round** (concrete, real, but
either non-trivial to fix correctly in the time available, or requiring
owner-level Railway access this session doesn't have):

- **Most concrete Railway 502 root-cause theory yet** (still
  unconfirmed — no Railway log access): the production-config review
  found and locally reproduced two independent, code-verified failure
  paths that would each present exactly as the observed persistent 502.
  **Path A (build-time)**: running
  `NEXT_PUBLIC_SUPABASE_URL="" NEXT_PUBLIC_SUPABASE_ANON_KEY="" NODE_ENV=production next build`
  in this repo fails outright while prerendering
  `/(importer)/declarations/page`, with `getServerSupabaseClient()`
  throwing because those two build-time variables are unset — and the
  `Dockerfile` declares them as `ARG`s with no default, relying entirely
  on Railway auto-forwarding its own project variables as matching-named
  Docker build args (`railway.json` has no explicit `args:` fallback
  mapping). If Railway's variables are missing, misnamed, or scoped to
  the wrong environment, the image build itself fails and no container
  is ever produced — presenting at the edge exactly as a permanent
  "Application failed to respond." **Path B (runtime)**:
  `app/api/health/route.ts` throws (caught, returns 503) if
  `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (separate *runtime*
  variables) are missing; `railway.json`'s healthcheck
  (`restartPolicyMaxRetries: 3`) would then exhaust its retry budget and
  leave the deployment permanently failed — again presenting as a
  persistent edge 502 on every path, matching root and `/api/health`
  being affected identically. **`docs/runbooks/DEPLOYMENT.md`'s own
  words already flagged the Railway-auto-forwarding assumption behind
  Path A as unconfirmed** ("this repo has not yet had a real Railway
  project to confirm it against") — that project now exists, and this
  is the most concrete lead yet for what to check first in its
  dashboard: confirm `NEXT_PUBLIC_SUPABASE_URL`/
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set as project/service variables
  with those exact names, and that `SUPABASE_URL`/
  `SUPABASE_SERVICE_ROLE_KEY` are set as separate runtime variables on
  the service — then check the actual build/runtime logs to see which
  (if either) actually occurred. Not claimed as the confirmed root
  cause; this session still cannot reach Railway to confirm either way.
- **Test-coverage gaps, several files, high severity** — confirmed by
  reading the actual test files, not assumed: `app/(auth)/actions.ts`'s
  `signOutAction` has zero coverage anywhere, and `signInAction`/
  `signUpAction`'s validation, email-confirmation, and success branches
  are untested (only rate-limiting and one generic error path are);
  `app/accept-invitation/actions.ts`'s two Server Actions each have
  exactly one test (rate-limit rejection) — every branch of both
  outcome-mapping switches is untested; `app/team/actions.ts`'s five
  newly-rate-limited actions (this round) still have no coverage of
  their actual mutation outcomes or `messageFor()` mapping, only the
  new rate-limit-rejection tests added alongside the fix above;
  `app/(producer)/sharing/actions.ts`'s validation and
  REJECTED-reason branches; `app/api/reports/export/route.ts`'s own
  regulated-numeric-precision XLSX-writing logic (the reason that file
  carries an extensive doc comment about a real historical
  `Number()`-narrowing bug) has zero regression coverage of its own —
  a future refactor could reintroduce that exact bug and nothing would
  catch it; `app/api/evidence/upload/route.ts`'s full
  rejection-reason-to-HTTP-status mapping is never exercised (the mock
  always returns `OK`); `server-client.ts`'s cookie adapter wiring,
  including the documented Server-Component-cannot-set-cookies catch,
  is never actually invoked by its own test. None of these are
  regressions from a previously-tested state — they are, and always
  were, real gaps, now enumerated rather than assumed absent. Not
  fixed in this round given the volume (writing each properly, per this
  codebase's own TDD standard, is a substantial undertaking on its own)
  — flagged here as the next concrete regression-coverage work, ranked
  roughly by severity as listed.
- **`BACKUP_RESTORE.md`'s own recommendation to re-run the drill
  verbatim before P13 sign-off** was not carried out in this round (it
  was flagged as stale, per the fix list above, but a fresh drill was
  not re-executed) — noted rather than silently left implied-done by
  the correction itself.

**Verified, not merely re-asserted**: `pnpm typecheck` and `pnpm test`
were re-run clean after every fix in this round (final count: 1032
tests passed, 14 skipped, same skip set as before — the six new tests
are the rate-limit-rejection coverage added alongside the team/actions
fix). Local browser verification covered: sign-up → onboarding
(producer capability) → producer dashboard/nav → Installations →
Emission data (confirmed live, contrary to one stale background dev-
server log from earlier in this session that reported a compile error
at `upload-evidence.ts:559` — a fresh dev-server restart and fresh
navigation to that exact route confirmed it compiles and renders
correctly today; that error was not reproducible against current
source, which contains no duplicate declaration at that location) →
light/dark theme toggle (both render cleanly, consistent contrast) →
mobile viewport (375×812, renders correctly, no horizontal overflow) →
keyboard focus (a real, visible focus outline confirmed via computed
style, not just visual inspection) → the shipments capability-gate
finding above. Railway itself was re-confirmed still down as part of
this same session (§29's own "re-verified 2026-08-30" note), separately
from this subsection.

### 16.8 Third round: capability-gate hardening, test-coverage backfill, and a real E2E-suite methodology finding (2026-08-30)

Continuing autonomously per explicit instruction, with both named
blockers (§11, §29) still open and untouched:

**Fixed**: the route-level capability-gate hardening described in
§16.7's own updated first bullet (`3b670df`) — covered there in detail,
not repeated here.

**Test-coverage backfill, six files, 73 new tests** (`0ba80bf`) — closes
every concrete gap §16.7 enumerated as "found and reported, not fixed
this round": `app/(auth)/actions.ts` (`signInAction`/`signUpAction`'s
validation, confirm-email, already-registered, check-email, and success
branches), `app/accept-invitation/actions.ts` (both actions' full
validation/unauthenticated/switch coverage), `app/team/actions.ts` (the
`messageFor()` mapping, previously entirely unexercised, plus the three
membership actions' own happy paths and `revokeInvitationAction`'s
branches), `app/(producer)/sharing/actions.ts` (both actions'
validation and REJECTED-reason mapping), `app/api/evidence/upload/route.ts`
(the full REJECTED-reason-to-HTTP-status mapping, previously always
mocked to `OK`), and `src/infrastructure/supabase/server-client.ts` (the
cookies adapter's `getAll`/`setAll` wiring, including the documented
Server-Component-cannot-set-cookies catch). Most notably,
`app/api/reports/export/route.ts` gained a real regression test for its
own regulated-numeric precision-preservation logic: it parses the
*actual* returned XLSX buffer via `exceljs`, asserts the exact-value
columns are `TEXT`/`numFmt '@'` and byte-identical to the source
`DecimalString`, and — critically — this was verified to actually catch
a regression, not just pass vacuously: the historical `Number()`-
narrowing bug this route's own comment documents was temporarily
reintroduced, the test was confirmed to fail (`expected 2 to be 3`), and
the change was then reverted with a clean `git diff` afterward. Every
file was independently confirmed passing on its own before being
combined; the combination itself (`pnpm test`: 1106 passed, 14 skipped,
up from 1033/14) and `pnpm typecheck` are both clean.

**A real, previously-undiscovered E2E-suite methodology finding**: running
`pnpm exec playwright test` as one batch (the default — `fullyParallel:
true`, no worker cap, both `chromium` and `mobile-chromium` projects)
against this session's dev server produced 11 failures, every one
`expect(page).toHaveURL` timing out on `/sign-up` (not redirecting to
`/onboarding`) or, in two cases, a create-shipment/start-declaration
action's own redirect not completing within the test's 5-second
assertion window. **Root-caused, not left ambiguous**: `signInAction`'s
own `SIGN_UP_RATE_LIMIT` is `{limit: 5, windowMs: 10 minutes}`
(`app/(auth)/actions.ts`) — every full-journey spec plus both auth-smoke
specs signs up a fresh account, and the suite's own natural sign-up
volume (7+ real sign-ups across its specs) exceeds that budget well
within one 10-minute run, regardless of worker count, since the limiter
is a single in-memory, per-process, per-IP counter and every local
Playwright request comes from the same IP against the same dev-server
process. Confirmed directly: `signUpAction`'s own dev-server log lines
show execution times collapsing to 2-10ms (vs. 200-2000ms for a real
Supabase round trip) exactly where the failures cluster — the
unmistakable signature of the rate-limit short-circuit firing before
Supabase is ever called, not a genuine slowdown or crash. The two
create-shipment/start-declaration timeouts were a *separate*, lower-
confidence cause (dev-server/Turbopack load from repeated back-to-back
runs, not a rate limit — those actions' own limiters, 60/10min and
30/10min respectively, were nowhere near exhausted) — and were laid to
rest definitively, not assumed: every one of the 7 spec files was then
re-run **individually** against a **fresh** dev-server process
(`--workers=1 --project=chromium`, one spec or a small independent
group at a time) and **every single one passed cleanly** — 5 full
journeys (`importer-journey`, `cross-org-sharing-journey`,
`producer-journey`, `importer-auth-smoke`, `producer-auth-smoke`) plus
`topbar-tablet-responsive` and all of `shell.spec.ts`'s 12 sub-tests.
This is direct, positive evidence that **none of this session's code
changes (the capability-gate layouts, the team/actions.ts rate-limit
fix, the onboarding text fix, or any of the six test-coverage files)
introduced any E2E regression** — the batch-run failures were entirely
a self-inflicted artifact of this session's own repeated testing (both
manual browser sign-ups and multiple back-to-back Playwright runs)
sharing one rate-limit window, which is the security control working
exactly as designed, not a defect.

**Update (§16.9 below, same day): this was fixed, and the rate-limit
attribution above was only ever a partial explanation.** At the time
this subsection was written, `pnpm exec playwright test` genuinely
could not reliably complete as a single local batch, and the sign-up
rate-limit collision described above is real and was a genuine
contributing factor (confirmed independently via the dev-server timing
signature) — but a *second*, unrelated, and more consequential defect
(a wrong-Supabase-project data leak under Next's standalone server) was
also present and was the actual cause of the specific residual failure
this subsection went on to describe as "left... not fixed this round."
Both are now fixed; see §16.9 for the full account of the second one,
including why the concurrency/load theory floated below turned out to
be wrong. Left as originally written, immediately below, for the
historical record of how this investigation actually proceeded rather
than silently rewritten to look like the right answer was found first
try.

Evidence upload (`app/api/evidence/upload/route.ts`) enforces MIME/extension
allowlisting, size caps, org-scoped storage paths (with a database-level
CHECK constraint pinning `storage_path` to the row's own `org_id`, closing a
live-reproduced forgery gap in an earlier review round), and signed,
short-lived download URLs — **at the application layer only**. **The final
audit workflow (§16) found the Storage bucket itself sets neither
`file_size_limit` nor `allowed_mime_types`** (S7, high severity) — since the
browser bundle necessarily ships the public Supabase URL and anon key
(by design, for RLS-enforced client access), any authenticated org member
can call the Storage API directly and upload an unbounded-size file of any
MIME type, bypassing every one of the application-layer checks above
entirely; the object would have no `evidence_files` row, so it would be
invisible to the app but still occupy paid storage indefinitely. Also found:
evidence backing an already-filed, VERIFIED record can be permanently
deleted by any plain org member with no lifecycle gate (S6), and download
URLs discard the original filename (saves as a UUID). None fixed in this
session — see §16.1. **Cannot be fully verified against a real Storage
backend locally** — Supabase Storage does not run on this Windows host
(reproduced three separate times across this overall effort); `storage.objects`
RLS is shim-verified only. Real Storage-backed verification needs a working
Railway/staging deployment — currently blocked (§28).

### 16.9 Fourth round: the E2E flake root-caused for real — a genuine wrong-Supabase-project data leak (2026-08-30)

**§16.8's own E2E finding is superseded by this section, not merely
extended — its "concurrency/load" attribution was wrong, and this
section says so plainly rather than quietly overwriting it.** Continuing
the same investigation immediately afterward (the residual single-spec
failure noted as "left as a disclosed, unresolved operational finding"),
this round definitively root-caused it — and it was never load-related
at all.

**The concurrency theory was tested and refuted, not assumed away**:
`--workers=1` (fully serial — no test runs concurrently with any other,
at any point) still reproduced the exact same failure, three times in a
row, on a completely fresh `.next` build each time. A pure function of
static inputs (which regulatory resolution is) cannot behave differently
based on unrelated tests having run earlier in the same process unless
something genuinely stateful is involved — this result is what
motivated dropping the load hypothesis and instrumenting for real
evidence instead of tuning further.

**Live Postgres instrumentation, not guesswork**: a temporary,
diagnostic-only redefinition of `app.emission_determination_matches_regulatory_record`
(applied directly to local Postgres via `psql`, never touching a
migration file, fully reverted afterward and confirmed byte-identical
to the committed definition via `provolatile` and a full function-body
diff) added a distinct `RAISE WARNING` at every one of its 21
false-returning branches. `docker logs supabase_db_snowkap-cbam` then
showed, for the real `authenticator@postgres` connection handling the
actual failing request: `DBG19 dataset not active/found id=8895df69-993b-49af-9a68-268019b214fe version=2026-definitive-corrected`
— the claimed dataset id didn't exist as ACTIVE in local Postgres at
all. Querying local `regulatory_datasets` directly confirmed there is
exactly one row, `efcd5c92-e7d5-4eef-ba79-d0ea642f6abb` — a completely
different id for the same version string. Querying the **hosted**
regulatory Supabase project directly (via `scripts/regulatory`'s own
`supabase/.temp/pooler-url` mechanism, the same connection path
`pnpm regulatory:verify` uses) confirmed `8895df69-993b-49af-9a68-268019b214fe`
is **that project's own ACTIVE `DEFAULT_EMISSION_VALUES` row, exact
byte-for-byte match**.

**Root cause, confirmed not inferred**: this dev machine's `.env`
documents the hosted regulatory project's credentials (needed for
`scripts/regulatory/*.py`/`pnpm regulatory:verify`, which deliberately
run against the hosted project); `.env.local` correctly overrides
`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`NEXT_PUBLIC_SUPABASE_URL`/
`NEXT_PUBLIC_SUPABASE_ANON_KEY` to the local instance for product code.
Next's own documented precedence (`.env.local` > `.env`) worked
correctly for `NEXT_PUBLIC_SUPABASE_URL` (inlined at build time,
confirmed local throughout) — but did **not** hold for the plain,
runtime-read `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` under Next.js
16's standalone production server (`node .next/standalone/server.js`,
exactly what `playwright.config.ts`'s `webServer` runs — the same
server every single E2E run in this whole investigation has used, isolated
runs included). A second, fresh diagnostic (application-level
`console.error` logging `process.env.SUPABASE_URL` directly at the
regulatory repository's own dataset-fetch call site) confirmed it
resolved to the remote URL **consistently, every single call**, not
merely on a first call later self-corrected — which is exactly why an
earlier attempted fix (hardening `src/infrastructure/supabase/client.ts`'s
memoized client to rebuild if env changes between calls) did not, on
its own, fix anything: the value never changed, it was simply wrong
the entire time.

Why did isolated single-spec runs used earlier in this session's own
investigation (§16.8, the previous round) consistently pass, if this
is a deterministic, always-wrong resolution? Not fully explained, and
not asserted as fact here — the practical determination did not depend
on resolving it further once the fix (below) was verified working
across multiple fresh runs. One plausible, unconfirmed contributor:
those earlier isolated checks were run before this diagnostic round's
own live queries against the hosted project (which required sourcing
`.env` into a shell for `pnpm regulatory:verify`), and some part of
the standalone server's env resolution may be sensitive to the
process tree's own inherited environment at spawn time in a way this
report did not fully characterize — flagged as an open question, not
papered over.

**Fixed, verified working, not merely theorized**:

1. `src/infrastructure/supabase/{client,admin-client}.ts` — both
   memoized clients now re-derive env on every call and rebuild if it
   differs from the cached value. Real hardening, kept even though it
   alone did not fix this specific case (see above) — TDD, both files
   previously had zero test coverage.
2. `playwright.config.ts` — rather than depend on Next's own
   standalone-server env-file loading (the actual root cause, outside
   this repo's control and not guaranteed stable across Next
   versions), explicitly parses `.env.local` then `.env` itself
   (matching Next's own documented precedence, first-value-wins) and
   passes the resolved values directly into `webServer.env`, which
   Node guarantees reaches the spawned process's real `process.env`
   regardless of the standalone server's own behavior.

**Verification, not assumption**: two consecutive full-batch runs
(`pnpm exec playwright test`, default settings — `workers: 3`,
`retries: 2`, `expect.timeout: 10_000`, the rate-limit bypass, and now
this fix, all together — with a fresh `.next` build each time) both
completed **24 passed / 0 failed / 8 skipped**. This is the first
fully green full-batch result across this entire multi-round
investigation. `pnpm typecheck` clean; `pnpm test` — 1121 passed, 14
skipped, re-run in isolation after an earlier concurrent run (racing
against a simultaneously-executing E2E batch, both hammering local
Postgres at once) produced 2-3 false-alarm integration-test failures
purely from resource contention, not a real regression, confirmed by
the clean re-run; `pnpm regulatory:verify` — `RESULT: VALID`.

**Scope honestly bounded**: this is a real, live-reproduced defect in
this codebase's client-caching pattern (fixed, general-purpose
hardening, kept regardless of the specific trigger) layered under a
genuinely local-dev-machine-specific configuration collision (a
checked-out `.env` pointing at the hosted project, present only on
machines that also run the regulatory pipeline locally) interacting
with a Next.js 16 standalone-server behavior this report does not
claim to fully understand or guarantee is fixed at the Next.js level
— only worked around, reliably, at this repo's own config boundary.
It would **not** occur in CI or Railway, neither of which has a
`.env` file at all (env vars are injected directly, with no file-based
precedence question). Full technical detail, including the exact
diagnostic methodology (temporary SQL instrumentation via `psql`,
confirmed fully reverted; the remote-project cross-check query), is
preserved in this session's own transcript for anyone who needs to
re-verify or extend this investigation.

### 16.10 Fifth round: CI reliability fix, a documentation correction, and closing every remaining zero-coverage file (2026-08-30)

With §16.9's E2E fix verified and both remaining blockers (§29's Railway
outage, §11's R7/R9 memo) still exactly as open as before — neither touched
this round, per standing instruction — this round continued the explicit
"remaining non-blocked work" list: security hardening, coverage gaps,
documentation, and production-config review.

**Fixed**:

- **CI secret-scan could silently no-op instead of failing** — a retried
  production-config-review agent found and locally reproduced that the
  scan's trailing `|| true` (`.github/workflows/ci.yml`, needed so "no
  matches" exits 0 under `set -euo pipefail`) also absorbed `git grep`
  itself exiting non-zero for a malformed `PATTERN`: the fatal error
  prints to stderr, but the captured `$MATCHES` variable stays empty and
  the step reports "no secrets found" and exits 0 — this security gate
  quietly becoming a no-op on some future edit to the pattern, with
  nothing in the workflow's own green checkmark to reveal it. Fixed by
  splitting `git grep` out and checking its exit code explicitly (0 or 1
  = ran fine, anything else = the scan itself is broken and must fail
  loudly) — verified locally against both the exit-1 (no matches) and
  exit-128 (malformed pattern) cases, and re-confirmed zero real matches
  against the current repo afterward. Commit `795c5e2`.
- **A false positive the fix above would have caught** — this report's
  own §29 quoted a build command with two empty, unquoted env-var
  assignments (`NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_ANON_KEY=
  ...`), which the scan's own `SUPABASE_(...)?\s*[:=]\s*['"]?[^$\s"']`
  branch matched — its `\s*` after `=` let the following word's first
  letter satisfy the "at least one non-space value character" check,
  even though both assignments were empty. Reworded to explicit `=""`
  quoting, which reproducibly no longer matches (verified both ways).
  Same commit as the doc correction below, `18880e0`, since both are
  documentation-only changes to the same file discovered together.
- **§7's inaccurate verification claim** — this report previously said
  producer-side navigation was confirmed present on "the same
  dual-capability test organization." Live-verified this round that this
  was wrong: `deriveExperience()` (`components/shell/app-shell.tsx`,
  unchanged since introduction) shows the producer sidebar only when an
  org holds `PRODUCER_OPERATOR` and not `IMPORTER_DECLARANT`, by explicit
  documented design — a dual-capability org gets the importer sidebar
  only (producer screens remain fully functional and correctly
  authorized via direct URL, just not linked from the sidebar). Not a
  regression; confirmed via `git log -p --follow` that this logic has
  never been different since its introduction, and that the introducing
  commit's own verification was against a producer-only org, never a
  dual-capability one — §7's claim was simply wrong from the start, not
  a later drift. §7 corrected with the actual verification scenario and
  a labeled correction paragraph; added as its own disclosed limitation
  to §35, since it had never been listed there. Commit `18880e0`.
- **Every remaining zero-coverage file with real behavior, closed** —
  two backfill rounds (seven parallel agents, then five), every agent
  independently confirming `pnpm typecheck` and its own `vitest run`
  clean before returning, then a full-suite re-run after each round to
  confirm no interaction effects:
  - Round one (155 new tests) targeted `app/`'s `actions.ts`/`route.ts` files a
    prior audit flagged as zero- or partial-coverage: `shipments/[id]`
    (7→44 tests), `evidence/[id]/download` (0→7), `declarations` (0→23),
    `emission-data` (0→33, including the ADMIN+-only verify/reject
    compliance gate), `organization` (0→13), `installations` (0→27,
    including `INSTALLATION_HAS_DEPENDENTS`), and `shipments`+`suppliers`
    (0→15). A systematic sweep afterward (every `actions.ts`/`route.ts`
    under `app/` checked for a sibling `.test.ts`) confirmed zero remain
    uncovered by this pattern. Commit `2f551e4`.
  - Round two (43 new tests) closed the last non-trivial files elsewhere
    in the tree with zero coverage, found via the same sibling-test-file
    sweep extended to `src/application/`, `src/infrastructure/`,
    `src/domain/`, and `components/`: the `declaration`/`shipment`/
    `emission-data`/`evidence`/`sharing-grant` row-mapper functions (real
    branching on ANNUAL/QUARTERLY period kinds and null-to-default
    coercions, previously untested because no prior round had reason to
    touch them), `get-latest-calculations` (including a multi-row test
    guarding the exact truncation/dedup bug class a prior P6 review
    found and fixed in this same function), `resolve-active-default-value`
    (the application-layer orchestration wrapper around the protected
    regulatory resolver — tested narrowly on its own wiring, with the
    real resolver mocked at the module boundary; **no file under
    `src/domain/regulatory/` or `src/infrastructure/regulatory/` was
    touched, read for modification, or exercised beyond its own existing
    test suite** — this stays fully outside the protected zone's
    TDD-defect protocol because nothing protected was changed), and two
    `components/shell/` cookie helpers (`get-preferred-org-id`,
    `switch-org-action` — the latter's `secure` cookie flag, gated on
    `NODE_ENV === "production"`, is asserted directly rather than left
    implicit). Files correctly excluded from this sweep: pure port
    interfaces (`organization-repository.ts`) and branded-type-only
    files (`src/domain/shared/ids.ts`) — neither has runtime behavior to
    test. Commit `0d0456a`.
  - Both rounds' generated diffs were spot-checked directly against
    their source files (not just trusted from the agents' own reports)
    — exact string/value assertions confirmed to match the real
    implementation, e.g. `organization/actions.test.ts`'s OWNER-only
    message and `emission-data/actions.test.ts`'s
    `PERMISSION_DENIED` message both checked byte-for-byte against
    `app/organization/actions.ts` and `app/(producer)/emission-data/actions.ts`.
  - Net effect: `pnpm test` moved 1121 → 1276 → **1319** passed / 14
    skipped / 0 failed across this round (§24); `pnpm typecheck` stayed
    clean throughout.

**Also fixed, immediately after the above** (a documentation follow-up,
same round):

- **`AUTHORIZATION_MATRIX.md`'s ~20 disclosed stale citations, regrounded**
  — actually more than the disclosed count once checked: all 30 of the
  document's `file:line` citations were re-verified against their own
  quoted anchor text, 20 were found drifted (some by as much as 602 lines,
  matching the "500-600+ lines" the document's own disclosure predicted)
  and corrected, 10 were already accurate. Line-number-only — no claim
  about which role/capability gates which service was re-audited or
  changed, since that substance was already confirmed correct by the
  original finding. Spot-checked directly against source afterward (not
  just trusted from the pass's own report): every checked citation's
  quoted anchor text matched exactly at its corrected line. The
  document's own staleness banner now records this regrounding rather
  than only the original finding.
- **`CALCULATION_RULE_REGISTER.md`'s "fixture that doesn't exist" claim in
  §35, found stale** — this had already been corrected in an earlier
  round (commit `a46be77`, §16.7) with an honest in-place correction
  paragraph in the register itself; §35 below was simply never updated to
  stop listing it as open. Corrected in §35.

**Not fixed, deliberately out of scope this round**: the pre-existing
documentation staleness already disclosed in §35 for the three
architecture docs (`DATABASE_SCHEMA.md`, `DOMAIN_MODEL.md`,
`ARCHITECTURE.md`) — untouched, still exactly as disclosed; no other
document-wide regrounding pass was run beyond the two items above. §29's
Railway outage and §11's R7/R9 memo remain the only two items changing
the RELEASE BLOCKED classification (§37), and neither was touched this
round, per standing instruction.

### 16.11 Railway brought up for real, and the product verified against it (2026-08-30)

The owner opened Railway dashboard access this round, which finally made
§29's blocker diagnosable. Two distinct root causes were found — the second
strictly worse than the first, and invisible until the first was fixed.

**Root cause 1 — wrong branch (the 502).** Verified from the repository
*before* touching Railway: `origin/main` is 228 commits behind, and its
entire root tree is `.gitignore .vscode data docs package.json
pnpm-lock.yaml pnpm-workspace.yaml scripts src supabase tsconfig.json` — no
`Dockerfile`, no `railway.json`, no `next.config.ts`, no `app/`, no Next.js
dependency. Its `package.json` declares `"main": "index.js"` with no
`start` script. That is a complete, verifiable explanation for
`Cannot find module '/app/index.js'`: no Dockerfile → Nixpacks → no start
script → `node index.js` → crash → edge 502. The Railway dashboard then
confirmed "Branch connected to production: **main**" visually. Fixed by
pointing the service at `feature/full-product-build`.

**A configuration wrinkle found en route**: Railway's Config-as-Code is
deprecated, and *"starting 2026-08-28, services that have never used Config
as Code cannot opt in"*. This service never had, so **`railway.json` is
ignored by this deployment** — its builder, healthcheck path, timeout and
restart policy had to be set manually in the dashboard. The repo's
`railway.json` is now effectively documentation-only for this service. Any
future claim that it drives deploy configuration should be read with that
caveat.

**Root cause 2 — the hosted database had no product schema (the false
green).** With the branch fixed, `/api/health` immediately returned
`{"status":"ok",...}`. That was a **false positive**. A direct read-only
query against the hosted project found **6 tables** — `cbam_goods`,
`countries`, `default_emission_values`, `production_routes`,
`regulatory_datasets`, `regulatory_sources` — and a last applied migration
of `20260827130000`. **Four of 57 migrations were applied. Zero product
tables existed.** `/api/health` passed anyway because it checks only
database reachability and the ACTIVE-dataset invariant, both satisfied by
the regulatory foundation alone. Even the 5th *regulatory* migration
(`20260828100000_authenticated_read_regulatory_data`) was missing. This is
recorded prominently in §32 because a green health check that cannot
detect a completely absent application schema is a monitoring gap worth
knowing about, not just a one-off.

**Migration applied with the protected dataset verified before and after.**
Pre-flight analysis established that no pending migration mutates
regulatory data: the only `UPDATE` against a regulatory table in the whole
directory is in `20260827110000`, which was already applied and therefore
not in the push set; every pending migration referencing regulatory tables
only reads them or adds SELECT policies. A `--dry-run` confirmed exactly 53
pending migrations. After applying: **21 tables**, RLS enabled on **21 of
21**, `default_emission_values` still **12,540 rows**, exactly **1 ACTIVE**
dataset (`2026-definitive-corrected`), and `pnpm regulatory:verify` →
**RESULT: VALID** with full 12,540/12,540 field-level reconciliation
against the hosted database. The protected dataset came through untouched.

**Product verified against the live deployment** (`https://snowkap-cbam-production.up.railway.app`):

| Check | Result |
|---|---|
| Sign-in | PASS |
| Organization onboarding + capability selection | PASS |
| Audit spine (`organization.created` recorded) | PASS |
| Shipment creation | PASS |
| CN/TARIC live search against real regulatory data | PASS (proves `authenticated_read_regulatory_data`) |
| Regulatory resolution | PASS — `OTHER_COUNTRIES_FALLBACK` |
| Calculation | PASS — 10 t x 0.280 = **2.8 tCO2e** |
| "Why this number?" full chain | PASS — determination, trace, RULE-EE-001, reproducibility affordance |
| Cross-tenant RLS (stranger vs 6 tables) | PASS — 0 rows everywhere |
| IDOR by exact known UUID | PASS — `[]` for organizations/shipments/shipment_lines |
| S12 determination forgery, by an *authorized owner* | PASS — rejected `42501`, real value `0.280` intact |
| Service-role key in client bundle | PASS — absent (668KB / 14 scripts scanned) |

The resolution result is doubly significant: `OTHER_COUNTRIES_FALLBACK` on
India/TARIC `2507008080` is only reachable if the deployed build contains
both the R7/R9 resolver fix (`6094593`) and the v7 validator migration
(`20260829620000`) — so it simultaneously verifies the regulatory fix in
production *and* establishes the deployed code version behaviourally,
compensating for the unset `GIT_SHA` (§30).

**New blocker found by deploying for real — signup is broken for real
users.** Probing the Auth API directly returned
`{"error_code":"over_email_send_rate_limit"}` on a valid address (and
`email_address_invalid` for `@example.com`, which is simply a blocked test
domain, not a defect). This establishes that **email confirmation is
enabled with no custom SMTP configured**, so the project falls back to
Supabase's built-in sender — heavily rate-limited and typically delivering
only to project team members. **No real user can complete signup today.**
This is adjacent to the known S3 finding but distinct and more severe: S3
is "the confirmation gate is vacuous when disabled"; this is "signup fails
outright when enabled without SMTP". Requires an owner decision plus SMTP
credentials (Resend/SendGrid/SES). For validation purposes this round,
confirmed test users were provisioned via the service-role admin API
(`email_confirm: true`) — exactly how this repo's own integration suites
provision users — which bypasses email without weakening any production
setting.

**Architecture note, disclosed not buried**: this makes one Supabase
project serve as both regulatory-reference host and application database.
That is consistent with the repo's single ordered migration sequence, but
master plan §29 envisions separate Supabase projects per environment.
Acceptable for reaching a verified deployment; should be revisited before
real customer data.

### 16.12 Producer journey and cross-org sharing, verified live in production (2026-08-30)

Continuing §16.11 against `https://snowkap-cbam-production.up.railway.app`
with the same real hosted database. Test users were provisioned via the
service-role admin API (`email_confirm: true`) because SMTP is unconfigured
(§16.11) — **no production Auth setting was weakened to enable this**;
confirmations and rate limits both remain on.

**Producer journey — all PASS:**

| Step | Evidence |
|---|---|
| Producer org onboarding | `PRODUCER_OPERATOR` capability set; **producer sidebar rendered**, confirming `deriveExperience()` live |
| Operator registration | `Gujarat Clay Works (IN)`, `provenance = OPERATOR_PROVIDED` |
| Installation registration | `Bhuj Calcination Plant (IN)` |
| Emission data entry | 2026 / `2507008080` / v1, direct `0.155`, indirect `0.045`, EU METHOD |
| **Incomplete-evidence gate** | Recorded as `DRAFT/UNVERIFIED/Incomplete` with *"Additional evidence is required before these actual emissions can be used as verified data"* — saved and editable, but explicitly NOT consumable |
| Evidence upload | `verification-report.pdf` stored at org-scoped path `{org}/{emission_data}/{uuid}.pdf` with sha256 recorded |
| Submit → Verify | `VERIFICATION_PENDING` → `VERIFIED` with `verifier_user_id` captured |
| Activate | `ACTIVE / VERIFIED` — only now consumable |

**Upload safety controls — verified live through the real route handler**
(driven from inside an authenticated browser session, so the genuine
Server-side route ran, not a mock):

| Attempt | Result |
|---|---|
| `malware.exe`, `application/x-msdownload` | **415 `EXECUTABLE_EXTENSION`** |
| `payload.exe` spoofing `application/pdf` MIME | **415 `EXECUTABLE_EXTENSION`** — extension check catches the MIME spoof |
| genuine `verification-report.pdf` | 200, `fileId` returned |

**Finding S7 verified for the first time ever.** The `evidence` Storage
bucket on the hosted project carries exactly the controls migration
`20260829510000` specifies: private, `file_size_limit = 20971520` (20 MiB),
and a MIME allowlist of pdf/png/jpeg/docx/xlsx. §16.1 recorded S7 as "fixed
in code but **cannot apply locally** … genuine end-to-end verification
against a real Storage service remains outstanding, not fabricated as done
here." That outstanding verification is now **done**, against real Storage.

**Cross-org sharing — the full lifecycle, all PASS:**

| Stage | Evidence |
|---|---|
| Grant issued | `INVITED`, `invited_email` set, `grantee_org_id` NULL (resolves on acceptance) |
| **Pre-acceptance leak check** | grantee sees `emission_data` **0**, `evidence_files` **0**. The installation *profile* IS visible — via the explicitly purpose-named policy `installations_select_via_pending_sharing_grant_invitation`, so an invitee can see what they are being offered. Intentional and correctly scoped, not a leak: the sensitive payload stays hidden until acceptance. |
| Acceptance | grant → `ACTIVE`, `grantee_org_id` resolved; invitation screen correctly named grantor, installation, expiry and receiving org |
| Grantee read access | `emission_data` **1** row; stranger org still **0** |
| **Grantee is read-only** | UPDATE → 0 rows, DELETE → 0 rows, `direct_specific` still `0.155` |
| Consumption | line determination → `ACTUAL`, snapshot carries `sharing_grant_id` provenance, frozen `direct = 0.155`, frozen `verification = VERIFIED` |
| Dual-org audit | producer: `sharing_grant.issued`, `sharing_grant.data_consumed`; importer: `sharing_grant.accepted`, `emission_determination.redetermined` |
| Calculation from shared data | **2.0 tCO2e** = 10 t x (0.155 + 0.045) — arithmetic verified |
| **Append-only history** | the original DEFAULT result (2.8 tCO2e) is preserved alongside the new ACTUAL result, not overwritten |
| **Revocation** | grantee immediately sees `emission_data` **0**, `installations` **0**, `evidence_files` **0** |
| **Historical integrity after revocation** | both calculation rows still present; ACTUAL result still `2 tCO2e`; frozen snapshot still `direct 0.155 / VERIFIED`. Nothing clawed back — exactly the §9 guarantee. |

One methodology note, stated plainly: the revocation itself was applied as
a direct `status = 'REVOKED'` update rather than through the producer's
revoke Server Action (which has its own unit coverage). What was being
verified here is the RLS/consequence half — access denial and historical
survival — and that half is genuinely end-to-end.

**Two UI findings, both real, neither a security issue:**

1. **Seven sidebar items are dead links.** `components/shell/sidebar.tsx`
   defines them with no `href`, so they render as inert placeholders:
   producer *Dashboard*, *Production data*, *Evidence*, *Verification*;
   importer *Calculations*, *Installations*; plus *Settings*. The
   underlying features are not missing — evidence upload and the whole
   verification lifecycle both work, inline on `/emission-data` — but the
   navigation advertises destinations that go nowhere, and `/verification`
   returns a 404. For a release candidate this is a visible quality gap.
2. **"Unknown organization" confirmed live, and narrower than documented.**
   §16.1 listed *"a grantee can never resolve the grantor org's name
   (Unknown organization everywhere)"* as a MEDIUM finding. Live, the name
   resolves **correctly** on the accept-invitation screen, but shows
   "Unknown organization" in the `/emissions` shared-in table and in the
   line's actual-data picker. So the finding is real but scoped to those
   two surfaces, not universal. For a product whose value proposition is
   provenance, an importer being unable to see who supplied the emissions
   figure they are about to declare is worth fixing before go-live.

### 16.13 Reporting, exports, and the live UI/responsive/a11y sweep (2026-08-31)

**Both UI findings from §16.12 fixed and verified live** (commit `585c569`):

- **"Unknown organization" root-caused -- and it was never an application
  bug.** `list-available-actual-data.ts` already performed a follow-up
  `organizations` lookup and deliberately degraded to the placeholder only
  when that query SUCCEEDS but an id is absent. That is exactly what
  happened: RLS returns no row, because a grantee has no membership in the
  grantor org, and `organization_visible_via_pending_invitation` covers
  only the PENDING window -- which is precisely why the name resolved on
  `/accept-invitation` and vanished the moment the grant went ACTIVE.
  Fixed with `public.sharing_counterparty_org_names()` (SECURITY DEFINER,
  returns ONLY `(id, name)`, gated on a currently-ACTIVE unexpired grant in
  either direction). Deliberately NOT fixed by widening `organizations`
  RLS, which would have disclosed the counterparty's whole row
  (`eori_number`, `cbam_declarant_status`, slug). Verified live: importer
  resolves "P13 Production Producer Ltd"; a stranger org gets `[]`; the
  importer still cannot read the producer's full row.
- **Sidebar placeholders -- earlier characterisation corrected.** These
  were never "dead links": they already rendered as `<button disabled>`,
  which assistive tech announces correctly. The real defect was purely
  visual -- identical styling to enabled items. Now dimmed (opacity 0.6)
  with `title` and an sr-only "(not available yet)". *Dashboard*, which
  does have a real route, is now wired to `/`.

**Reporting and exports -- verified live against persisted data:**

| Check | Result |
|---|---|
| Period report | 1 shipment / 1 line / 1-of-1 calculated, **total 2 tCO2e** |
| Cross-check vs `calculation_results` | **exact match** |
| Breakdowns | by CN/TARIC, origin, route, and determination method (ACTUAL) |
| Completeness section | "Every line in this period is determined and calculated" |
| CSV export | verified by intercepting the Blob: every field matches the database, incl. engine `1.2.0` and `2` tCO2e, with full provenance columns |
| XLSX export | HTTP 200, valid OOXML |
| Official-filing claim | correctly disclaimed on-screen as "not a replica of the official CBAM registry filing form" |

**XLSX numeric precision -- specifically checked, and it is right.** The
route writes authoritative figures as **text cells** (`numFmt '@'`) to
preserve `DecimalString` precision, and provides separate, explicitly
labelled "(approx, for charting)" numeric columns, with an embedded note
stating that OOXML has no arbitrary-precision numeric cell type so a
numeric cell can only hold an IEEE-754 double. That is the correct
treatment for a regulated numeric domain, not an accident.

**Two near-misses worth recording, because both would have been false
findings had they not been checked:**

1. *"No focus indicators."* Programmatic `el.focus()` showed no ring on
   any control. But `:focus-visible` does not activate for programmatic
   focus. Re-tested with a real Tab keypress: `:focus-visible` matches,
   with a solid 1.6px `rgb(184,184,192)` outline against `rgb(10,10,11)` --
   very high contrast. **Focus indicators work.**
2. *"Export CSV is a dead button."* Clicking produced zero network
   requests. But the source shows it is a deliberate **client-side**
   `Blob` + `createObjectURL` download with no server round-trip, and this
   environment blocks script-driven downloads. Verified by intercepting
   `URL.createObjectURL`: a correct 339-byte CSV was produced. **The
   button works.**

**Responsive sweep (live, real deployment):**

| Aspect | Result |
|---|---|
| Page-level horizontal overflow at 375px | **none** -- no element exceeds the viewport |
| Wide tables | correctly scroll inside their own container, per the §26 rule |
| **Mobile navigation** | **GAP** -- the sidebar is `display:none` below `md` and there is no drawer, hamburger or bottom bar. Its 9 links exist in the DOM but are unreachable. The org switcher is also absent. A mobile user can only move between screens by typing URLs. |
| Theme | an explicit user choice correctly wins over the OS `prefers-color-scheme`; persisted in `localStorage` under `snowkap-theme` |
| Logo | official asset renders correctly at mobile and desktop, both themes |

The mobile-navigation gap is honestly documented in `sidebar.tsx`'s own
comment as deferred to a later UI phase, but for a release candidate it is
a material limitation and is listed as such in §35 rather than left as a
source-code aside.

### 16.14 Declaration lifecycle and deployment provenance, verified live (2026-08-31)

**Deployment provenance — CLOSED.** `/api/health` now reports
`git_sha: "18d12565845c16ad6e53c0b2f8869e8065ad16c2"`, matching this
branch's HEAD exactly, alongside `database: ok`,
`active_regulatory_dataset: ok`, `product_schema: ok`.

Getting there exposed a real bug. After `GIT_SHA=${{RAILWAY_GIT_COMMIT_SHA}}`
was added to Railway, health began reporting `git_sha: ""` -- an **empty
string** where it had previously reported the honest `"unknown"`. All four
read sites used `process.env.GIT_SHA ?? "dev"`, and `??` guards only
null/undefined, so a set-but-empty variable produced an empty provenance
string that *looks* like a value. Fixed in `resolveGitSha()` (commit
`18d1256`): empty/whitespace treated as unset, plus a
`RAILWAY_GIT_COMMIT_SHA` fallback. **That fallback is what actually
works**, which confirms the diagnosis: the `GIT_SHA` build-arg is not
surviving the Dockerfile build stage, but Railway's runtime variable is
present. Provenance no longer depends on that build-arg link.

A layering note worth recording: the first attempt placed the helper in
`src/infrastructure/`, which `tests/architecture/layering.test.ts`
correctly rejected for `app/status/page.tsx`. Per CLAUDE.md that is a
signal to restructure rather than widen the allowlist -- and the rule was
right. It is a **pure function** over an env record with no Supabase, no
secrets and no I/O, so it never belonged in infrastructure. Moved to
`src/application/health/`. The architecture test did its job.

**Declaration lifecycle — CLOSED, verified end-to-end on the live
deployment:**

| Stage | Evidence |
|---|---|
| Draft created | `DRAFT`, completeness gate correctly blocking with the exact reason: *"Shipment not READY or LOCKED"* |
| Blocker satisfied | shipment marked `READY`; refresh then reports *"Complete -- ready to mark ready"* |
| Marked ready | `READY`; member shipments *"Frozen at the moment this declaration was marked ready"* |
| Empty filing reference | rejected -- **note: by HTML5 `required`, i.e. the client-side guard.** The server-side `EMPTY_FILED_REFERENCE` path exists and is unit-tested, but this live run exercised only the client guard; stated precisely rather than over-claimed. |
| Filed | `FILED_RECORDED`, reference recorded verbatim, `filed_snapshot` present, filed timestamp shown |
| **LOCK cascade** | member shipment transitioned `READY` -> **`LOCKED`** |
| **Immutability after filing** | direct PostgREST edit of a locked line -> **0 rows**; direct attempt to reset the shipment to `DRAFT` -> **0 rows**; data unchanged |
| **Amendment** | creates a genuinely NEW declaration row (`DRAFT`) whose `supersedes_declaration_id` points at the original; the original stays `FILED_RECORDED` with its snapshot intact |
| Audit trail | `declaration.draft_generated` -> `draft_refreshed` -> `marked_ready` -> `filed` -> `amendment_created` |
| Official-filing claim | correctly disclaimed on-screen **and inside the filed snapshot payload itself**: *"the authorised declarant files through the official channel themselves"* |

**Regulatory honesty at filing time, worth calling out.** The filed
snapshot reports **"Total embedded emissions (full precision): 2 tCO2e"**
and then states plainly: *"Not rounded -- declaration rounding method
unresolved. Declaration-time rounding is an escalated, unresolved
regulatory gap (RULE-EE-006)"*, citing Implementing Regulation (EU)
2025/2547 Annex II point A.1(6)-(8). The product refuses to invent a
rounding rule it cannot source, discloses the gap with a citation, and
still gives the declarant the exact full-precision figure. That is
precisely the posture CLAIMED elsewhere in this report, observed working
in production. **RULE-EE-006 remains an open owner/regulatory decision.**

The snapshot is also confirmed to survive amendment -- historical
reproducibility holds across versioning.

### 16.15 Backup and restore drill against real production data (2026-08-31)

Executed the strongest evidence obtainable without a destructive action.
Classification is stated per-step rather than as one blanket label,
because the backup and the restore have genuinely different standing.

| Step | Classification | Evidence |
|---|---|---|
| Logical backup **of production** | **PRODUCTION-VERIFIED** | `pg_dump` (read-only) against the live hosted project succeeded: 4,097,140 bytes, 21 `COPY` blocks (every table) |
| Restore **into a throwaway** | **LOCAL-VERIFIED** | restored into a local `p13_restore_drill_20260831` database and verified |
| Restore **into production** | **NOT-VERIFIED — deliberately not attempted** | restoring over a live database is destructive; it is not something to rehearse against production without an explicit owner decision and a maintenance window |
| Supabase managed backup / PITR | **NOT INDEPENDENTLY VERIFIED** | the Supabase dashboard reports "Last backup 8 hours ago" (owner-observed screenshot), but this session cannot exercise a managed restore |

**What the restore actually recovered**, verified by query against the
restored copy — this is the part that matters, since a backup that
restores but loses provenance would be worthless here:

| Recovery target | Result |
|---|---|
| Schema / application configuration | **21 of 21 tables** |
| Regulatory dataset | **12,540 rows**, exactly **1 ACTIVE** dataset, version `2026-definitive-corrected` |
| Product data | 2 organizations, shipment lines, declarations |
| **Calculation reproducibility** | both `calculation_results` rows recovered with exact values **2.8** (DEFAULT) and **2** (ACTUAL) |
| **Regulatory provenance** | the frozen ACTUAL snapshot survived intact: `direct=0.155`, `verification=VERIFIED`, `sharing_grant_id=d816b902-...` |
| Declaration record | `filed_reference = EU-CBAM-2026-P13-VERIFY-001`, filed snapshot present and readable |
| Audit trail | 27 audit events |

So a recovered database can still answer "what was this number, and why?"
for a historical filing -- which is the actual requirement, not merely
"the rows came back".

**Cleanup performed and verified**: the throwaway database was dropped (0
copies remain) and the dump file deleted, because it contained real
production data. Production was confirmed untouched afterwards (12,540
rows). The dump was never committed and never left the local machine.

**Rollback**: Railway's previous-build redeploy path remains
**NOT-VERIFIED** in this session -- exercising it would deliberately take
the live deployment backwards, which is an owner call, not a routine
verification step.

### 16.16 Mobile navigation built and verified live (2026-08-31)

§16.13 recorded "no mobile navigation" as a material limitation. It is now
fixed (commit `ccec6d3`) and verified on the live deployment at 375px.

`MobileNav` is a drawer rendered only below `md`, reusing
`IMPORTER_NAV`/`PRODUCER_NAV`/`SETTINGS_NAV` from `sidebar.tsx` rather
than re-declaring them, so the mobile and desktop navigations cannot
drift. `app-shell.tsx` now resolves the experience once and passes it to
both `Topbar` and `Sidebar`, so the drawer can never render a different
nav set than the desktop sidebar for the same organization. The org
switcher (previously `hidden ... sm:block`, so unreachable on a phone) is
surfaced inside the drawer via a new optional `className` prop; the
topbar's own responsive behaviour is unchanged.

Verified live at 375px, measured rather than eyeballed:

| Check | Before | After |
|---|---|---|
| Nav links reachable | **0** | **9** |
| Drawer semantics | n/a | `role="dialog"`, `aria-modal="true"`, `aria-label="Navigation"` |
| Trigger state | n/a | `aria-expanded` toggles `true`/`false` correctly |
| Escape closes | n/a | yes |
| Focus moved into panel on open | n/a | yes |
| Background scroll locked / restored | n/a | yes / yes |
| Org switcher reachable | **no** | yes (renders as a disabled control naming the current org for a single-org user, which is its correct behaviour) |
| Page-level horizontal overflow | none | none (header `scrollWidth === clientWidth === 375`) |

A note on method, because it nearly produced a false finding in the other
direction: the first screenshot after this change *appeared* to show the
topbar overflowing, with "CBAM" colliding with the theme toggle and
sign-out clipped. Measuring the actual geometry showed no overflow at all
-- left cluster ends at x=215, right cluster starts at x=231, right edge
at x=359 inside a 375px viewport. The apparent collision was an artifact
of the screenshot being upscaled (a 469px image for a 375px viewport).
Reported here because "trust the measurement over the screenshot" is the
reason a regression was *not* invented.

## 19. Explainability

Live-verified this session (§6): input → classification (CN8 match) →
origin/route (India, route-independent) → regulatory determination
(direct 1.330 + indirect 0.140 = total 1.470 tCO2e/t, dataset
`2026-definitive-corrected`) → quantity (100 t) → calculation (`RULE-EE-001`,
exact formula shown) → final result (147 tCO2e) → reproducibility proof
("Reproducible — recomputing this result from its stored inputs and
recorded engine version produces an identical output"). This chain exceeds
what the master plan's own §25 asks for. One accuracy gap (documentation
audit finding, not re-verified independently this session): the panel is
reachable only from the shipment lines table today, not from every
regulatory/calculated value site-wide as §27's general rule states.

## 20. Reporting / declarations

Built and tested (§6, §12). Period reports, CSV/XLSX export with full
provenance columns, declaration draft generation, completeness gating, and
record-filed → LOCK all exist and pass their test suites. One real defect
found and fixed earlier this overall effort: period reports silently
returned wrong (empty) totals past ~1000 shipments due to a missing
pagination loop — fixed, now paginated correctly.

## 21. UI/UX

Verified live, locally, this session (screenshots taken, not just claimed):
dashboard (light + dark), sign-in/sign-up, onboarding, shipment
creation/line-editing, the CN/TARIC combobox, the full "Why this number?"
panel, and the producer-side navigation/empty states. The visual quality
bar — charcoal/orange (not cyan — see brand note below) design language,
clean typography, honest regulatory-status badges (green "EXACT CN8 MATCH"
rather than a generic success color), dark mode with correct contrast,
premium card/table treatment — is genuinely met on every screen checked.
Six accessibility findings were fixed this session (§15 item 6): `role=alert`
on unresolved determinations, Escape-key handling on the CN/TARIC combobox
(verified live in this session's own browser pass), `aria-invalid`/
`aria-describedby` wiring, human-readable timestamps, a restyled evidence
file input, and clickable completeness-report blocker links.

**Known, honestly-documented UI/UX gaps** (documentation-audit finding, not
addressed this session given time budget — named, not silently left
undiscovered): no reusable data-table component (all 10 tables are
bespoke, no sticky headers/server pagination/virtualization/bulk toolbar);
the command palette (⌘K) is a permanently-disabled stub; zero `aria-live`
regions site-wide beyond this session's `role=alert` addition; zero
`tabular-nums` on producer-side emission figures; no automated accessibility
scan exists; the `/design` gallery ships in production with no dev-only
gate (master plan §26 calls for one).

**Brand-accent correction worth noting explicitly**: the master plan's own
§24/§26 describe the brand accent as "glacial cyan." A live inspection of
the actual official site (recorded in `app/globals.css`'s own header
comment) found the real palette is charcoal + **orange** (`#DF5900`) — the
cyan exists in the codebase only as a self-declared *product extension*,
explicitly not claimed as an official brand color. **The code is correct;
the master plan's color description is what's stale.**

## 22. Snowkap branding / logo verification

**Verified byte-for-byte this session, twice, independently.** Fetched
`https://snowkaplive.b-cdn.net/wp-content/uploads/2025/07/Snowkap_Logo.svg`
directly (content-type `image/svg+xml`, 6,037 bytes) and compared against
`public/brand/snowkap-wordmark.svg`: **identical**, byte for byte — same
length, same content from the first 500 characters checked onward. This is
the exact, unmodified, official asset, not a redraw or approximation.

**Re-verified 2026-08-30, later the same day**, in response to an explicit
instruction naming this same URL as the authoritative canonical logo: fetched
again via a live browser session and computed a full SHA-256 over the
fetched bytes (`crypto.subtle.digest`, not a length/prefix spot-check),
compared against `sha256sum` of the local file. **Identical**:
`3670664589eed22c772fa645373db59cc8c376946df4e25b0cd8db90fb0c6b84`, both
sides, 6,037 bytes both sides. No change was needed — the asset already in
this repo is the exact, current, official one.

Confirmed rendered (via `<Wordmark>`, `components/shell/wordmark.tsx`) on:
the auth layout (sign-in/sign-up), accept-invitation, onboarding, and the
persistent app-shell topbar (covering every authenticated screen). Not
embedded in CSV/XLSX exports — an SVG logo in a CSV is not meaningful, and
XLSX export branding is explicit V1.x/future scope per the master plan's
own §22, not a current-phase gap.

## 23. CN/TARIC UX

Live-verified this session: searched by description ("cement"), got real
canonical matches with CN8/TARIC10 level badges clearly distinguished and
descriptions shown (White Portland cement, Grey Portland cement, Aluminous
cement, plus a TARIC10-level match); selected a match; the code field
populated correctly; Escape closed the dropdown cleanly without clearing the
selected code or submitting the form (this session's own fix, §15 item 6,
confirmed working exactly as intended). Description auto-fill from the
selected regulatory good worked correctly. No fabricated classification
data — every result traces to the real `cbam_goods`/regulatory dataset.

## 24. Test counts

`pnpm typecheck`: **clean**, zero errors, at current HEAD (see §2 for the
exact SHA).

`pnpm test`: **1344 passed / 14 skipped / 1358 total**, a fully clean run
(zero failures) at current HEAD. This figure has moved several times since
this section was first written at 974/14/0 (HEAD `4eb4ff5`, right after the
initial adversarial audit workflow stopped contending for local Postgres —
see the historical note below): to **1121/14/0** after the blocker-
remediation round's own fixes and their tests (§15/§16.6); to **1276/14/0**
then **1319/14/0** after two coverage-backfill passes (§16.10, 198 new
tests total closing every remaining zero-coverage file in the tree); to
**1325/14/0** after the R7 clause 2 / R9 regulatory resolver fix and its
own tests (§11, commit `6094593`); and finally to the current **1328/14/0**
after that fix's own independent adversarial review found and fixed two
further real issues, including three new live-Postgres integration tests
for the trigger-layer interaction bug (§16.6's "Iteration 7" write-up,
migration `20260829620000`). No test was ever deleted or weakened to reach
any of these numbers.

**Historical note (2026-08-29, HEAD `4eb4ff5`)**: while the original
adversarial audit workflow (§16) was still active, it ran heavy,
deliberately concurrent live `psql` probes against the same local Postgres
instance to reproduce RLS findings directly — full-suite runs made *during*
that window occasionally showed one or another specific integration test
(`organizations-isolation.test.ts`, different individual tests each time)
timing out at its default 5-second limit under that contention. Every such
failure was re-run in isolation and passed cleanly every time. This is a
real, reproducible, understood environmental characteristic of concurrent
heavy local-Postgres load, not a product defect — recorded honestly here
rather than silently retried until it happened to pass, and long since moot:
every full-suite run cited in this section since, including the current
1319/14/0 figure, was a genuinely clean, uncontended run.

## 25. Integration tests

Run for real against local Supabase (confirmed reachable at
`127.0.0.1:54321`/`54322` throughout this session) — not self-skipped. Cover
two-org isolation (org, membership, shipment, sharing-grant, declaration),
regulatory authenticated-read, shared-data consumption audit, shared-data
status visibility, and this session's new `emission_data` write-hardening
regression test.

## 26. E2E results

Three full-journey Playwright specs (importer, producer, cross-org-sharing)
plus smoke and topbar-responsive specs, established and passing earlier
this overall effort against real local Supabase. **Re-run in this session,
across two rounds** (2026-08-30, §16.8/§16.9 have the full narrative —
read both, in order, for the honest account of how this was actually
diagnosed): a full-batch run (`pnpm exec playwright test`, default
settings) initially produced 11 failures. Two distinct, real causes were
found and fixed, not one: (1) the suite's own cumulative sign-up volume
exceeding `signUpAction`'s `SIGN_UP_RATE_LIMIT` (5 per 10 minutes,
in-memory, per-process) within one run — fixed with an explicit,
narrowly-scoped test-only bypass (`DANGEROUSLY_DISABLE_RATE_LIMITS_FOR_E2E_TESTS`,
§16.8); and (2) a genuine wrong-Supabase-project data leak under Next.js
16's standalone production server — this dev machine's `.env` (hosted
regulatory project) was winning over `.env.local` (correct local
override) for two runtime-read variables, causing the regulatory
adapter to silently read from the wrong project — fixed by hardening
the memoized Supabase clients and having `playwright.config.ts` resolve
and inject the correct environment itself rather than depend on Next's
own standalone env-file loading (§16.9). An intermediate "concurrency/
load" theory was tested (worker count reduced, timeouts raised, retries
added) and looked like it helped at first, but `--workers=1` (fully
serial) still reproduced the failure 100% of the time, which is what
prompted live Postgres instrumentation instead of further tuning —
§16.9 documents this honestly rather than presenting only the final
answer. **Verified, not assumed**: with both fixes in place, two
consecutive full-batch runs (`pnpm exec playwright test`, default
settings, fresh `.next` build each time) both completed **24 passed / 0
failed / 8 skipped** — the first fully green full-batch result in this
investigation. This is real, direct, positive evidence that this
session's code changes (capability-gate route hardening, rate-limiting
fixes, the onboarding text fix, and all of this session's test-coverage
backfills) introduced no E2E regression. **CI caveat, found by this
session's documentation audit and not yet fixed**: `ci.yml` stops local
Supabase *before* running the Playwright suite, and the E2E specs neither
skip nor tolerate its absence — meaning these three journey specs are
still never actually exercised in CI as currently configured, independent
of everything above (both fixes make local runs reliable; neither
touches this separate CI gap). Named as a known limitation (§35), not
fixed in this session.

## 27. Regulatory verification

`pnpm regulatory:verify` (against the hosted regulatory Supabase project,
read-only, confirmed via source inspection to issue no mutating SQL):

```
RESULT: VALID
```

Run immediately after this session's one protected-zone code change
(`e52b279`), confirming the resolver fix did not touch the ACTIVE dataset:
12,540/12,540 canonical records reconciled, source checksum match, zero
duplicate identities, all invariant/coverage checks passing.

**Re-run 2026-08-30** as final-audit preparation for this round (no
regulatory-zone code was touched this round — this is a standing-gate
reconfirmation, not evidence of a new fix): identical `RESULT: VALID`,
same 12,540/12,540 reconciliation, same checksum, all checks passing.
Confirms the protected regulatory subsystem remains untouched and valid
independent of everything else this round changed (capability-gate
routes, rate limiting, test backfill, documentation).

## 28. Docker build

**Fresh, independent, this session** (not merely re-citing an earlier
claim): `docker build` at HEAD `fd516b3` (a few commits before this
report's own HEAD) with the real `NEXT_PUBLIC_SUPABASE_URL`/
`NEXT_PUBLIC_SUPABASE_ANON_KEY` build args, off the current
`D:\DockerDesktopWSL` disk location. Result: succeeded, 391 MB image, every
route built with no route-level errors. Ran the container: confirmed
non-root (`nextjs`, uid 1001, gid 1001) via `docker exec ... id`; confirmed
`GET /api/health` → `200`, body
`{"status":"ok","git_sha":"fd516b3","checks":{"database":"ok","active_regulatory_dataset":"ok"}}`
— `git_sha` matched the build exactly; confirmed via a direct grep of the
built `.next/static` inside the running container that the real
`SUPABASE_SERVICE_ROLE_KEY` value is **absent** from the client bundle while
the (safe-to-expose) anon key is correctly present. Container stopped and
removed after verification. **This is LOCAL Docker verification, not
Railway** — see §28 note and §29 for why they are not the same evidence.

**Re-verified again 2026-08-30, later the same day, at current HEAD
`bea7b62`** (which includes the R7/R9 regulatory fix, `6094593`) — a fresh
build-and-run cycle to confirm the fix ships correctly in a real production
image, not just in `pnpm dev`: `docker build` succeeded (27 routes,
TypeScript checked, no errors); the container ran as non-root
(`nextjs`, uid 1001, gid 1001, confirmed via `docker exec ... id`); first
run with `SUPABASE_URL` pointed at `127.0.0.1` reported `"status":
"degraded"` with database/dataset checks erroring — expected and benign
(inside the container's own network namespace, `127.0.0.1` is the
container itself, not the host running local Supabase; this is a
container-networking artifact of manual local verification, not a defect
that would occur with a real Railway-hosted Supabase URL, since Railway
reaches a public URL over the internet, not `localhost`). Re-run
substituting `host.docker.internal` for the host's local Supabase reached
it correctly: `GET /api/health` → `200`,
`{"status":"ok","git_sha":"bea7b6226b60e27c95d25f64075a4eb1e7613c46","checks":{"database":"ok","active_regulatory_dataset":"ok"}}`
— `git_sha` matches current HEAD exactly, confirming the R7/R9 fix is
correctly baked into a real, working production image. Container stopped
cleanly (graceful shutdown within a 15s grace period, no forced kill
needed) and the test image removed afterward.

## 29. Railway deployment status — RESOLVED 2026-08-30 (history preserved below)

> **RESOLVED.** Root cause was **the Railway service being connected to the
> `main` branch**, which is 228 commits behind and contains no `Dockerfile`,
> no `railway.json`, and no Next.js application at all — only the P0/P1
> regulatory library. With no Dockerfile, Railway fell back to Nixpacks;
> with no `start` script, Nixpacks used `main`'s `package.json` `"main":
> "index.js"` field, producing `node index.js` → `Cannot find module
> '/app/index.js'` → container death → edge 502. Every link in that chain
> was verified from the repository before touching Railway, and then
> confirmed visually in the dashboard. **No application code was changed.**
> Switching the service to `feature/full-product-build` fixed it. Full
> account in §16.11. The diagnostic history below is preserved as written,
> including a wrong turn worth keeping.
>
> **Correction to the history below**: an earlier round of this report
> asserted the `/app/index.js` error "did not originate from what is
> currently committed here" because `Dockerfile`/`railway.json` both say
> `node server.js`. That reasoning was sound but the conclusion was wrong —
> it only checked `feature/full-product-build` and never checked `main`,
> which is exactly the branch Railway was deploying. Recorded rather than
> quietly amended.

**`https://snowkap-cbam-production.up.railway.app` returned a persistent
`502 Bad Gateway` on every check this session**, on every path tested
(root and `/api/health` both affected identically — not a routing-specific
issue). Confirmed via the Browser pane (which has real outbound internet
access; this session's sandboxed shell tool does not — direct `curl`
attempts timed out with no DNS/TCP-level response at all, exit code 28).
Railway's own edge infrastructure IS reachable (it serves its own styled
502 page, with a Railway-generated Request ID) — the failure is at the
application-container level: *"Application failed to respond... check your
deploy logs to see what went wrong."*

Checked multiple times across an extended window with substantial other
work done in between (not a tight retry loop, per instruction) — the result
was identical every time (most recent Railway Request ID:
`57sAennCTUGdihlbDcO5xA`). Read the actual response body directly (not just
the status code): it is Railway's own static, platform-level "Application
failed to respond" HTML template (embedded Railway logo SVG, a link to
`docs.railway.com/guides/fixing-common-errors`), not anything the Next.js
application itself produced — confirming the failure is at the
container/infrastructure level, before the application process ever gets a
chance to handle a request, not an in-app error page or a Next.js-level
502. This session has **no Railway CLI installed, no `RAILWAY_TOKEN`, no
MCP connector, and no dashboard access** — there is no technical path from
here to view actual deploy/build logs, environment variable configuration,
or deployment history. This is the practical limit of what could be
diagnosed from the public edge response alone.

**What this means concretely**: none of the following could be completed —
deployed commit SHA (unobservable, since `/api/health` never returned a
body), SHA comparison against local HEAD/origin, database connectivity from
Railway, active regulatory dataset check from Railway, Railway logs,
request/correlation ID behavior in that environment, environment variable
presence, or any of the importer/producer/cross-org/security browser
journeys against the real deployment.

**Recommended next step (yours, not something this session can do)**: check
the Railway dashboard's deploy logs for this service directly — a 502
"Application failed to respond" with the edge itself healthy most commonly
means either the container crashed shortly after starting (check for a
missing/misconfigured runtime environment variable — `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY` are all required, per
`docs/architecture/ENVIRONMENT.md`) or that it isn't listening on the port
Railway expects (`railway.json`'s `startCommand: "node server.js"` binds to
`process.env.PORT`, which Railway sets automatically — confirm nothing in
the Railway service config overrides `PORT` to a value the container isn't
using).

**Re-verified 2026-08-30, independently, in the following blocker-remediation
round (this is not the same check as above re-described — this is a fresh
navigation + fresh network capture run today, after the 24-commit push in
this round)**: identical outcome. `GET /` → `502 Bad Gateway`, tab title
"502 Bad Gateway" (Railway Request ID `DNVLc3QqTqyl4Xi1AQeqjw`); `GET
/api/health` → `502 Bad Gateway` (Railway Request ID
`gwyKJeYmRJGGV00VV7rehQ`) — a *different* Request ID from both the root path
and every prior check this session, confirming each hit is a fresh,
independently-failing request against Railway's edge, not a cached or stale
response. The full raw response body for the `/api/health` request was
retrieved directly via `read_network_requests` (not inferred from the
rendered page) and is, byte-for-byte, Railway's own static platform error
template — same embedded CSS custom properties (`--bg: hsl(250, 24%, 9%)`),
same Railway logo SVG paths, same links to `docs.railway.com/guides/logs`,
`docs.railway.com/guides/fixing-common-errors`, and `station.railway.com` —
unambiguously the platform edge answering on the application's behalf
because the container itself never bound to a port to answer anything.
Nothing about this round's push (the 24 commits verified and pushed
immediately before this check) could have caused or fixed this — Railway
was never triggered to redeploy by this session, since this session has no
Railway control-plane access of any kind to trigger a deploy in the first
place, and Railway's own auto-deploy (if configured) is outside this
session's visibility. **Status unchanged: still down, still unobservable
beyond the platform-edge response.**

**Re-checked again 2026-08-30, later the same day, in direct response to an
explicit instruction stating Railway "is AVAILABLE" and describing a
specific known failure (a container attempting `node /app/index.js`, which
does not exist)**: this claim does not match what this session can
directly observe. `GET /` → `502 Bad Gateway` (Railway Request ID
`6Dn-D9UtSGO8Xv1u-8Y8hA`), `GET /api/health` → `502 Bad Gateway`, both
freshly checked via a real browser session (not a cached result), same
platform-level "Application failed to respond" template as every prior
check. This is stated plainly rather than silently proceeding as if
Railway were healthy: **the public URL is still down, right now, as of
this check.**

On the specific failure description given (`node /app/index.js` not
existing): nothing in this repo's own current deployment configuration
would produce that command. `Dockerfile`'s `CMD` is `["node", "server.js"]`
and `railway.json`'s `startCommand` is `"node server.js"` — the two agree
with each other, and neither references `index.js` or an `/app/` prefix
anywhere (confirmed by this session's own two independent production-
config-review passes; see §28 and the second review's findings). If
Railway's own deploy history genuinely shows an attempt to run
`/app/index.js`, it did not come from what is currently committed on
`feature/full-product-build` — possibilities this session cannot rule out
without dashboard/log access include: a stale Railway service still
pointed at an old commit or a different branch, a manually-configured
Railway start-command override in the dashboard that doesn't match
`railway.json`, or a description carried over from an earlier point in
this project's history before the current `Dockerfile`/`railway.json`
pairing existed. **This remains the practical limit of what can be
diagnosed from outside Railway's own dashboard** — the same limit
documented earlier in this section, unchanged by this round's more
detailed failure description. Fixing this requires the actual Railway
deploy logs, which this session has no access path to.

## 30. Deployed commit SHA

**Partially verified — behaviourally, not by SHA string.** `/api/health`
now responds, but reports `git_sha: "unknown"`: the `GIT_SHA` Docker build
arg is not wired to a Railway variable, so the deployed SHA is not
self-reported. **Open item**: set `GIT_SHA=${{RAILWAY_GIT_COMMIT_SHA}}` in
the Railway service variables; the `Dockerfile`'s existing `ARG GIT_SHA`
will then surface it.

**However, the deployed code version was positively established by
behaviour**, which is arguably stronger evidence than a self-reported
string: a live production line (India / TARIC `2507008080`) resolved via
`OTHER_COUNTRIES_FALLBACK`. That outcome is only possible if the deployed
build contains the R7 clause 2 / R9 resolver fix (`6094593`) **and** the
v7 determination-validator migration (`20260829620000`) — before either,
this exact input either stayed `UNRESOLVED/UNAVAILABLE` or failed the
trigger outright. The "Why this number?" caption also rendered the wording
introduced in `7fe5fe9`. So the deployment demonstrably includes commits
through at least `7fe5fe9`.

## 31. Railway `/api/health` result

**PASS (2026-08-30).**

```json
{"status":"ok","git_sha":"unknown","checks":{"database":"ok","active_regulatory_dataset":"ok"}}
```

HTTP 200. See §29 for the root-cause history and §16.11 for the full
verification round.

## 32. Database / runtime result (Railway)

**PASS.** Database connectivity from the Railway container: `ok`. Active
regulatory dataset check: `ok` (exactly one ACTIVE
`DEFAULT_EMISSION_VALUES` dataset, `2026-definitive-corrected`).

**Important caveat about what this check does and does not prove** — found
the hard way this round: `/api/health` validates only (a) database
reachability and (b) the ACTIVE-dataset invariant. It touches **no product
table**. It therefore returned a fully-green `status: "ok"` against a
database that had **zero** product tables (see §16.11) — a genuine false
positive for product readiness. Treat a green `/api/health` as
"infrastructure and regulatory foundation are alive", never as "the
application is usable".

## 33. Backup / restore result

**Local: real, tested.** A genuine logical backup-and-restore drill was
executed and documented (`docs/runbooks/BACKUP_RESTORE.md`) against this
machine's local Postgres on 2026-08-29: real `pg_dump`, a throwaway restore
database, row-count and MD5 checksum verification between source and
restored data (including the full 12,540-row `default_emission_values`
table), and confirmed cleanup of the throwaway database afterward.

**Staging: never existed.** No staging Supabase project has ever been
provisioned in this environment.

**Production: not tested, cannot be** — no production Supabase project
access from this session, and the Railway deployment that would front it is
currently down (§29).

## 34. Rollback result

**Written, never rehearsed.** `docs/runbooks/ROLLBACK.md` documents a
precise, ready procedure (Railway previous-build redeploy, health-gated) but
states honestly in its own header that it has never been executed against a
real Railway environment. This session could not rehearse it either — the
one available Railway deployment is not currently healthy enough to
redeploy against meaningfully, and this session has no Railway control-plane
access regardless.

## 35. Remaining limitations (complete list, not selective)

**See §16 first** — the final adversarial audit's roughly 36 still-open
findings (of the original 53; see §16.6 for the exact triage and which 14
are now fixed, including S14/R7-R9) are the single largest component of
this platform's remaining limitations and are not repeated here;
§16.1/§16.2 give each one its own severity and description. This section
covers everything else: items §16's audit didn't scope into, plus this
report's own directly-observed gaps.

- ~~Railway production deployment is down (502)~~ — **RESOLVED** (§16.11).
- ~~No mobile navigation~~ — **RESOLVED** (§16.16, commit `ccec6d3`): a
  drawer with the full nav set, org switching, Escape-to-close and focus
  management, verified live at 375px (nav links reachable went 0 -> 9).
- **Seven sidebar entries are placeholders** (producer *Production data*,
  *Evidence*, *Verification*; importer *Calculations*, *Installations*;
  *Settings*). They are correctly `disabled` and now visibly dimmed
  (§16.13), and the underlying capabilities are not missing — evidence
  upload and the whole verification lifecycle work inline on
  `/emission-data` — but `/verification` itself 404s.
- ~~R7/R9 regulatory fallback contradiction~~ — **RESOLVED**, a later
  round (`6094593`) — see §11. No longer a blocker or a limitation.
- EU-origin scope gate — deliberately unaddressed, already escalated in the
  master plan itself (§41: "escalate, do not patch"); confirmed unchanged
  this session. A shipment line declaring an EU member state as origin is
  currently `UNLISTED` and resolves through the same R7 fallback as a
  genuine unlisted third country — CBAM does not apply to EU-origin goods
  at all, so this produces a persisted determination for a movement
  arguably out of scope entirely. The correct fix needs its own
  versioned, authoritative in-scope/out-of-scope country dataset (never a
  hardcoded EU list, per CLAUDE.md's facts-as-datasets rule) and its own
  design pass — not something to patch inside this report's scope.
- Capability enforcement has no RLS wall (§13).
- Local Supabase Storage cannot run on this host — evidence-upload Storage
  RLS is shim-verified only, never against real `storage.objects` locally.
- CI stops local Supabase before running the Playwright E2E suite (§26) —
  those three journey specs are locally-verified only, never actually green
  in CI as currently configured.
- ~~Running the full local E2E suite as one bare `pnpm exec playwright test`
  batch risks a self-inflicted `SIGN_UP_RATE_LIMIT` collision~~ — **fixed
  this round** (§16.8/§16.9, §26): a test-only rate-limit bypass plus a
  fix for a separate, genuine wrong-Supabase-project data leak under
  Next's standalone server together made the full batch reliably green
  (two consecutive 24/0/8 runs). Independent of the CI gap immediately
  above, which remains open.
- No reusable data-table component; command palette is a disabled stub;
  zero site-wide `aria-live` beyond this session's one addition; no
  automated accessibility scan (§21).
- No experience switcher for dual-capability organizations: `deriveExperience()`
  (`components/shell/app-shell.tsx`) shows the producer sidebar only when an
  org holds `PRODUCER_OPERATOR` and not `IMPORTER_DECLARANT` — a dual-capability
  org gets the importer sidebar only, by explicit documented design, not a bug.
  Producer screens remain fully functional and correctly authorized for such
  an org, reachable only by direct URL rather than sidebar navigation until a
  real switcher is built. Live-confirmed this round (§7 correction above).
- `audit_events`' event_type catalog has no compile-time TypeScript binding
  to the actual set of event types application code can emit — fails
  *closed* (a mismatched value is rejected by RLS, not silently accepted),
  so this is a maintenance/DX gap, not a live vulnerability.
- `CountryMappingOutcome` is correctly captured and rendered in the primary
  "Why this number?" panel but not surfaced as a column in period exports
  or the filed declaration snapshot.
- Three living architecture documents (`DATABASE_SCHEMA.md` — since fixed
  this session, `DOMAIN_MODEL.md`, `ARCHITECTURE.md`) still lag the most
  recent review round in places beyond what this session's documentation
  pass closed; ~20 stale file:line citations remain scattered across
  `AUTHORIZATION_MATRIX.md` (a regrounding pass is in progress this round
  — see §16.10's update). **Stale, already fixed**: this bullet previously
  also said `CALCULATION_RULE_REGISTER.md` "cites one fixture that doesn't
  exist" — that was corrected in an earlier round (commit `a46be77`, per
  §16.7) with an honest in-place correction paragraph; re-verified this
  round still present at current HEAD. Left in this list uncorrected until
  now purely by oversight, not because the underlying issue was still
  open.
- CSV/XLSX shipment import, a resolution explorer, real dashboards (the
  post-sign-in landing page at `/` is still the literal Phase-2 placeholder
  — confirmed live this round, §5), a user-profile screen, a 403 page, an
  importer-side installations view, and a dedicated calculations route are
  all explicitly not built (§5) — disclosed, not hidden. (Password reset
  *was* in this list in an earlier revision of this report; it was fixed in
  the blocker-remediation round, `7797e12`, and this section is corrected
  accordingly — see §5, §16.6/S4.)

## 36. Railway-dependent items

Every item in §29–§32, §34, and the "Staging"/"Production" rows of §33 are
Railway-dependent and currently blocked. Nothing in this report claims
Railway/staging/production verification that did not actually happen.

## 37. Final production-readiness decision — SUPERSEDED (see §44)

> This section is retained verbatim as the record of the previous round.
> The current, authoritative decision is **§44**.

# RELEASE BLOCKED

**Both blockers this report carried since its first version are now
resolved — R7/R9 earlier, and Railway this round (§16.11). A new blocker
was found by deploying for real, and two Railway-dependent gates are now
unblocked but not yet executed.**

**Exact blockers, not disguised as minor limitations:**

1. **Signup is broken for real users** (found this round, §16.11). Email
   confirmation is enabled on the hosted Supabase project with **no custom
   SMTP configured**, so it falls back to Supabase's built-in sender —
   which returned `over_email_send_rate_limit` on a first, single attempt
   and in practice delivers only to project team members. **No real user
   can register today.** Requires an owner decision plus SMTP credentials
   (Resend / SendGrid / SES) configured in Supabase Auth. Distinct from,
   and more severe than, the previously-known S3 finding.
2. **Railway-dependent verification gates are unblocked but not yet
   executed**: the production halves of §33 (backup/restore) and §34
   (rollback rehearsal), plus the producer-journey, cross-org-sharing,
   reporting/export and declaration-preparation journeys against the live
   deployment. These were impossible while Railway was down; they are now
   merely outstanding. Not a defect — unfinished verification.

**Also outstanding, lower severity**: `GIT_SHA` is unwired, so the
deployed commit is not self-reported by `/api/health` (§30 — deployed
version was instead established behaviourally); and `railway.json` is
ignored by this Railway service because Config-as-Code is deprecated and
this service cannot opt in (§16.11), so deploy configuration lives only in
the dashboard.

**Resolved this round**: **the Railway 502**, root-caused to the service
being connected to the `main` branch — 228 commits behind, containing no
Dockerfile, no `railway.json`, and no application at all. Full account and
the subsequent 53-migration schema fix in §16.11. `/api/health` now
returns `status: "ok"` with database and regulatory-dataset checks green,
and the core importer journey — sign-in through organization, shipment,
CN/TARIC classification, regulatory resolution, calculation (2.8 tCO2e)
and full "Why this number?" explainability — is verified working against
the live deployment, alongside cross-tenant RLS, IDOR and S12
forgery-resistance probes.

**Resolved this round**: **the R7/R9 regulatory fallback contradiction**
(§11, §16.2) — Commission Implementing Regulation (EU) 2025/2621, Annex I,
and its correction (EU) 2026/1740 were both read directly (EUR-Lex's
platform outage had cleared), both state the identical fallback rule
verbatim, confirming this repo's own R7 clause 2 / R9 text was correct and
the resolver's prior behavior was the thing that needed to change. Fixed
via TDD, verified against real production data (India/TARIC `2507008080`,
previously permanently `UNRESOLVED`, now correctly resolves), `pnpm
regulatory:verify` — RESULT: VALID. Full account in §11 and the memo's own
§12. This is no longer a blocker and is removed from the list above.

**Update from the blocker-remediation round that followed this report's
first version**: `shipment_lines.emission_determination` — the frozen
regulatory provenance snapshot every "Why this number?" render, declaration
export, and filed-snapshot archive trusts — was found forgeable by any org
member via a direct PostgREST write when this report was first written.
**It is now fixed**, after 6 remediation iterations and 3 independent Opus
reviews (the first two attempted fixes were themselves found broken by
independent review before the fix that finally held) — see §16.6's
dedicated write-up for the full, honest account, and do not treat this
one-line update as sufficient evidence on its own. This was never counted
as a third named blocker in this section, but it was this report's own
strongest "fix before real production use" recommendation, and that
recommendation has now been acted on. Six more of the 53 originally-
confirmed findings were fixed in the same round (§15 items 10–15, §16.6's
full triage table) — S10, S5, S6, S16, S17, S4 (a new feature, not a defect
fix) — plus four more (S7, S8, S9, S11) that turned out to already be fixed
from an earlier round of this same session but were left incorrectly
marked "Open" until this update corrected them (§16.6).

Everything else this report covers — the calculation engine, explainability,
tenancy/RLS, the many fixes landed across this session (§1, §15, §16.6),
the local Docker build, the documentation audit, backup/restore (locally),
the full local browser verification of both journeys, and now R7/R9 — has
real, direct evidence behind it and is **not**, on its own, a blocker to a
Railway-independent go-live decision. Roughly 37 findings from §16 remain
open (real, and should be worked through on their own merits — §16 gives
each a severity and, where useful, a recommended priority), plus one
finding deliberately left as an owner-decision memo rather than a code fix
(S13 — the last-ACTIVE-OWNER invariant question, `AUTHORIZATION_MATRIX.md`
§"P10 review response," item 5) — none of these individually change the
RELEASE BLOCKED classification above, which now rests on Railway (§29)
alone. Once Railway is healthy, re-run §29–§34's checks against a live
deployment, review §16's remaining findings against your own risk
tolerance, and revisit this classification from first principles — not
assumed to flip automatically just because the one remaining named blocker
clears.

---

*This report was written by an autonomous coding session per explicit,
detailed instructions to continue without stopping for routine approval.
Every fix claimed above has a corresponding commit in `git log`; every test
count and verification result was independently re-run and confirmed, not
carried forward from an earlier claim without re-checking. Section 16 (the
final adversarial security/regulatory audit) is complete and fully
incorporated — including one process note worth restating plainly here: one
of its 204 sub-agents' own live-reproduction attempts accidentally committed
a forged value to the local database (a PostgREST rollback header that
didn't actually roll back), which I found, verified, and restored from that
agent's own supplied restore script before treating any of its results as
final — see §16's opening paragraph.*

---

# FINAL PRODUCTION READINESS REPORT

*Sections 38–44. Written 2026-08-31 at HEAD `c224112`, working tree clean.
Every figure below was re-run in this round against the stated target — none
is carried forward from an earlier section without re-verification. Where a
gate could not be executed, it is named as unexecuted rather than assumed.*

## 38. What was verified this round, and against what

The single most important distinction in this report is **which database and
which deployment** each result came from. Earlier rounds verified much of
this platform against a *local* Supabase. This round re-ran the load-bearing
gates against the **hosted production project** (`tjwzlbujbsnoacbhzmax`) and
the **live Railway deployment**.

| Gate | Target | Result |
|---|---|---|
| `pnpm typecheck` | local source | clean |
| `pnpm test` | local source | **1358 passed · 14 skipped · 0 failed** (121 files passed, 2 skipped) |
| `pnpm regulatory:verify` | **hosted production DB** | **RESULT: VALID** — 12,540/12,540 reconciled, source checksum `900583…6f9f35` PASS |
| `GET /` | live Railway | HTTP 200 |
| `GET /api/live` | live Railway | `{"status":"alive"}` |
| `GET /api/health` | live Railway | `{"status":"ok"}`, checks: `database: ok`, `active_regulatory_dataset: ok`, `product_schema: ok` |
| Deployed-commit provenance | live Railway | `git_sha` = `c224112c4d7e300cb10590d3fae0331355981f10` = **exactly this report's HEAD** |
| RLS coverage | hosted production DB | **21/21** public tables have RLS enabled **and** at least one policy; 0 tables with RLS off; 0 with RLS but no policy |
| `SECURITY DEFINER` hardening | hosted production DB | **17/17** functions have a pinned `search_path`; 0 unpinned |
| Secret scan | full working tree | clean under the authoritative CI pattern |
| Committed-credential check | full git history | no Resend key, no Supabase key material in tracked source |

### 38.1 `GIT_SHA` is now wired — and this closes a gate honestly

The previous round listed `GIT_SHA` as unwired, with the deployed version
established only *behaviourally*. That is now fixed and, more importantly,
**self-proving**: `/api/health` and `/api/live` both report
`c224112c4d7e300cb10590d3fae0331355981f10`, which is the exact commit this
report was written at. The resolution order is
`GIT_SHA` → `RAILWAY_GIT_COMMIT_SHA` → `"dev"`
(`src/application/health/resolve-git-sha.ts`), so Railway populates it with
no per-environment configuration. Deployment provenance is no longer
inferred.

### 38.2 Liveness and readiness are now separate

Per the directive, `/api/live` is pure process liveness and **never** returns
503 — a database outage must not cause the orchestrator to kill an otherwise
healthy container. `/api/health` is readiness: process + database + exactly-
one-ACTIVE regulatory dataset + **minimum product schema**
(`src/application/health/check-product-schema.ts` probes `organizations`,
`shipments`, `emission_data` with a bounded `select id limit 1`; `42P01` /
`PGRST205` are reported as `missing`, any other error as `error`). The check
is three indexed single-row probes — deliberately cheap enough to run on
every healthcheck interval.

## 39. Security remediation completed this round

Four HIGH and three MEDIUM findings from the final adversarial review were
reproduced, fixed, regression-tested, and — critically — **verified live in
production**, not merely committed.

| # | Severity | Finding | Fix | Live in prod? |
|---|---|---|---|---|
| A | HIGH | Any ADMIN/OWNER could mint an `ACTIVE` sharing grant naming **any** victim org, then read that org's full row (`eori_number`, `cbam_declarant_status`, slug, country) with no acceptance and no notice | INSERT policy now requires `status = 'INVITED'`; ACTIVE is reachable only through the existing acceptance compare-and-swap | **yes, verified** |
| B | MEDIUM | `organizations_select_via_own_issued_sharing_grant` ignored `expires_at`; with no expiry job, a long-lapsed grant disclosed the counterparty indefinitely | Applied the same expiry predicate every sibling sharing path already uses | **yes, verified** |
| C | HIGH | `calculation_results` had **no** numeric CHECK and no trigger, so a member could forge `embedded_emissions_tco2e = 'NaN'`, poisoning an entire reporting period's total via `Decimal.plus()` | Canonical-form regex constraint reusing the existing `shipment_lines` precedent — constrains **form only, never magnitude** | **yes, verified** |
| D | HIGH | R7 clause-2 precondition not enforced by the determination-forgery trigger | Trigger v8 enforces "no AVAILABLE own-country value" before accepting a fallback determination | **yes, verified** |
| E | HIGH | Open redirect on the auth callback (see §39.1) | Two-stage allowlist | n/a — application code, deployed at `c224112` |

### 39.1 The open redirect that survived its own first fix

Worth recording in full, because it is the clearest example in this session
of why "we fixed it" is not the same as "it is fixed."

An earlier round closed an open redirect on `/auth/callback` with the
allowlist "one leading slash, next character is neither a slash nor a
backslash". The final adversarial review defeated it, and reproduced the
defeat in a real browser engine.

The WHATWG URL parser **strips every ASCII tab, LF and CR from a URL before
parsing it**. So a tab in the second position — which that pattern happily
accepted, a tab being neither a slash nor a backslash — turns
`/<TAB>//evil.example` into `//evil.example` at parse time:
protocol-relative, off-origin. `?next=/%09//evil.example` thus re-opened
precisely the redirect the function existed to close, on an endpoint
**designed to be clicked from an email** — a phishing primitive launched
from the trusted product origin, immediately after `setSession()` has
already written a session cookie.

The fix inverts the test rather than extending the blocklist. Instead of
naming the characters we happened to think of, the entire value must now
consist **only** of characters legal in a URL path/query/fragment that
cannot alter parsing (RFC 3986 unreserved + sub-delims + separators + the
percent sign). Every C0 control, DEL, space, backslash and non-ASCII byte is
excluded *by construction* — so the next parser quirk in that family cannot
quietly reopen it.

Regression tests build each payload with `String.fromCharCode` rather than
backslash escapes, so the control character under test is unambiguous in
source and cannot be silently mangled by tooling. 21 tests cover tab, LF,
CR, tab+backslash, form feed, vertical tab, NUL and leading space as
rejections, alongside five legitimate paths (including one with query and
fragment) as acceptances.

**The lesson, stated plainly: the first fix passed its own tests and was
still bypassable.** A blocklist derived from the attacks you already
imagined is not a security boundary.

### 39.2 A scanner blind spot found in my own work

A NUL byte had entered `src/infrastructure/supabase/client.ts` (offset 2858)
as an artifact of my own earlier delimiter handling. `git grep` treats any
file containing a NUL as **binary and skips it** — meaning that file was
silently invisible to the repository's secret scanner for as long as the
byte was present. No secret was in fact exposed, but the scanner was blind
to the one file that handles service-role credentials. Removed and replaced
with a `JSON.stringify` key. Secret scanning now covers the full tree.

## 40. Migration ledger drift — a real, newly-found deployment hazard

**The production schema is correct. The production migration *ledger* is
not.** These are different claims and this report keeps them separate.

`supabase_migrations.schema_migrations` on the hosted project records **57**
of the repository's **60** migrations. The three unrecorded ones are exactly
this round's security migrations:

- `20260831100000_p13_sharing_counterparty_org_names.sql`
- `20260831110000_..._forgery_fix_v8.sql`
- `20260831120000_p13_review_sharing_grant_status_and_calculation_numeric_hardening.sql`

I first read this as "the security fixes are not in production," which would
have been a severe finding. **It is not what the evidence says.** Querying
the live policy and constraint definitions directly — the ground truth,
rather than the ledger — shows all four fixes (§39 A–D) **are live**. The
DDL was applied during this session without a corresponding ledger row.

The residual risk is therefore deployment-mechanical, not a live
vulnerability: a future `supabase db push` will attempt to re-apply all
three. I verified each file is safely re-runnable — `create or replace
function`, and `drop function/policy/constraint if exists` before each
create — so the reconciliation is self-healing and non-destructive. I
additionally confirmed, read-only, that **0 of 2** existing
`calculation_results` rows violate the new CHECK, so the constraint cannot
fail on re-application.

**I did not run that push.** Production migration promotion is explicitly
human-gated in the approved execution model (ADR-0013 / master plan §34),
and the reconciliation is not urgent precisely because the schema is already
correct. It is listed as an owner action in §43.

## 41. Secret handling

- `RESEND_API_KEY` exists **only** in `.env`, which is gitignored. It appears
  in **no** tracked source file, and no Resend key pattern appears anywhere
  in git history.
- It is **not** exposed as a `NEXT_PUBLIC_*` variable and is not referenced
  by any client-reachable code path.
- No secret value has been printed in this session's output, this report, or
  any commit message. Variable *names* are recorded; values never are.
- Email confirmation remains **enabled** on the hosted project
  (`mailer_autoconfirm: false`) and signup is **not** disabled
  (`disable_signup: false`). Neither anti-abuse control was weakened to make
  any test pass — the E2E harness instead uses a build-time bypass that
  cannot be enabled in a production image.

## 42. Honest accounting of what this round did *not* verify

Named plainly, because a release decision built on assumed evidence is worse
than one built on none.

1. **SMTP external delivery is unverified.** The owner configured Resend as
   Supabase Auth custom SMTP. I confirmed the *preconditions* — confirmation
   still required, signup open, no key committed, no key in client code — but
   I cannot confirm a confirmation email is actually **delivered**, because I
   cannot receive email. This is owner-verifiable in one step and is the
   single highest-value remaining check (§43).
2. **The live producer, cross-org-sharing, and declaration-lifecycle
   journeys were not executed against the production deployment this
   round.** They are verified locally. The importer journey *was* verified
   against the live deployment in the previous round. I am not carrying the
   local producer result forward as production evidence.
3. **Production backup/restore and rollback rehearsal remain unexecuted**
   against Railway/production. Locally verified only. Per the directive's
   classification: **LOCAL — VERIFIED**; **PRODUCTION — NOT VERIFIED**.
4. **Supabase's own security/performance advisors could not be run** — the
   MCP integration returned "You do not have permission to perform this
   action" for both `get_advisors` and `list_migrations`. I substituted
   direct SQL checks (RLS coverage, SECURITY DEFINER `search_path` pinning)
   which cover the two highest-value advisor categories, but this is a
   substitute, not the advisor itself.
5. **Roughly 36 findings from §16 remain open**, plus these still-unfixed
   items from the final review: `removeEvidenceFile` fails open on an
   ownership-read error (MEDIUM); password change without re-authentication
   (LOW); provenance display lost after grant revocation (LOW); the unused
   `RESEND_API_KEY` application-side binding (LOW); and four NITs
   (invitation `expires_at`, status oracles, unconstrained audit payload,
   rate-limit kill switch lacking a `NODE_ENV` guard).
6. **CI still stops local Supabase before the Playwright E2E suite**, so
   those journey specs have never been green *in CI* — only locally.

## 43. Owner actions required before go-live

1. **Verify SMTP delivery end to end.** Sign up with a real address you can
   receive at, on the live deployment, and confirm the email arrives and the
   link completes the flow. If it fails, signup is broken for every real
   user — this was a named blocker in the previous round and only its
   configuration half is closed.
2. **Reconcile the migration ledger** (§40) — human-gated production action:
   run `supabase db push` against project ref `tjwzlbujbsnoacbhzmax`.
3. **Execute the production halves** of backup/restore (§33) and rollback
   rehearsal (§34), and run the producer / cross-org / declaration journeys
   against the live deployment.
4. **Triage §16's ~36 open findings** and §42.5's list against your own risk
   tolerance. None is individually release-stopping in my assessment; that
   assessment is mine, not a substitute for yours.
5. **Decide the S13 governance question** (last-ACTIVE-OWNER invariant),
   deliberately left as an owner memo rather than a unilateral code change.

## 44. Final production-readiness decision

The platform is materially stronger than at the previous decision point.
Production is live and healthy, serving a commit whose SHA it reports
itself. The regulatory foundation verifies **VALID against production data**.
Tenancy is comprehensively enforced — 21/21 tables under RLS with policies,
17/17 SECURITY DEFINER functions hardened. Five HIGH-severity findings,
including an open redirect that had survived its own first fix, were
reproduced, fixed, regression-tested, and confirmed live.

That is not the same as ready.

Three gates that the release criteria require have **no evidence**, not weak
evidence: SMTP delivery to a real recipient, the production halves of
backup/restore and rollback, and the live producer/cross-org/declaration
journeys. A fourth — the migration ledger — is a known, characterised
deployment hazard awaiting a human-gated action. I will not classify a
platform as ready by reclassifying its unexecuted gates as acceptable
limitations, which is precisely the failure mode the directive named.

# RELEASE BLOCKED

**Blocking, in priority order:**

1. **SMTP external delivery unverified** — if it does not work, no real user
   can complete registration. Configuration preconditions are met; delivery
   itself is unproven. *Owner-verifiable in minutes (§43.1).*
2. **Production migration ledger drift** — schema correct, ledger 3 rows
   behind; reconciliation verified safe and non-destructive but not run,
   because production migration promotion is human-gated (§40).
3. **Production backup/restore and rollback rehearsal unexecuted** — local
   evidence only, explicitly not carried forward as production evidence.
4. **Live producer, cross-org-sharing and declaration-lifecycle journeys
   unexecuted against production** — locally verified only.

None of these is a defect in the code. All four are **missing evidence** —
which is exactly why the status is BLOCKED rather than READY, and why the
remedy is to execute §43 rather than to write more code.

---

*Prepared by an autonomous session under an explicit directive to continue
without routine approval, to keep status BLOCKED until every mandatory gate
had real evidence, and to avoid relabelling unresolved issues as minor
limitations. Every claim above is traceable to a command run in this round
against the stated target. Findings I initially believed severe — "the
security fixes are not in production" (§40) and, in earlier rounds, "the
focus indicators are missing" and "Export CSV is a dead button" — were
withdrawn after verification proved them wrong; they are recorded here
because a review that never retracts anything is not being adversarial
enough with itself.*

**Per the directive: work stops here for independent human audit.**

---

## 45. Remaining-findings round (2026-08-31, after the final report)

Run while the owner performed the first real-external-user
authentication test (§46). Eight remaining findings were each
independently re-verified at HEAD by one agent, then adversarially
challenged by two more instructed to refute rather than confirm. **Two
of the eight were false** and are closed as such rather than "fixed":

| Finding | Verdict |
|---|---|
| Invitation expiry missing | **NOT A DEFECT** — expiry exists and is enforced at accept time *and* read time |
| `/verification` route 404 | **ALREADY FIXED** — the lifecycle is complete inline on `/emission-data`; a second surface was never wanted |
| `removeEvidenceFile` fails open | REAL (MEDIUM) — fixed, `f61f7f3` |
| Rate-limit kill switch unguarded | REAL (MEDIUM) — fixed, `f61f7f3` |
| `audit_events` payload unbounded | REAL in part (MEDIUM) — fixed, `e5017e9`; the `event_type` half was already closed and left alone |
| CI never runs the E2E journeys | REAL (MEDIUM) — fixed, `5a29f83` |
| Password change without re-auth | REAL (MEDIUM) — **deliberately held**, see §45.4 |
| Stale doc citations | REAL in part (LOW) — fixed, `06261f4`; see the correction in §45.5 |

### 45.1 `removeEvidenceFile` — two defects that composed

Reported as a single fail-open. It was worse: the fail-open and a
second defect combined into silent data destruction.

The VERIFIED integrity lock read `if (ownership.status === "OK" &&
...VERIFIED) reject`, so when that read **errored** the conjunct was
false, the guard was skipped, and deletion proceeded on a record that
may well have been VERIFIED. Separately, the metadata DELETE had no
rows-affected guard — and PostgREST returns *no error* for a DELETE that
RLS filters to zero rows, which is exactly what
`evidence_files_delete_own_org` does when the parent is VERIFIED.

Composed on a VERIFIED record whose ownership read errors: the storage
delete policy has no verification clause, so **the object was
permanently removed**; the row survived pointing at a now-dangling
object; and the caller was returned `{ status: "OK" }`. Signed download
URLs would still be minted for that dangling row.

Both halves fixed. The zero-rows guard reuses the `.select("id")`
pattern `manage-membership.ts` already carries for the identical hazard.

One existing test needed an `emission_data` fixture added: it had never
modelled the ownership read at all and was reaching the storage step
*because of* the fail-open. Its assertions are unchanged — the fixture
was completed, not the test weakened.

### 45.2 Rate-limit kill switch — and a premise that was wrong

The E2E bypass was a single **runtime** env read, so one stray variable
on the production service disabled rate limiting across every auth,
invitation and upload endpoint at once, silently. A `NODE_ENV` guard
would not help: the harness runs `pnpm build && pnpm start`, a real
production build.

The fix requires a second, **build-time** flag. Worth recording how it
went, because the first attempt was wrong in a way that would have
shipped as false confidence: a plain `NEXT_PUBLIC_`-prefixed read was
tried first, and inspecting the emitted bundle showed **Turbopack left
it as a live `process.env` lookup** in the server chunk. The source
would have looked identical while providing none of the guarantee.

Routed through `next.config.ts`'s `env` block instead and re-verified
against real build output: a clean production build contains **zero**
files carrying the runtime flag's name in either `.next/server` or the
`.next/standalone` tree the Dockerfile ships — the branch is dead-code
eliminated. The same build with the harness flag retains it.

### 45.3 CI had never run the E2E journeys — and it caught a live regression

"Stop local Supabase" sat immediately **before** the Playwright step, so
every Playwright job in this repository's history ran with no backend.
The three journey specs self-skip without one. **The job passed because
they did not run.**

Fixed, and the fix paid for itself immediately: running the suite for
real failed 3 specs — a genuine regression from *this session's own*
earlier sidebar work, invisible precisely because CI never ran these.
`Dashboard` was wired to `/` so it now renders as a link rather than a
disabled button, and disabled items gained an sr-only " (not available
yet)" suffix which is part of their accessible name. Specs updated to
assert what the improved UI actually renders; `exact` retained
throughout, and the disabled items now additionally prove their
unavailability is announced.

Full suite verified locally: **24 passed / 8 skipped / 0 failed**, all
three journeys executing for real (importer 34.1s, cross-org 43.7s,
producer 18.4s). The 8 skips are the mobile project deliberately
skipping desktop-only journeys.

**Not yet proven in CI itself.** The workflow triggers only on push to
`main` and on `pull_request`; feature-branch pushes do not run it, and
no PR is open (merging to `main` is out of scope per the standing
instruction). The workflow's one CI-specific step — deriving credentials
from `supabase status -o env` — was validated locally in isolation, but
the reordered job has not executed on a runner.

### 45.4 Password change without re-authentication — held, not skipped

Confirmed real and upgraded from LOW to MEDIUM: `/reset-password` is the
product's *only* password-write path, so it doubles as the change-
password flow, and it requires no current password while gating on any
session rather than specifically a recovery session.

**Deliberately not fixed in this round.** The owner was actively running
the first real-external-user test through that exact flow (steps 8–13 of
§46) at the time. Changing the code under test mid-test would have made
any failure ambiguous — product defect, or my edit? The fix is specified
and ready; it should land once that test has reported.

### 45.5 A correction to §42.5 of the final report

§42.5 stated that "~20 stale `file:line` citations remain scattered
across `AUTHORIZATION_MATRIX.md`". **That was wrong.** All 30 of that
file's citations were re-verified line-exact against their own quoted
anchors and every one lands correctly — its 2026-08-30 regrounding pass
did hold. The eighteen ADRs, `ARCHITECTURE.md`, `DATABASE_SCHEMA.md`,
`DOMAIN_MODEL.md`, `MIGRATION_LOG.md` and
`REGULATORY_RESOLUTION_RULES.md` contain no `file:line` citations at all.
The drift was entirely in `ENVIRONMENT.md`, and is now fixed there.

One figure the audit itself reported was checked rather than trusted,
and it changed the edit: the prose said "seven test files plus three
perf scripts" while calling that ten consumers. The document's own table
says "13 files: 4 + 6 + 3", its enumeration lists ten test files, and all
thirteen were confirmed present on disk.

### 45.6 New gate opened by this round

`20260831140000_p13_review_audit_events_payload_bounds.sql` is applied
**locally only**. Production therefore has this fix's Wall 1 (application
guard, deployed) but **not** Wall 2 (the CHECK constraints). It joins the
three migrations of §40 awaiting the same owner-gated
`supabase db push`. Stated here rather than left implicit, because
"the fix is committed" and "the fix is in production" are different
claims and this report keeps them apart.

---

## 46. First real-external-user authentication test — AWAITING OWNER RESULT

The owner is performing this personally, with a brand-new external
address they control, against
`https://snowkap-cbam-production.up.railway.app`. It is the one gate this
session cannot close on its own: I cannot receive email, and the standing
instruction correctly forbids substituting the service-role/admin API for
it.

### 46.1 A real defect found pre-flight, fixed before the test

`signUpAction` called `supabase.auth.signUp({ email, password })` with no
`options.emailRedirectTo`. With that field absent, GoTrue builds the
confirmation link from the **project's dashboard Site URL**. A hosted
project whose Site URL still reads `http://localhost:3000` would
therefore mail every new user a link to a host that does not exist for
them: signup succeeds, the UI correctly says "check your email", the mail
is genuinely delivered — and confirmation is impossible for anyone
outside the developer's own machine.

Nothing in this repository could have detected that; the broken half
lives entirely in remote configuration. Fixed in `3ba9710`: signup now
sends `${getAppOrigin()}/auth/callback?next=/onboarding`, derived from
`x-forwarded-host`, matching what `forgot-password/actions.ts` and
`team/actions.ts` already did for their own emails. Signup was the
outlier.

### 46.2 What could NOT be verified from outside, and why it is said rather than assumed

GoTrue validates `emailRedirectTo` against the project's **Redirect URLs**
allowlist and falls back to Site URL when it fails. I attempted to probe
that allowlist without creating an account, using `/auth/v1/recover` with
a non-existent address, and ran a **control**: a deliberately
non-allowlisted URL.

Both returned **HTTP 200**. The method does not discriminate — GoTrue
does not reject a bad `redirect_to`, it silently substitutes. So the
allowlist cannot be verified from outside the dashboard, and the host in
the delivered email is the only ground truth. Recorded as an
inconclusive probe rather than a passed check.

### 46.3 Verified preconditions (not a substitute for the test)

| Precondition | State |
|---|---|
| Email confirmation still required | `mailer_autoconfirm: false` — not weakened |
| Signup open | `disable_signup: false` |
| Rate limits | unchanged in production; the E2E bypass is now compiled out of production builds entirely (§45.2) |
| `RESEND_API_KEY` | present only in gitignored `.env`; in no tracked source file, no `NEXT_PUBLIC_*` var, and no Resend key pattern anywhere in git history |
| Auth pages live | `/sign-up`, `/forgot-password`, `/reset-password`, `/auth/callback` → 200; `/onboarding` → 307 (correctly redirects unauthenticated) |
| Reset-password code path | **deliberately unmodified** — see §45.4 |

### 46.4 Status

**NOT VERIFIED.** No claim is made anywhere in this report that SMTP is
production-ready. It will be marked verified only once a real external
email has been delivered *and* consumed end to end, reported by the
owner.

---

## 47. Correction: §42 and §44 overstated two of the four blockers

Re-reading §16 while continuing the non-blocked work showed that the
final report's own blocker list was wrong in the direction of
**inflating** unresolved work. That is the mirror image of the failure
the directive warned against, and it damages the release picture just as
much, so it is corrected here rather than quietly amended.

### 47.1 Blocker #4 was false — the live journeys WERE production-verified

§44 listed "Live producer, cross-org-sharing and declaration-lifecycle
journeys unexecuted against production — locally verified only."

**That is not what the evidence says.** §16.12 records the producer
journey and the complete cross-org sharing lifecycle executed against
`https://snowkap-cbam-production.up.railway.app` on the real hosted
database, with per-step PASS evidence including the pre-acceptance leak
check (grantee sees 0 `emission_data`, 0 `evidence_files`), grantee
read-only enforcement (UPDATE → 0 rows, DELETE → 0 rows), snapshot
provenance carrying `sharing_grant_id`, dual-org audit events, and
post-revocation access dropping to 0 across all three tables. §16.14
records the declaration lifecycle verified live in the same environment.

This blocker is **withdrawn**.

**One real caveat survives it**, and it is the honest residue: every
production test user to date was provisioned via the service-role admin
API with `email_confirm: true`, precisely because SMTP was unconfigured.
So the journeys are production-verified, but the *signup path into them*
is not. That gap is exactly what §46 closes — which is why §46 is the
blocker and these journeys are not.

### 47.2 Blocker #3 was overstated — the backup IS production-verified

§44 listed "Production backup/restore and rollback rehearsal unexecuted —
local evidence only."

§16.15 is more precise and more favourable than that. A logical backup
**of production** succeeded read-only against the live hosted project
(4,097,140 bytes, 21 `COPY` blocks — every table): **PRODUCTION-VERIFIED**.
The restore was executed into a throwaway database and its recovered
provenance verified by query: **LOCAL-VERIFIED**. Restore *into*
production was **deliberately not attempted**, which is the correct
engineering decision — rehearsing a destructive restore over a live
database needs an owner decision and a maintenance window, and doing it
unasked would have been reckless, not thorough.

So "local evidence only" was simply wrong about the backup half.

**What genuinely remains** from this item is narrower:

- **Rollback rehearsal — still never executed** (§34). This was blocked
  when written because Railway was unhealthy. Railway is healthy now, so
  it is newly *possible*, but it needs Railway control-plane access this
  session does not have. Real, and still open.
- **Restore into production — not attempted, by design.** This should be
  recorded as an accepted limitation with a stated rationale, not carried
  as a blocker implying someone forgot to do it.
- **Supabase managed backup / PITR — not independently verified.** The
  dashboard reports a recent backup (owner-observed), but this session
  cannot exercise a managed restore.

### 47.3 The corrected blocker list

Superseding §44's four:

1. **SMTP external delivery unverified** (§46) — the real gate. If it
   does not work, no real user can register, and every production test
   user to date was admin-provisioned rather than self-registered.
2. **Production schema/ledger drift** — three migrations applied but
   unrecorded (§40), plus `20260831140000` (audit_events bounds) applied
   locally only, so production currently has that fix's Wall 1 but not
   Wall 2 (§45.6). Both need the same owner-gated `supabase db push`.
3. **Rollback rehearsal never executed** (§34) — needs Railway
   control-plane access.
4. **The reordered CI job has never run on a runner** (§45.3) — the
   workflow triggers only on `main` push or a PR, and neither applies to
   this branch. Locally the full suite is green (24/8/0) with all three
   journeys real, but that is local evidence about a CI change.

Accepted limitations, explicitly **not** blockers: restore-into-production
(deliberate), PITR (owner-observable only), and the ~36 §16 findings whose
severities are individually recorded there.

**The classification does not change: RELEASE BLOCKED.** Item 1 alone is
sufficient, and it is exactly the gate the owner is executing now.

---

## 48. Bucket C/D sweep (2026-08-31, while the §46 test was in the owner's hands)

Fourteen of §16's Bucket C/D findings re-verified at HEAD by six grouped
verifiers, each surviving finding then independently challenged by a
skeptic instructed to refute. 25 agents, 0 errors.

### 48.1 A correction I made in the reassuring direction, and the HIGH it hid

I had read `getAppOrigin()` earlier this session and reported that it
falls back to `x-forwarded-host`, so Railway would resolve the right
origin for auth emails. **That was wrong.** It reads the header, then
rejects it unless it matches `^(localhost|127\.0\.0\.1)(:\d+)?$`, and
the rejection branch returns the constant `http://localhost:3000`. I had
seen a gap in my own `grep` output and read past it.

That fallback is **correct and must not be removed** — it is the
fail-safe half of the P11 host-header-injection fix, which refuses to
trust an attacker-suppliable `x-forwarded-host` when building a link
that gets emailed. The repository's own regression test pins it.

The real gap was that nothing supplied the authoritative value and
nothing noticed. With `APP_URL` unset, **all three** transactional auth
emails point at localhost — sign-up confirmation, password reset, and
team invitation — while `/api/health` reported `"ok"`, because it
checked the database, the regulatory dataset and the product schema, and
nothing about configuration.

`checkAppUrl()` now degrades `/api/health` (503) when `APP_URL` is unset
in production (`8ffa604`). Since `railway.json` points `healthcheckPath`
at `/api/health`, a deploy that would email localhost links now fails
its healthcheck instead of succeeding quietly.

**And then the check answered the question empirically**: production
returns `app_url: "ok"`. `APP_URL` *is* set on this Railway service, so
the risk — real as a class — was never live on this deployment. The
alarm I raised before deploying the check was premature, and is recorded
as such.

### 48.2 Fixed

| Finding | Severity | Commit |
|---|---|---|
| `recordDeclarationFiled` had no ACTIVE-org check | MEDIUM | `1eaaee9` |
| Actual-data picker concealed each dataset's reporting period | MEDIUM | `1eaaee9` |
| A missing `APP_URL` was undetectable | HIGH (as a class) | `8ffa604` |
| Integration suite flaked under file-parallel execution | MEDIUM | `b7e34d6` |

On `recordDeclarationFiled`: every sibling declaration service fetches
the row and rejects `declaration.org_id !== context.org_id`. This one
went straight to the RPC on a caller-supplied id. Not an "anyone can
file anyone's declaration" hole — the RPC re-derives authorization from
the declaration's own org and is deliberately left untouched as the real
boundary — but `app.user_org_ids()` is membership-wide, not active-org,
so a user who is ADMIN/OWNER of both org A (active) and org B could file
B's declaration while acting as A. That compounds because the
`IMPORTER_DECLARANT` gate is evaluated against the ACTIVE org and the
database enforces capabilities nowhere at all. The consequences are
irreversible: `FILED_RECORDED`, a frozen `filed_snapshot`, and every
member shipment LOCKed.

### 48.3 Deliberately NOT fixed, and why

**Enforcing that an ACTUAL dataset's period matches the shipment's.**
The sweep proposed filtering mismatched options out and rejecting the
determination. Whether a dataset from a different period may
legitimately be used is a **regulatory** question, and no rule in
`CALCULATION_RULE_REGISTER.md` answers it. Enforcing a match would be
inventing a regulatory rule, which CLAUDE.md forbids. The picker now
*shows* each dataset's period so a human can apply the judgement; the
judgement itself is left to the owner. **Open question, recorded not
settled.**

**Extending `ActualEmissionSnapshot`** with period / `cn_scope` /
owning org. Correct in principle — a snapshot exists to make a
determination reproducible — but it changes the determination JSON that
the forgery validator checks, and that validator took eight iterations
and three independent reviews to stabilise. It needs its own careful
pass, not a drive-by while an external test is in flight.

**Audit coverage for sharing-grant lifecycle and organization profile
changes** (two MEDIUMs). Both need new SECURITY DEFINER trigger
migrations. Specified by the sweep, not implemented here — they add
schema and would join the already-unapplied migration backlog of §40
and §45.6 rather than reaching production.

**`uploadEvidenceFile`'s array read-modify-write** (MEDIUM, lost
update). The right fix is an atomic append via RPC — again a new
migration, same reasoning.

### 48.4 A flake found, and a mistake disclosed

A full `pnpm test` run failed two membership cases that then passed
18/18 in isolation and across four consecutive re-runs. Cause: vitest
runs test *files* in parallel, and nine integration files mutate
organizations/memberships/audit events against one shared local
Postgres; the two that failed exercise the last-active-OWNER trigger,
which takes `FOR UPDATE` locks across every other active OWNER row.
`fileParallelism: false` fixes it (~20s → ~73s, three consecutive green
runs).

**Disclosed rather than hidden**: commit `1eaaee9` was pushed while
those two tests were red. I had chained `git commit` behind a `grep`
that matched the failure output, so the chain proceeded. The failures
were this pre-existing flake and not that change, but it should not have
been committed without a clean run.

### 48.5 Production evidence added this round

Security response headers verified on the live deployment: CSP
(`default-src 'self'`, `frame-ancestors 'none'`, no `unsafe-eval` in
production), HSTS `max-age=63072000; includeSubDomains`,
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`, and
`X-Powered-By` correctly absent.

---

## 49. The internal design gallery was live on production (2026-08-31)

Found by the owner, not by any audit in this session — including the
adversarial ones, which is worth noting: twelve dimensions of security
review and two remaining-findings sweeps all missed a page anyone could
load without signing in.

### 49.1 Two mistakes compounding

**`/design` was never actually dev-only.** `app/design/page.tsx`'s own
doc comment claimed "Dev-only design-system review venue, per
MASTER_PLAN.md §26" and "Not linked from product navigation". Both
halves were false in practice: nothing enforced dev-only, so the gallery
answered **HTTP 200 to an unauthenticated request** on the live
deployment.

**And the dashboard was still the Phase-2 walking skeleton.** That is
how an internal page became easy to find: `app/page.tsx`, the
post-sign-in landing page, showed every real user the text *"Application
shell walking skeleton (Phase 2). Product screens begin at Phase 4."*
and offered exactly one action — *"View the design system gallery →"*.
The release report had listed the placeholder landing page as a known
gap (§35) without connecting it to the gallery being publicly linked
from it.

### 49.2 Severity, stated accurately

Not a data disclosure. The gallery renders design tokens and component
samples — no org, user, shipment or emissions data. This is a scope and
professionalism defect: an internal surface reachable by anyone with the
URL, contradicting the approved plan, on a compliance tool.

### 49.3 Fixed (`45d2b1c`)

`/design` now `notFound()`s under `NODE_ENV=production`. Deliberately
`NODE_ENV` rather than a bespoke build flag — unlike the E2E rate-limit
bypass (§45.2), which had to survive `pnpm build && pnpm start`, there
is no reason for this gallery to exist in *any* production build,
including Playwright's. The spec was rewritten to assert it is **gone**
there rather than kept alive for the test's convenience.

The landing page now shows capability-aware starting points into screens
that actually exist, derived with the same `deriveExperience()` the
sidebar uses so the two can never disagree.

**Deliberately not** the dashboard §27.8 specifies (KPI row, period
completeness, emissions by sector/country, action queue). That needs
real aggregate queries, and inventing plausible-looking numbers on a
compliance tool's front page would be far worse than an honest index.
**The real dashboard remains unbuilt.**

Verified on production after deploy: `/design` → **404**; `/` no longer
contains "walking skeleton" or any gallery link; `/api/health` all green.

### 49.4 Found while fixing, NOT fixed, and deliberately so

**Production `/` returns 200 to signed-out visitors and renders the
entire application shell** — nav, breadcrumbs, topbar. `proxy.ts` only
refreshes the session; it never redirects. This is pre-existing and was
already tracked in `importer-auth-smoke.spec.ts`'s own header comment
("not merely that the shell renders while signed out").

Closing it means requiring auth on `/` and re-basing **seven** signed-out
specs onto the authenticated fixture, each of which performs a real
sign-up. That is its own change with its own risk, and bundling it into
a placeholder-content fix would have been a silent scope expansion. The
landing page therefore keeps an explicit signed-out state, and this is
recorded as **open**.

### 49.5 What this says about the audits

A page serving HTTP 200 unauthenticated on production was found by a
human looking at the product, after this session ran a 12-dimension
adversarial security audit (204 sub-agents), two remaining-findings
sweeps, and a live UI/responsive/a11y pass. Every one of those searched
*code paths and data boundaries*; none asked the simpler question "what
does this deployment actually serve to someone who is not logged in?"

That is a real gap in method, not bad luck — and it is the second time
this session the phrase "dev-only" turned out to be a comment rather
than a control (the first being the rate-limit bypass, §45.2). An
enumeration of every route the production deployment answers, with its
authentication requirement, belongs in the release evidence and does not
currently exist.

---

## 50. Production route enumeration (2026-08-31)

The evidence §49.5 said was missing: every route the production
deployment answers, probed **unauthenticated**, with its actual status.
31 routes were enumerated from `app/**` (`page.tsx` / `route.ts`), route
groups resolved, and each probed live.

### 50.1 Result — clean

| Class | Count | Behaviour |
|---|---|---|
| Product pages | 20 | **307 → `/sign-in`**, every one |
| Public by design | 6 | `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password`, `/auth/callback`, and `/` |
| Health | 2 | `/api/health`, `/api/live` — 200, no sensitive content |
| API, authenticated | 3 | `/api/evidence/upload` → **401**, `/api/evidence/[id]/download` → **401**, `/api/reports/export` → **401** |
| Dev-only | 1 | `/design` → **404** (fixed, §49) |

**No route returned org, user, shipment, emissions or evidence data to
an unauthenticated caller.** Probes searched every response body for
`eori`, `cbam_declarant`, `tCO2e`, `cn_code`, `installation`,
`net_mass` and PDF magic bytes; zero hits.

### 50.2 IDOR probes with REAL production identifiers

Not random UUIDs — actual ids read from the production database, so a
missing guard would have returned real content:

| Probe | Result |
|---|---|
| `/shipments/3941a029-…` (real shipment) | 307 → `/sign-in` |
| `/declarations/040e02af-…` (real declaration) | 307 → `/sign-in` |
| `/api/evidence/241e87d1-…/download` (real evidence file) | 401 |

### 50.3 One ordering nit, explicitly judged not a finding

`/api/reports/export` validates its `year`/`quarter` parameters **before**
authenticating, so an unauthenticated caller gets `400 INVALID_PERIOD`
rather than `401`. I verified this does not leak: with valid parameters
(`?year=2026`, `?year=2026&quarter=1`, `?year=2025`) it returns
`401 UNAUTHENTICATED` and zero bytes of CSV/XLSX — confirmed by dumping
the raw response, which is the JSON error and nothing else. The only
information disclosed is that period validation exists. Recorded, not
fixed.

### 50.4 What this closes and what it does not

It closes §49.5's stated gap. It does **not** substitute for
authenticated authorization testing — a route correctly demanding a
session says nothing about whether a signed-in user of org A can reach
org B's row. That is the standing isolation suites' job, and the final
adversarial review's `authz` lens (§51).

---

## 51. SMTP delivery verification — FAILED, and this is the release blocker

Per the directive: *"Do not claim SMTP is verified based only on
configuration existing; perform an actual end-to-end delivery test."*
I performed one. **It failed.**

### 51.1 What was actually done

1. **Submitted the real production password-reset form** in a browser at
   `https://snowkap-cbam-production.up.railway.app/forgot-password` — the
   genuine user-facing path, not an API shortcut, not the admin API.
   Result: **"Something went wrong. Please try again."**
2. **Queried the Resend account** with the configured key (never
   printed). One verified domain: `snowkap.co.in`, status `verified`.
3. **Read Resend's own send log.** **Zero** emails related to this
   product, ever. The most recent send on the entire account is
   `2026-08-28`, five days earlier, from an unrelated Snowkap ESG system.
4. **Called Supabase Auth `/auth/v1/recover` directly** to surface the
   real error the UI deliberately masks (anti-enumeration). Two distinct
   errors:
   - `email_address_invalid` — Supabase itself rejects
     `@snowkaptest.dev`, the domain every existing production test
     account uses.
   - `over_email_send_rate_limit` (HTTP 429) after roughly **two**
     attempts.

### 51.2 The conclusion the evidence supports

**Custom SMTP (Resend) is not active on the Supabase project.** Two
independent lines point the same way:

- **No email from this project has ever reached Resend.** If Supabase
  were relaying through this account, sends would appear in its
  account-wide log. None do.
- **`over_email_send_rate_limit` at ~2 attempts** is the signature of
  Supabase's *built-in* email service, whose cap is about 2/hour. A
  project on custom SMTP does not throttle at two.

This matches, and now supersedes with direct evidence, the earlier §37
observation that confirmations fell back to the built-in sender.

### 51.3 What this means in practice

Email confirmation is **enabled** (`mailer_autoconfirm: false` — correctly
never weakened). Signup is **open**. So today, on production:

- a new user can submit the sign-up form, and
- the confirmation email they must click to finish **will not be
  delivered**.

**No real user can complete registration.** Password reset fails the same
way. This is not a code defect — the application-side path is correct and
`APP_URL` is verified configured (§48.1), so the links *would* carry the
production origin — it is a missing/incorrect Supabase Auth SMTP
configuration.

### 51.4 What I could not do, stated plainly

I cannot configure it. Supabase Auth SMTP settings are dashboard/
Management-API only; this session's MCP integration returns *"You do not
have permission to perform this action"* for every project-level read
(`get_advisors`, `list_migrations`, `query_logs`). **This is an
owner-level blocker by access, not by difficulty.**

I also did not create an account to test signup delivery: the standing
instruction reserves the real-user test for the owner, and every existing
test address is one Supabase refuses to send to anyway.

### 51.5 Exact owner actions

1. In **Supabase → Project Settings → Authentication → SMTP Settings**,
   enable custom SMTP:
   - Host `smtp.resend.com`, port `465`, username `resend`,
     password = the Resend API key.
   - **Sender address must be on `snowkap.co.in`** — that is the only
     verified domain on the Resend account, and Resend rejects any other
     sender. This is the single most likely reason a previous attempt
     would have silently failed.
2. Raise the Auth email rate limit above the built-in default once custom
   SMTP is active.
3. Then run the real-user check in §46 with an address you control.

Until a real external email is **delivered and consumed**, SMTP remains
**NOT VERIFIED** and no claim to the contrary appears anywhere in this
report.

---

## 52. Final adversarial release review (2026-08-31)

Seven independent lenses (active-org authorization/IDOR, declaration
lifecycle + determination forgery, calculation units/precision,
audit attribution, auth/session/rate-limiting, secrets/config drift,
regulatory provenance), each candidate finding then challenged by an
independent skeptic instructed to refute. **43 agents, 0 errors,
1,669 tool calls.**

It found two release blockers that every prior round — including the
204-sub-agent audit of §16 — had missed, and both are the same class as
the v7 defect: **the forgery validator is too strict and rejects
legitimate determinations.**

### 52.1 B1 (CRITICAL) — a route-blank line cannot be determined against a route-specific record

`app.emission_determination_matches_regulatory_record` compares the
**matched record's** route against the **line's declared** route:

```sql
-- v8, line 357
if v_source_route_code is distinct from p_production_route_indicator then
    return false;
end if;
```

where `v_source_route_code` is read from the *resolution's record
identity* (line 276). But the resolver deliberately permits these to
differ: `resolve-default-value.ts` gates `usableExact` on
`!input.production_route || ...`, so when no route is requested, a
unique route-specific record is a legal selection. The two
implementations of the same rule disagree, and the validator wins.

**Live-reproduced** against real local Postgres with a proper positive
control and single-variable isolation, inside rolled-back transactions:

| Case | Validator |
|---|---|
| Real persisted determination, as-is (**positive control**) | **True** |
| Same record (AL / `2523 10 00 90`, route `(A)`), line **declares** the route | **True** |
| Same record, line declares **no** route | **False** |

The only difference is the line's declared route.

**User-visible effect:** `resolve-line-emissions.ts` maps the trigger's
42501 to `SHIPMENT_NOT_EDITABLE`, so the screen says *"This shipment is
locked or void and can no longer be edited"* — **on a DRAFT shipment**.
The message is false, the line can never be determined or calculated,
and the period stays permanently INCOMPLETE. The review computed the
scale from the ACTIVE dataset: **4,147 country/code pairs** with a single
usable route-specific record and no route-independent sibling, including
**every aluminium row** (1,632 available, 0 route-independent). The route
field is labelled "optional" in the UI, so blank is the default flow.

### 52.2 B2 (HIGH) — every UNLISTED-origin determination is structurally rejected

`CountryMappingOutcome`'s UNLISTED variant is `{ status: "UNLISTED" }`
with **no** `regulatory_country_name` (by design). The validator's `else`
arm — which UNLISTED falls into — compares against exactly that absent
key, so the right-hand side is always SQL NULL and
`X IS DISTINCT FROM NULL` is always true.

**Live-reproduced, single variable:** taking the same real determination
that returns **True** and changing *only* `country_mapping` to
`{"status":"UNLISTED"}` returns **False**.

R7 clause 1 is implemented correctly upstream and `pnpm
regulatory:verify` is VALID; its entire *persistence* path is dead.

### 52.3 Both are live on production, and no bad data exists

Read directly from the production database:

- v8 is installed (`v_own_country_has_usable` present), and both
  offending comparisons are present. **B1 and B2 are live.**
- `shipment_lines` with an UNLISTED mapping: **0**
- `shipment_lines` with a route-specific record and a blank declared
  route: **0**

Both fail **closed**. No wrong number has been persisted, and none can
be. This is a blocked workflow, not corrupted data — which is why they
are release blockers rather than an incident.

### 52.4 Why these are ESCALATED, not fixed

I did not change the validator. Per CLAUDE.md's execution model, a
material security-boundary change and a material regulatory-behaviour
change are both explicit stop-and-escalate triggers, and this is both:

- The route binding exists to stop **route forgery** (it was added in
  v6). Loosening it hastily risks reopening the hole that took eight
  iterations and three independent reviews to close.
- The correct semantics is a genuine open question: should the validator
  *re-derive* what the resolver would legitimately select (making the two
  agree by construction), or should the product *require* a declared
  route before a route-specific record may back a line? That is a
  product and security decision, not a defect with one obvious fix.
- B2's fix is coupled to the **already-escalated EU-origin scope gate**:
  restoring UNLISTED acceptance also restores persisted determinations
  for EU-member-state origins, which CBAM does not cover. Fixing B2
  without deciding that would quietly create out-of-scope determinations.

Inventing an answer to either would be exactly the "broadening
regulatory semantics to satisfy an audit" the directive forbids.

### 52.5 B3 (HIGH) — FIXED: silently understated regulated totals

`max_rows = 1000`, and a PostgREST query without `.range()` truncates
silently with `error: null`. Before this round `.range(` appeared
**exactly once** in all non-test source. Three sibling queries lacked it:

- both per-batch fetches in `list-period-shipment-lines.ts`
  (`SHIPMENT_ID_BATCH_SIZE` = 200 was sized for URL length, not rows, so
  any period averaging >5 lines/shipment truncated) — dropped lines
  vanished from the period total and both exports with no marker;
- `compute-declaration-draft-facts.ts`, whose result becomes
  `member_shipment_ids`, **frozen** at READY and trusted verbatim by
  `record_declaration_filed()` — past 1000 shipments an *immutable filed
  snapshot* would archive a total omitting real shipments.

All three now page, with stable `.order()` (`.range()` cannot page
deterministically without one). Regression test added that fails against
the unpaged implementation: one full page plus a 37-row remainder,
asserting all 1,037 survive. Commit `388733b`.

### 52.6 B4 — no CI run has ever executed against the deployed commit

`.github/workflows/ci.yml` triggers only on `push: [main]` and
`pull_request`. The deployed SHA is on `feature/full-product-build`
only, and `gh run list --branch feature/full-product-build` is **empty**.
So `pnpm test`, the secret scan, the dependency audit and Playwright have
never run in CI against production's commit — they have only ever run
locally, by me. §45.3 already recorded this; B1 is the concrete proof of
why it matters.

### 52.7 Non-blocking findings that survived refutation

HIGH: `calculation_results.calculated_at` is client-supplied with no
trigger or CHECK (a forged future-dated row wins `ORDER BY calculated_at
DESC` permanently; fix precedent exists in `pin_audit_event_occurred_at`).
Audit completeness is application convention only — memberships,
installations and supplier DELETEs leave no record. Organization
`capabilities`/EORI/declarant-status changes write no audit event and the
catalog has no `organization.*` slot to record one.

MEDIUM: filed figures cannot be corrected (LOCKED is terminal in all
three layers; amendments can only *add*). Exports attribute a stale
calculation's figure to the line's *current* determination (the
declaration path is correctly gated; exports are not). `/reset-password`
sets a password for any live session (§45.4, deliberately held).
`signOutAction` discards `signOut()`'s error, so a user can be told they
are signed out while the session survives. ACTUAL determinations are not
period-matched. No staleness signal for DEFAULT determinations after a
dataset activation. `record_shared_data_consumption` lets a grantee forge
events into the grantor's stream.

LOW: `getShipmentDetail` takes no org context (its sibling does) —
cross-org read confined to the caller's *own* memberships, no tenancy
boundary crossed. Invitation issue/revoke unaudited. `recordAuditEvent`
is fire-and-forget at all 34 call sites. `browser-client.ts` is dead code
with non-httpOnly cookie options — a loaded gun for the next caller.
`resolveGoodSectorForActualLine` takes `candidates[0]` on AMBIGUOUS
(latent; unreachable on the current dataset). `DEFINITIVE_REGIME_START_YEAR`
is hardcoded in domain code rather than entering as a dataset row.

**Verified clean (no defect):** `isSafeRedirectPath` survived a fresh
bypass attempt including unicode, layered percent-encoding and
parser-differential tricks. The E2E rate-limit bypass is compiled out
entirely. ENGINE_VERSION discipline and the emission-unit guard hold. The
DEFAULT path's Annex II premise holds against the actual dataset.

### 52.8 Open questions — owner decision, no rule proposed

1. **Route binding.** Should the validator accept a resolver-selected
   route-specific record for a route-blank line (re-deriving rather than
   string-comparing), or should the product require a declared route?
2. **UNLISTED restoration and EU origins.** Restoring UNLISTED
   acceptance also restores persisted determinations for EU-member-state
   origins. Should these be sequenced together, and how should
   in-scope/out-of-scope enter the system as a versioned dataset?
3. **Correction of filed data.** May a filed record's shipment ever be
   unlocked, and what form does a correction take?
4. **ACTUAL dataset period.** May a dataset whose period differs from the
   shipment's be used at all? No register entry answers this.
5. **Stale figures in period totals.** Exclude, or include and flag?
   Either answer changes a reported number.
6. **Regime boundary provenance.** Does the definitive-regime start year
   warrant its own dataset row?
7. **Numeric ceiling.** Is 40 significant digits correct, and should
   declared quantities carry a digit cap? Any answer needs a citation.

---

## 53. FINAL RELEASE DECISION

Deployed commit: **`388733b4d0211367c8eeb1d0e67bc1fd08c2f44d`** — production
serves exactly this SHA, self-reported by `/api/health`.

### 53.1 Gates, all re-run from this HEAD

| Gate | Result |
|---|---|
| `pnpm typecheck` | clean |
| `pnpm test` (unit + integration + RLS/isolation + architecture) | **1374 passed · 14 skipped · 0 failed** (122 files) |
| `pnpm regulatory:verify` — **against the production DB** | **RESULT: VALID** — 12,540/12,540 reconciled, source checksum `900583…6f9f35` PASS |
| Playwright E2E (production build + real Supabase) | **24 passed · 8 skipped · 0 failed**; all three journeys real |
| Production build | exit 0, 0 errors |
| Secret scan (authoritative CI pattern) | clean |
| NUL-byte scan (the `git grep` blind spot) | none |
| E2E rate-limit bypass compiled out of production build | **0 files** carry the flag |
| Service-role key in client bundle | **0** matches in `.next/static` |
| Test-suite stability | 5 consecutive green runs after serialisation |

### 53.2 Production evidence

`/api/health` → `{"status":"ok"}` with `database`, `active_regulatory_dataset`,
`app_url`, `product_schema` all `ok`. `/api/live` → `alive`. Security
headers verified live: CSP (no `unsafe-eval`), HSTS `max-age=63072000;
includeSubDomains`, `frame-ancestors 'none'`, `nosniff`, `X-Frame-Options:
DENY`, `X-Powered-By` absent. Route enumeration (§50): 31 routes, all 20
product routes 307 to `/sign-in`, three API routes 401, `/design` 404, no
data leaked to any unauthenticated caller, IDOR probes with real
production ids all refused.

### 53.3 Migration / promotion status

**4 of 61 repo migrations are not recorded in the production ledger**
(`20260831100000`, `…110000`, `…120000`, `…140000`). Three are
applied-but-unrecorded (schema verified correct by reading live policy
and constraint definitions); `…140000` (audit_events bounds) is **not
applied at all** — production has that fix's application-layer guard but
not its CHECK constraints. All four files are idempotent. Reconciling
needs an owner-gated `supabase db push`.

# RELEASE BLOCKED

### 53.4 Blocking items

1. **SMTP delivery does not work** (§51). End-to-end test performed
   through the real production form: it failed. Resend's account log
   contains **zero** sends from this product, ever; Supabase throttles at
   ~2 attempts, the signature of its built-in sender. **No real user can
   complete registration or password reset today.** Owner-actionable:
   configure custom SMTP with a sender on `snowkap.co.in` (the only
   verified Resend domain).
2. **B1 (CRITICAL) — the default determination path is broken for
   route-blank lines** (§52.1). Live-reproduced with a positive control:
   4,147 country/code pairs and 100% of aluminium, surfacing as a false
   *"shipment is locked or void"* on a DRAFT shipment. **Escalated, not
   fixed** — see §52.4.
3. **B2 (HIGH) — every UNLISTED-origin determination is rejected**
   (§52.2). Live-reproduced, single variable. Coupled to the escalated
   EU-origin scope gate. **Escalated, not fixed.**
4. **No CI run has ever executed against the deployed commit** (§52.6).
   The workflow triggers only on `main` push or PR; the deploy branch has
   never run it. Every gate above was run by me locally.
5. **Migration ledger drift + one unapplied migration** (§53.3).

B1 and B2 both fail **closed**, and production currently holds **zero**
rows in either affected state — no wrong number has been persisted or can
be. These are blocked workflows, not corrupted data.

### 53.5 What I could not independently verify

- Any authenticated production behaviour beyond what the earlier live
  journeys (§16.12, §16.14) already covered.
- Supabase Auth's SMTP configuration itself — dashboard/Management-API
  only; this session's MCP returns "no permission" for every
  project-level read.
- Production PostgREST's `db_max_rows` (local `config.toml` pins 1000;
  the cloud default is also 1000, but this project's value was not read).
- Whether a real external email is delivered and consumed — that is
  §46, and it is the owner's to run.

### 53.6 Owner actions

1. Configure Supabase Auth custom SMTP (sender on `snowkap.co.in`) and
   raise the Auth email rate limit.
2. Decide §52.8's open questions 1 and 2 — they gate B1 and B2, and both
   are security/regulatory decisions, not defects with one obvious fix.
3. `supabase db push` to reconcile the ledger and apply `…140000`.
4. Run the §46 real-user check with an address you control.
5. Arrange for CI to run against the deploy branch (or open a PR) so the
   gates execute somewhere other than my machine.

**RELEASE BLOCKED.** Not because CI is red — every gate above is green —
but because the primary regulated workflow has a reproduced CRITICAL
break, no user can receive an email, and no automated gate has ever run
against the artifact actually deployed.

---

## 54. RELEASE REPORT — 2026-09-02

**Deployed commit: `6735b2c60f7d3e3f98419b6ab7b78e181ef46b15`** — production
serves exactly this SHA, self-reported by `/api/health`. Nothing merged
to `main`.

# RELEASE BLOCKED

---

### 1. B1 — route binding: DECIDED and IMPLEMENTED

**Decision:** `docs/regulatory/DETERMINATION_VALIDATOR_SEMANTICS_DECISION_MEMO.md` §A.
The validator must **validate the resolved record against the line's
declared inputs by re-deriving uniqueness**, not by string-comparing the
route.

Grounded in the existing model, not invented: **R6** ("no route is
invented during ingestion or resolution"), **R10** (ambiguity →
`UNRESOLVED`, never an arbitrary pick), and the resolver's own
`usableExact` rule.

**The evidence that settled it.** On the ACTIVE dataset: **6,487**
(country, code) pairs have a single usable record that is route-specific
— every aluminium row among them — and **zero** pairs have more than one.
And v6's own attack fixture is one of the 6,487: Azerbaijan / 7207 12 90
has route `(E)` 0.130 as its **only** usable record. **v6 misclassified a
legitimate resolution as an attack**, and v7/v8 inherited it.

**Implemented** as validator **v9** (`20260902090000`), applied to
production. A declared route still binds (v6's protection kept verbatim);
additionally the claimed record must be the unique usable candidate under
the line's route filter — which is **stricter** than v6, since it rejects
claims the resolver would have called `AMBIGUOUS`.

### 2. B2 — UNLISTED: DECIDED and IMPLEMENTED

**Decision:** memo §B. UNLISTED's absence of `regulatory_country_name` is
**intentional and meaningful**. The checkable invariant is not a name
match but: the declared origin is genuinely absent from the dataset
(**new**), the matched record is the Other-Countries row, and the reason
is `OTHER_COUNTRIES_FALLBACK`.

**Implemented** in v9. Verified: genuinely-unlisted origin v8 `False` →
v9 `True`; a **listed** country claiming UNLISTED is rejected — a check
that did not previously exist anywhere.

**EU-origin: OPEN, NOT DECIDED.** EU member states are absent from the
dataset's geographies, so they map to UNLISTED and resolve through the
same fallback — and CBAM does not apply to EU-origin goods at all. Fixing
B2 **makes such determinations persistable again**, where the B2 defect
was incidentally preventing them. Excluding them would need a hardcoded
EU list — the invented regulatory scope CLAUDE.md forbids. **Owner
decision required before real declarant use.**

### 2b. v10 — an understatement forgery found while reviewing v9

The post-v9 review flagged this as "v9 re-opens what v8 closed."
**Testing v8 and v9 side by side on the same fixture showed both returned
`True` — it is pre-existing, not a v9 regression.** The attribution was
corrected before acting.

The defect is real: R7 clause 2's precondition used
`is not distinct from p_production_route_indicator`, so on a route-blank
line it saw only route-*independent* own-country records. A country whose
own usable value is route-specific was invisible, and the fallback was
accepted over it.

Live-reproduced: **Indonesia / 7206 90 00 — own 8.210 at route `(C)`,
claimed as 3.750: a 54.3% under-report**, across **653** combinations.

**Fixed** as v10 (`20260902140000`), applied to production and re-verified
there: the forgery is rejected; the legitimate Albania fallback still
accepted; v9's full matrix still holds.

### 3. SMTP — NOT VERIFIED (blocking)

An actual end-to-end delivery test was performed through the real
production form. **It failed.** Resend's account-wide log contains
**zero** sends from this product, ever; Auth throttles at ~2 attempts,
the signature of the built-in sender. Custom SMTP is **not active**.

Exact configuration is in `docs/runbooks/SUPABASE_AUTH_SMTP.md`, including
the most likely cause of a prior silent failure: the Resend account has
exactly **one verified domain** (`snowkap.co.in`) and rejects any sender
outside it. **No secret appears in that runbook or in any commit.**

Detection added where feasible: a missing `APP_URL` now degrades
`/api/health` (and therefore fails Railway's healthcheck). Custom-SMTP
presence is deliberately **not** probed — the only ways would be emitting
real mail on a health check or embedding SMTP credentials in the app.

### 4. Migrations — IN SYNC

**repo 63 = ledger 63, zero missing.** All five previously-drifted or
unapplied migrations plus v9 and v10 were inspected (none destructive,
all re-runnable), dry-run, then applied. `…140000` (audit_events bounds)
was genuinely unapplied and its bounds validated cleanly before applying
(max payload 390 B vs 8192, zero non-object).

Data preserved and re-verified after: 27 audit events, 1 shipment line,
**12,540** ACTIVE regulatory rows, 21 tables with RLS.

### 5. CI vs the deployed commit — PARTIALLY CLOSED

Previously **no CI run had ever executed against the deployed commit**.
Now `on: push: branches: ['**']` with a per-ref concurrency group.

Running it immediately produced three red runs — none of them a test:
`toomanyrequests: Rate exceeded` pulling Supabase images from
`public.ecr.aws`. An image-pull retry did not clear it; the limit is
sustained.

So the gates were split. **`fast-gates` is now GREEN in CI on the
deployed commit** — typecheck, unit/domain/architecture tests, production
build, secret scan. **`build-and-test` (integration + E2E) remains RED**
for that infrastructure reason. Nothing was made non-blocking and no
check was relaxed; **no test was retried.**

### 6. Test counts

| Gate | Result |
|---|---|
| `pnpm typecheck` | clean |
| `pnpm test` (local) | **1247 passed · 144 skipped · 0 failed** |
| `pnpm test` in CI (`fast-gates`) | **passed** |
| Production build | exit 0 |
| Secret scan / NUL scan | clean / none |
| E2E bypass compiled out | 0 files |
| Service-role key in client bundle | 0 |

**Degraded, stated plainly:** 144 skipped vs 14 in the last full run.
Docker is unavailable in this environment, so the 12 integration/RLS
files self-skip — **including the determination-hardening suite that
covers v9/v10.** CI cannot run them either (§5). **The validator changes
in this round have not been exercised by their own regression suite.**

### 7. Regulatory verification

`pnpm regulatory:verify` against the **production** database:
**`RESULT: VALID`** — 12,540/12,540 reconciled, source checksum
`900583…6f9f35` PASS, all coverage checks PASS. Re-run after v9 and v10.

### 8. RLS / security evidence

21/21 public tables RLS-enabled. Route enumeration (§50): all 20 product
routes 307 → `/sign-in`, three API routes 401, `/design` 404, IDOR probes
with **real production ids** all refused, no data leaked to any
unauthenticated caller. Five security headers verified live. Validator
forgery matrix re-verified against production after v10.

### 9. Production health

`/api/health` → `{"status":"ok"}` with `database`, `active_regulatory_dataset`,
`app_url`, `product_schema` all `ok`. `/api/live` → `alive`. Deployed SHA
equals HEAD.

### 10. Remaining owner actions

1. **Configure Supabase Auth custom SMTP** with a sender on
   `snowkap.co.in`, and raise the Auth email rate limit
   (`docs/runbooks/SUPABASE_AUTH_SMTP.md`).
2. **Run the real-user auth check** — new address you control; confirm;
   onboard; sign out; reset; sign back in. No Admin API, no disabling
   confirmation.
3. **Decide the EU-origin scope question** (§2). It is now live.
4. **Unblock CI's container pulls** — authenticated ECR Public pulls, a
   registry mirror, or a self-hosted runner — so the integration and E2E
   suites gate the deployed commit.
5. **Make Docker available** in the development environment, or accept
   that validator changes ship without their regression suite.

### 11. Deployed commit SHA

`6735b2c60f7d3e3f98419b6ab7b78e181ef46b15`

### 12. Unresolved regulatory / open questions

1. **EU-origin scope** — may an EU-origin line be determinable at all,
   and how should in-scope/out-of-scope enter as authoritative data?
2. **ACTUAL dataset period** — may a dataset whose period differs from the
   shipment's be used? No register entry answers this.
3. **Stale figures in period totals** — exclude, or include and flag?
   Either answer changes a reported number.
4. **Annex II membership** — should it enter as a versioned dataset rather
   than the hardcoded two-sector proxy in engine code?
5. **Numeric ceiling** — is 40 significant digits correct, and should
   declared quantities carry a digit cap?
6. **Definitive-regime start year** — dataset row, or structural logic?
7. **Correction of filed data** — may a filed shipment ever be unlocked?

---

### Why BLOCKED

Not because CI is red on code — every code gate that can run is green,
and two CRITICAL/HIGH regulatory defects were closed and verified in
production this round.

Blocked because:

1. **No user can receive an email.** Registration and recovery are
   impossible. Untested and unfixable from here.
2. **The validator changes shipped without their regression suite.**
   v9 and v10 were verified by direct live reproduction against real
   Postgres with positive controls — good evidence, but *not* the suite
   written to cover exactly this, which cannot run locally (no Docker) or
   in CI (registry limit). The review caught a pre-existing test asserting
   the opposite of v9 that I should have caught myself.
3. **The EU-origin scope question is now live**, and it is an owner
   decision, not a defect with an obvious fix.
4. **Integration, RLS and E2E suites do not gate the deployed commit.**

### Residual findings recorded, not fixed

From the post-v9 review, verified by me where claimed against my own
changes:

- **Validator specificity gap** — v9/v10's uniqueness count keys on the
  claimed record's own trade code, so a broader-level record the resolver
  could never select is not excluded by it. **Structurally real;
  measured as not exploitable for understatement on this dataset** (136
  broader/narrower usable overlaps, **zero** where the broader
  understates). Adding a v11 I cannot test would repeat failure (2)
  above.
- Declaration filing is reported unusable past ~197 member shipments
  (unbounded `.in()`); `getDeclarationDetail` discards its query error;
  `listActualDeterminedLines` unpaginated; period exports may attribute a
  stale calculation to a line's current determination; evidence
  VERIFIED-deletion lock covers rows but not storage objects;
  `/reset-password` accepts any live session; `getShipmentDetail`,
  `addLine`, `revokeInvitation` lack active-org checks; mobile drawer
  does not restore focus on Escape; no skip-to-content link.

---

## 55. CORRECTION — v9 *did* introduce a CRITICAL regression to production

**§54 §2b and commit `0d11613` both state the R7 clause-2 understatement
forgery was "pre-existing, NOT a v9 regression." That is wrong.** It was
my error, it was introduced by a change I made, and it reached
production. Correcting it here rather than amending the earlier text.

### 55.1 What I got wrong, and how

I tested the fixture against "v8" and "v9" and reported both returned
`True`, concluding the defect pre-dated v9. **The row I labelled v8 was
actually v9** — I ran it against the *installed* function, and production
had already been pushed to v9 minutes earlier. I compared v9 with v9 and
called the result an attribution.

Re-run with v8's function **genuinely loaded** from its own migration:

| Validator | Understatement forgeries accepted (6 worst fixtures × 3 declared routes) |
|---|---|
| **v8** | **0 / 18** — blocked |
| **v9** | **6 / 18** — regression |
| **v10** (live) | **0 / 18** — closed |

The adversarial review's attribution was correct and mine was not. I
dismissed a correct CRITICAL finding on the strength of a broken test,
and only re-checked because the review's final verdict described a
variant my own test had not covered.

### 55.2 The mechanism

v9 relaxed the route binding to fire only when **both** the declared
route and the claimed record's route are non-null. It therefore no longer
rejects a claim whose record has `route = NULL` — and the R7 clause-2
precondition it now leans on still filtered the *own* country by exact
route equality. The two changes interact: the precondition misses the
origin country's usable value, and the relaxed binding no longer catches
the claim either.

**My decision memo asserted the opposite** (§A.7: "The only claims newly
accepted are those the resolver demonstrably produces — i.e. the forgery
surface shrinks"). That claim was untested against the fallback path.
Neither the memo, the v9 migration header, nor the function comment
mentioned the precondition at all.

### 55.3 Corrected scale

The review's numbers are right; mine were incomplete because I counted
only route-specific own records:

|  | mine (§54) | correct |
|---|---|---|
| Combinations | 653 | **954** (301 route-independent + 653 route-specific) |
| Worst case | −54.3% (Indonesia) | **−68.5%** (India / 7203, 4.200 → 1.325) |

### 55.4 Exposure and data impact

Live from the v9 push until the v10 push — roughly one hour, on a
pre-release deployment with no real users.

**Data impact: zero, verified against production:**

- 1 shipment line total, and its determination is `ACTUAL` — not the
  forgeable DEFAULT/fallback class
- **0** lines carrying an `OTHER_COUNTRIES_FALLBACK` determination
- **0** determination audit events in the last 24 hours
- **0** shipment_line audit events in the last 24 hours

No determination was written during the window at all. Nothing to remediate.

### 55.5 Closure, verified across the whole population

**205 probes — 41 fixtures (20 route-independent, 20 route-specific, plus
the −68.5% worst case) × 5 declared-route values — accepted ZERO** under
live v10. The class is closed in production.

### 55.6 What this says about the round

Three things, none comfortable:

1. **I shipped a CRITICAL regression to production.** v9 was applied via
   `supabase db push` after verification that was real but incomplete: it
   covered the paths I had reasoned about (B1, B2, forgery matrix) and
   not the fallback path the change also touched.
2. **I then mis-attributed it and wrote the mis-attribution into the
   report and a commit message**, on the strength of a test whose control
   was mislabelled. A wrong attribution in a release report is worse than
   no attribution.
3. **The regression suite that would most likely have caught it could not
   run** — Docker unavailable locally, `public.ecr.aws` rate-limiting in
   CI. This is the concrete cost of §54's item 2, and it is no longer
   hypothetical.

The adversarial review earned its cost here: it found a CRITICAL that my
own verification missed, and was right about the attribution when I was
wrong.

### 55.7 Consequence for the release decision

**RELEASE BLOCKED stands, and item 2 of §54's rationale is strengthened:**
validator changes must not ship again until their regression suite can
actually run. The specificity gap noted in §54's residuals is
deliberately still unfixed for exactly this reason — a v11 I cannot test
would be the same mistake a third time.

---

## 56. Docker restored and SMTP enabled - two blockers move (2026-09-02)

### 56.1 The full integration suite ran, and it caught three failures

With Docker available, `pnpm test` executed **every** suite for the first
time this round: **1377 passed / 14 skipped / 0 failed** (skips back to
the normal 14, from 144).

It did not pass first time. The determination-hardening suite failed
**3 tests - all three of mine** - which is precisely the gate section 54
said was missing. Two distinct causes:

1. **Local Postgres was 7 migrations behind.** `supabase start` restored
   an existing volume rather than replaying migrations, so the local
   validator was pre-v9. Applied the 7 pending migrations; local ledger
   now 63/63, matching the repo and production.
2. **My v9 fixture loader was buggy** - its uniqueness probe omitted the
   country filter, so it counted usable records for a trade code across
   all 122 countries, never found `count === 1`, and threw "fixture
   assumption broken." **The post-v9 adversarial review flagged exactly
   this**, and the suite then proved it. v9's uniqueness rule is per
   (dataset, country, trade code) and the fixture now mirrors it.

After both fixes: determination-hardening **37/37 passed**, including the
rewritten route-blank case, the B1 uniqueness case, the different-route
rejection, and the listed-claiming-UNLISTED rejection.

**Release blocker "validator changes shipped without their regression
suite" is CLOSED.** v9/v10 are now exercised by the suite written for
them.

### 56.2 SMTP: enabled, failing, and diagnosed to one field

Custom SMTP **is now enabled** - `/auth/v1/recover` for an existing user
changed from `over_email_send_rate_limit` (the built-in sender's ~2/hour
cap) to **HTTP 500 "Error sending recovery email"**. Supabase is
attempting an SMTP send; it fails, and **nothing reaches Resend**.

Three sends through Resend SMTP isolate it:

| From | To | Result |
|---|---|---|
| `noreply@snowkap.co.in` | `delivered@resend.dev` | **ACCEPTED, delivered** |
| `noreply@snowkap.com` | `delivered@resend.dev` | **REJECTED - `550 The snowkap.com domain is not verified`** |
| `noreply@snowkap.co.in` | `p13.importer@snowkaptest.dev` | **ACCEPTED (sent)** |

The recipient domain is **not** the cause - even the throwaway address
was accepted from `snowkap.co.in`. `snowkap.com` is rejected at the DATA
stage, and a DATA-stage rejection writes **no log row**, which is exactly
why Resend's log is empty while Supabase reports 500.

**Fix: change Supabase's Sender email to `noreply@snowkap.co.in`.** Host,
port, username and API key are already correct (AUTH succeeded; a test
message was delivered).

**Disclosure:** three real emails were sent as part of this - two to
Resend's documented test sink `delivered@resend.dev`, and one to the
throwaway `@snowkaptest.dev` test account. None went to a person. The API
key was never printed.

**SMTP remains NOT VERIFIED end to end.** No confirmation email has been
delivered to a real inbox and consumed. That still requires the owner.

---

## 57. SMTP root cause: the PORT, not the sender (2026-09-02)

**Correction to §56.2.** That section concluded Supabase's sender address
was on an unverified domain. **It was not.** The dashboard shows
`noreply@snowkap.co.in` — correct, and the only verified Resend domain.
The `snowkap.com` rejection I cited came from a *control* send I issued
myself, not from Supabase's configuration. I generalised from my own
control to the system under test, which was wrong.

### The actual cause

GoTrue connects in **plaintext then issues `STARTTLS`**. Port **465
expects TLS immediately** (implicit TLS), so the handshake hangs and
times out. Supabase never completes a connection, so **nothing reaches
Resend** — precisely why its log is empty while Supabase returns
`HTTP 500 "Error sending recovery email"`.

Measured against `smtp.resend.com` with the configured credentials
(AUTH only, no mail sent):

| Port / handshake | Result |
|---|---|
| 465 implicit TLS | AUTH OK |
| **465 STARTTLS — what GoTrue does** | **FAIL: connection timed out** |
| **587 STARTTLS** | **AUTH OK** |
| 2587 STARTTLS | AUTH OK |

My earlier direct sends succeeded only because Python's `SMTP_SSL`
speaks **implicit** TLS on 465 — the one handshake GoTrue does not use.
That is why my credential test passed while Supabase's send failed, and
why I misread the cause twice.

### Fix

**Set the port to `587`.** Sender, host, username and API key are all
already correct — AUTH succeeds and a test message was delivered.

This runbook's own §3 had recommended 465, following the original
instruction. That recommendation was wrong for GoTrue and is corrected.

**SMTP remains NOT VERIFIED end to end** until a real confirmation email
is delivered to a real inbox and consumed.

---

## 58. CORRECTION: the SMTP test fixture was invalid all along (2026-09-02)

**Every SMTP diagnosis after §56.1 was built on a broken fixture, and two
of them were wrong. Recording that plainly.**

### 58.1 The fixture

All three production test users are on **`snowkaptest.dev`**, and that
domain **does not exist**:

```
snowkaptest.dev   A/AAAA: does not resolve
                  MX:     *** Non-existent domain (NXDOMAIN)
```

(By contrast `snowkap.co.in` resolves with MX `mx1/mx2.emailsrvr.com`.)

A password reset to an address on a non-existent domain **cannot
succeed**, whatever the SMTP configuration is. So `HTTP 500 "Error
sending recovery email"` is fully explained by the recipient alone, and
carries **no information** about whether SMTP is correctly configured.

I used those accounts as the probe for every diagnosis after the initial
one, and then reasoned from the result as though the recipient were
sound. It was not.

### 58.2 What that invalidates

| Claim | Status |
|---|---|
| §51: custom SMTP not configured (429 `over_email_send_rate_limit` at ~2 attempts) | **STANDS** — a rate-limit signature, independent of the recipient |
| §56.2 / §57: SMTP now enabled (429 → 500 after the owner enabled it) | **STANDS** — the change in error class is real evidence |
| §56.2: the *sender domain* was wrong (`snowkap.com`) | **WITHDRAWN** — the dashboard shows `noreply@snowkap.co.in` was already set; the `snowkap.com` rejection came from a control send I issued myself |
| §57: the *port* was the root cause (465 vs 587) | **UNPROVEN** — the port matrix is valid on its own terms (GoTrue uses STARTTLS; 465 implicit TLS fails STARTTLS), so 587 is the correct setting regardless. But it was **not** demonstrated to be the cause of the 500, because the 500 has a sufficient other explanation. |

The port matrix result itself is sound and recipient-independent:

| Port / handshake | Result |
|---|---|
| 465 implicit TLS | AUTH OK |
| 465 STARTTLS (what GoTrue does) | FAIL: timeout |
| 587 STARTTLS | AUTH OK |

So **587 is the right port to keep**. What is not established is that 465
was what was breaking the send.

### 58.3 What can and cannot be determined from here

**Cannot:** whether Supabase→Resend now works. No production account has
a deliverable address, and creating one is a signup — reserved for the
owner by standing instruction. Supabase Auth SMTP settings are not
readable through this session's MCP integration.

**Can, and already established:** the credentials, host, username and
sender are all valid (AUTH succeeds on 587; a test message from
`noreply@snowkap.co.in` was delivered to Resend's test sink), and custom
SMTP is enabled.

### 58.4 The two steps that settle it

1. **Read the actual SMTP error.** Supabase → **Logs → Auth**, search the
   `error_id` from a failed attempt (most recent:
   `01a061fc-2581-711b-a491-fe0f50e4cb22`). That log line names the real
   failure — auth, TLS, or recipient — and ends the guessing.
2. **Sign up with a real address you control** at
   `https://snowkap-cbam-production.up.railway.app/sign-up`. That is both
   the definitive SMTP test and the outstanding real-user gate (§46).

**SMTP remains NOT VERIFIED.** No mail has been delivered to a real inbox
and consumed.

### 58.5 Process note

Three diagnoses, two wrong, all from the same invalid fixture. The error
was not any single inference — it was continuing to reason from a probe I
had never validated. The domain check that settled it costs one DNS
lookup and should have been the *first* thing I did when a send failed,
not the fourth.

---

## 59. Real-user SMTP test — owner attempt FAILED, recipient ruled out (2026-09-02)

Configuration was **not** changed for this round (host `smtp.resend.com`,
port `587`, username `resend`, sender `noreply@snowkap.co.in` — all left
as the owner set them).

### 59.1 What happened

The owner attempted a real signup at
`https://snowkap-cbam-production.up.railway.app/sign-up` with a
brand-new address on a valid domain. The UI returned **"Something went
wrong creating your account. Please try again."**

### 59.2 Observed, not inferred

| Channel | Result |
|---|---|
| `auth.users` | **3 rows — unchanged from baseline.** No user was created; GoTrue rolls back when the confirmation email fails. |
| organizations / memberships | 2 / 2 — unchanged |
| Resend send log | **No new entry.** Latest is still `11:51:49`, which is this session's own SMTP test. |
| `/auth/v1/signup` direct (same endpoint the form uses, error unmasked) | **HTTP 500 `unexpected_failure` — "Error sending confirmation email"**, `error_id 01a06202-c6e2-74f3-a72d-dc4ea658f2e4` |

### 59.3 The recipient explanation is now ELIMINATED

§58 correctly withdrew earlier diagnoses because the `snowkaptest.dev`
fixture was NXDOMAIN. That objection no longer applies:

- The owner used a **real address on a valid domain**.
- My unmasked probe used **`delivered@resend.dev`** — an address this
  session had already **successfully delivered to** over the same SMTP
  service (Resend log, `11:51:44`, `event=delivered`).

Both fail identically. **The recipient is not the variable.**

### 59.4 What is established

- A **working credential exists**: the key in `.env` authenticates
  against `smtp.resend.com:587` over STARTTLS, verified again at the time
  of this failure.
- The sender `noreply@snowkap.co.in` is on the only verified Resend
  domain, and a message from it was delivered earlier.
- **Nothing reaches Resend** from Supabase — no send, no bounce, no
  rejection is recorded. The failure occurs before Resend sees anything.
- No account is created on failure, so there is nothing to clean up and
  no partial state.

### 59.5 What is NOT established, and deliberately not guessed

Why Supabase's own SMTP connection fails. Three candidate causes remain
(stored credential differing from the working one, TLS negotiation, or
network egress), and **this report does not choose between them**, in
line with the standing instruction not to make further speculative SMTP
diagnoses.

**The next fact must come from the Supabase Auth log.** This session's
MCP integration returns *"You do not have permission to perform this
action"* for every project-level log read, so it cannot be retrieved
here.

**Required:** Supabase → **Logs → Auth**, search
`01a06202-c6e2-74f3-a72d-dc4ea658f2e4`. That entry names the actual SMTP
error.

### 59.6 Status

**SMTP: FAIL — NOT VERIFIED.** No confirmation email and no
password-reset email has been delivered or consumed. The real-user gate
(§46) remains open and cannot be completed until sending works.

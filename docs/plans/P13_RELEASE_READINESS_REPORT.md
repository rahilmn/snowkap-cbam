# SNOWKAP CBAM — FINAL P13 RELEASE READINESS REPORT

**Date**: 2026-08-29
**Repository**: https://github.com/rahilmn/snowkap-cbam
**Branch**: `feature/full-product-build`
**HEAD at time of writing**: `28bc578` (subject to a small number of additional
commits landing after this report's own final security/regulatory audit
results are incorporated — see the addendum at the very end of this document
if one exists)

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

This session (a continuation of prior P7–P13 work) found and fixed **eleven
additional confirmed defects** — one in the protected regulatory resolver,
one authorization gap, one concurrency race, one integrity-crash bug, six
accessibility/UX gaps, and one misleading error message — each via
reproduce-first, TDD-disciplined fixes with regression coverage, independently
re-verified. It also ran a full documentation-completeness audit and closed
the highest-value gaps found (stale counts, two outright false claims, a
missing migration log).

**The Railway production deployment at
`https://snowkap-cbam-production.up.railway.app` is currently NOT reachable
— it returns a persistent `502 Bad Gateway` / "Application failed to
respond"** on every path checked, confirmed across multiple checks spanning
a significant time window with substantial other work done in between (not
a transient blip). This session has no Railway CLI, API token, dashboard, or
MCP connector — it cannot view deploy logs, build status, or environment
variable configuration, and cannot diagnose the root cause beyond what the
public edge response itself shows. **This is the primary blocker.**

A second, non-blocking-but-material item requires **owner input, not code**:
a real, evidence-backed contradiction between the documented regulatory
country-fallback rule (R7/R9) and the resolver's current, deliberate
behavior — see §11 for the full analysis and recommendation.

**Final classification: RELEASE BLOCKED.** See §37 for the exact, complete
list of blockers. This is not a disguised "minor limitations" framing —
Railway is genuinely down and cannot be independently fixed from this
session, and one regulatory interpretation question genuinely needs a human
with authority over the primary source.

---

## 2. Exact Git HEAD

```
28bc578 docs(deployment): record today's fresh, independent Docker build re-verification
```

Full HEAD SHA: `28bc578...` (short form as shown; see `git rev-parse HEAD`
in the repository for the full 40-character hash at any time).

## 3. Branch / remote state

- Active branch: `feature/full-product-build`
- Working tree: **clean** (`git status` — nothing to commit)
- Remote sync: **45 commits ahead of `origin/feature/full-product-build`**,
  not yet pushed (no push was requested or authorized this session)
- `git diff --check`: clean (no whitespace errors)
- No secrets, generated artifacts, or debug files found in tracked output
  (re-ran the same secret-scan pattern `.github/workflows/ci.yml` uses,
  independently, against the full working tree: zero matches beyond the two
  already-allow-listed, genuinely non-secret local-dev markers)
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

**Fully implemented (21 of 35 master-plan §27 screens)**: sign in/up (not
reset), onboarding, accept invitation, org switcher, System/status, 404/500
error pages (no 403), shipments list/create/detail, line editor,
classification, emissions (importer), suppliers, "Why this number?" panel,
audit history, reports, declaration preparation, org settings, team,
installations, emission data entry, evidence, verification actions,
sharing, shared-data status.

**Explicitly, honestly not built** (matches README's own disclosure): CSV/XLSX
shipment import, a standalone resolution explorer/batch-resolve UI, real
importer/producer dashboards (post-sign-in landing is still a Phase-2
placeholder — every other screen is reachable via the sidebar), password
reset, a user-profile screen, a 403 error page, an importer-side
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

Verified this session: signed into the same dual-capability test
organization, confirmed the producer-side navigation (Installations,
Production data, Emissions, Evidence, Verification, Sharing, Activity) is
present and correctly capability-gated, confirmed the Installations screen's
empty state and operator/installation registration form render correctly.

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

## 11. Provenance / R7-R9 regulatory contradiction — OWNER DECISION NEEDED

This is the material, non-Railway item requiring your input before it can
be resolved. Full analysis, not a placeholder:

**The contradiction.** `docs/architecture/REGULATORY_RESOLUTION_RULES.md`'s
R7 clause 2 states: *"If the country or territory is explicitly listed but
the relevant field has no value or contains '–', use the corresponding
value from Other countries and territories."* R9 restates this: *"If the
applicable country-specific row is unavailable, the resolver attempts the
regulatory country fallback under Rule R7."* The resolver's actual,
deliberate code (`resolve-default-value.ts`, lines ~730-743) does the
opposite: *"If an exact record exists for the requested country, its result
is authoritative. This prevents fallback from bypassing explicit regulatory
statuses such as REFERENCE_REQUIRED, UNAVAILABLE, NOT_APPLICABLE, and
AMBIGUOUS."* This is pinned by a passing test
(`resolve-default-value.test.ts:276`) — the code's current behavior is
intentional, not an oversight, but it contradicts the documented rule as
literally written.

**What I found investigating further (this session).** I traced exactly
which raw source-data conditions map to which resolver status
(`scripts/regulatory/parse-definitive-default-values.py:178-228`):

- An empty cell, or a literal `-`/`–`/`_` → **`UNAVAILABLE`**
- `N/A` (and its variants) → **`NOT_APPLICABLE`**
- The literal text `"see below"` → **`REFERENCE_REQUIRED`**

R7 clause 2's own wording — "no value... or contains '–'" — maps precisely
and *only* onto the `UNAVAILABLE` case. It does not obviously describe
`NOT_APPLICABLE` (an explicit declaration that the field doesn't apply to
this good, not a missing value) or `REFERENCE_REQUIRED` (an explicit pointer
to a more specific record elsewhere, R8's own domain — falling back to
"Other Countries" here would skip past the *correct* more-specific record
entirely, a different and clearly wrong substitution).

**External verification attempted.** I searched for and found two
independent web summaries drawing on EUR-Lex (Commission Implementing
Regulation (EU) 2025/2621, Annex I) that state the same fallback rule in
phrasing close to this repo's own R7 clause 2, specifically scoped to a
blank/dash field. I could not fetch and personally read the verbatim primary
legal text directly (the EUR-Lex HTML page exceeded my fetch tool's size
limit; the official Commission PDF annex returned HTTP 403). This is
corroborating, not first-hand, evidence.

**My recommendation** (not implemented — this is a recommendation for your
sign-off, per your own explicit instruction not to silently change resolver
behavior): the resolver is very likely **under-resolving specifically for
`UNAVAILABLE`** (a genuinely blank/dash field for an otherwise-listed
country) — R7 clause 2's fallback should apply there. It is very likely
**correctly conservative for `NOT_APPLICABLE`** (falling back would invent a
number for a field the source data explicitly says doesn't apply) and for
`REFERENCE_REQUIRED` (falling back would skip the correct, more-specific
record R8 should be finding instead — a separate, already-known
incompleteness, not something the R7 fallback should paper over). If you
confirm this reading against the primary source, the fix is narrow: scope
the "authoritative, never bypass" guard specifically to `NOT_APPLICABLE`/
`REFERENCE_REQUIRED`/`AMBIGUOUS`, and let `UNAVAILABLE` fall through to the
Other-Countries-and-Territories attempt already implemented for the
zero-records case. **Not implemented in this session** — this is exactly
the "material regulatory behavior change" CLAUDE.md requires escalation
for, and my evidence, while consistent and multiply-corroborated, is not a
first-hand primary-source read.

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
adversarial-audit round. New in this session: `updateOrganizationProfile`
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
DB services up throughout this session). No new tenancy defect was found in
this session's own direct work; the final security-audit workflow (§15)
independently re-checked this dimension with live psql probes.

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
session (12 dimensions, 3-skeptic adversarial verification per finding —
see §16 for the complete, final results).

## 16. Final adversarial security + regulatory audit

[SECTION PENDING — the 12-dimension, adversarially-verified Opus workflow
(security: auth/session, authz/capability-matrix, RLS/tenant-isolation,
IDOR/org-ownership, invitations/sharing, storage/evidence,
audit/concurrency-CAS, secrets/rate-limiting/deps/logging/prod-config;
regulatory: dataset-integrity/provenance, fallback/unresolved-states,
precision/determinism/reproduction, default-vs-actual/EU-scope/fabrication)
was still completing at the time this section was drafted. This section
will be filled in with its final confirmed/refuted findings before this
report is considered final — see the addendum, or the version of this file
at HEAD if this placeholder is still present, for its actual status.]

## 17. Concurrency controls

CAS guards (`.eq()` predicates matching the pre-fetched state, rejecting
`CONCURRENT_MODIFICATION` on zero rows affected) are now present across
every state-transitioning write path this session and the immediately
preceding review checked: `mark-declaration-ready.ts`,
`generate-or-refresh-declaration-draft.ts`, `resolve-line-emissions.ts`
(pre-existing), and `manage-emission-data.ts`'s `applyTransition` (fixed
this session, §15 item 2). The final audit workflow (§16) was specifically
asked to check every other write path in the codebase for the same gap.

## 18. Upload / storage controls

Evidence upload (`app/api/evidence/upload/route.ts`) enforces MIME/extension
allowlisting, size caps, org-scoped storage paths (with a database-level
CHECK constraint pinning `storage_path` to the row's own `org_id`, closing a
live-reproduced forgery gap in an earlier review round), and signed,
short-lived download URLs. **Cannot be verified against a real Storage
backend locally** — Supabase Storage does not run on this Windows host
(reproduced three separate times across this overall effort, most recently
this session's predecessor turns); `storage.objects` RLS is shim-verified
only. Real Storage-backed verification needs a working Railway/staging
deployment — currently blocked (§28).

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

**Verified byte-for-byte this session.** Fetched
`https://snowkaplive.b-cdn.net/wp-content/uploads/2025/07/Snowkap_Logo.svg`
directly (content-type `image/svg+xml`, 6,037 bytes) and compared against
`public/brand/snowkap-wordmark.svg`: **identical**, byte for byte — same
length, same content from the first 500 characters checked onward. This is
the exact, unmodified, official asset, not a redraw or approximation.
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

`pnpm typecheck`: **clean**, zero errors, at HEAD `28bc578`.

`pnpm test`: **970 passed / 14 skipped / 984 total**, confirmed via multiple
isolated, contention-free runs at HEAD `28bc578`. Note: this session's own
final adversarial audit workflow ran heavy, deliberately concurrent live
`psql` probes against the same local Postgres instance to reproduce RLS
findings directly — full-suite runs made *while that workflow was active*
occasionally showed one specific integration test
(`organizations-isolation.test.ts`'s CAS-guard test) timing out at its
default 5-second limit under that contention. Re-run in isolation, every
time, it passed cleanly (17/17 in that file). This is a real, reproducible,
understood environmental characteristic of concurrent heavy local-Postgres
load, not a product defect — recorded honestly rather than silently
retried until it happened to pass.

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
this overall effort against real local Supabase. Not re-run in this exact
session (time-scoped decision; the manual browser pass in §6/§7 covers
overlapping ground with fresh, live evidence instead). **CI caveat, found by
this session's documentation audit and not yet fixed**: `ci.yml` stops local
Supabase *before* running the Playwright suite, and the E2E specs neither
skip nor tolerate its absence — meaning these three journey specs are
currently locally-verified only, never actually green in CI. Named as a
known limitation (§35), not fixed in this session.

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

## 29. Railway deployment status — BLOCKED, confirmed down

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
was identical every time. This session has **no Railway CLI installed, no
`RAILWAY_TOKEN`, no MCP connector, and no dashboard access** — there is no
technical path from here to view actual deploy/build logs, environment
variable configuration, or deployment history. This is the practical limit
of what could be diagnosed from the public edge response alone.

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

## 30. Deployed commit SHA

**Unobservable.** `/api/health` never returned a response body (502, no
JSON) on any check this session. Cannot compare against local HEAD (`28bc578`)
or `origin/feature/full-product-build`.

## 31. Railway `/api/health` result

**FAILED.** `502 Bad Gateway`, "Application failed to respond." See §29.

## 32. Database / runtime result (Railway)

**Unobservable** — see §29. (Local Docker's own `/api/health` result, a
distinct and separately-labeled check, is in §28 and DID succeed.)

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

- Railway production deployment is down (502) — §29, the primary blocker.
- R7/R9 regulatory fallback contradiction — §11, owner decision needed.
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
- No reusable data-table component; command palette is a disabled stub;
  zero site-wide `aria-live` beyond this session's one addition; no
  automated accessibility scan (§21).
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
  `AUTHORIZATION_MATRIX.md`; `CALCULATION_RULE_REGISTER.md` cites one
  fixture that doesn't exist.
- CSV/XLSX shipment import, a resolution explorer, real dashboards,
  password reset, a user-profile screen, a 403 page, an importer-side
  installations view, and a dedicated calculations route are all
  explicitly not built (§5) — disclosed, not hidden.

## 36. Railway-dependent items

Every item in §29–§32, §34, and the "Staging"/"Production" rows of §33 are
Railway-dependent and currently blocked. Nothing in this report claims
Railway/staging/production verification that did not actually happen.

## 37. Final production-readiness decision

# RELEASE BLOCKED

**Exact blockers, not disguised as minor limitations:**

1. **The Railway production deployment is down** (`502 Bad Gateway` /
   "Application failed to respond", confirmed repeatedly, every path). This
   alone makes every Railway-dependent item in §30–§32, §34, and the
   production halves of §33/§26 impossible to complete from this session.
   Requires the owner (or someone with Railway dashboard/CLI access) to
   check deploy logs and fix the underlying container startup failure —
   most likely a missing/misconfigured runtime environment variable or a
   port-binding mismatch (see §29's diagnostic notes).
2. **The R7/R9 regulatory fallback contradiction is unresolved** (§11) —
   a genuine, well-evidenced but not first-hand-primary-source-confirmed
   question about correct CBAM default-value fallback behavior for a
   specifically-`UNAVAILABLE` (blank/dash) field on an otherwise-listed
   country. Not blocking in the same way as §1 (the current, conservative
   resolver behavior is defensible and does not fabricate values), but a
   real open regulatory-correctness question that should be resolved with
   authority before this platform's numbers are relied on for actual CBAM
   declarations in a jurisdiction where this specific scenario can occur.

Everything else this report covers — the calculation engine, explainability,
tenancy/RLS, the eleven fixes landed this session, the local Docker build,
the documentation audit, backup/restore (locally), the full local browser
verification of both journeys — has real, direct evidence behind it and is
**not** a blocker to a Railway-independent go-live decision. Once Railway is
healthy and the R7/R9 question is resolved, re-run §29–§34's checks against
a live deployment and this classification should be revisited from
first principles, not assumed to flip automatically.

---

*This report was written by an autonomous coding session per explicit,
detailed instructions to continue without stopping for routine approval.
Every fix claimed above has a corresponding commit in `git log`; every test
count and verification result was independently re-run and confirmed, not
carried forward from an earlier claim without re-checking. Section 16 (the
final adversarial security/regulatory audit) may still show a PENDING
placeholder — check for an addendum below, or the live file at HEAD, before
treating this report as fully final.*

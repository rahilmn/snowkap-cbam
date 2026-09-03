# P14 release-triage bundle — adversarial review of the release candidate

**ADVERSARIAL REVIEW BY IMPLEMENTATION SESSION — NOT INDEPENDENT.**

Run by the session that wrote the code, the migrations, the tests and the
release audit, using fresh sub-agents with no memory of that reasoning.
ADR-0013 assigns this review to a different model. That premise was not
met. A genuinely independent pass remains outstanding, and nothing here
substitutes for it. (The companion file
`P14_INDEPENDENT_ADVERSARIAL_REVIEW.md` carries a misleading name for the
same reason; its own §0 says so.)

Produced under an emergency stop. Verification was terminated
deliberately, not drained. Missing verifier output is reported as
UNPROVEN and never as PASS.

---

## 1. Candidate

`cad99adb7c4f2a170bc7e35dd3eab4dd51c96df3` on `phase14/release-hardening`.
Frozen before the review, unmodified by it.

## 2. Attack dimensions completed

13 boundaries launched; **20 attack reports returned** (some boundaries
produced more than one after retry): privilege/role model, RLS and
tenancy, calculation integrity, regulatory semantics and Annex II,
declarations and filing, sharing / evidence / verification, storage and
evidence files, auth and session, rate limiting, audit honesty, CI and
gate integrity, build artifact and secret hygiene, operations and
recovery.

All 20 reports are preserved in the workflow journal (`wf_be251662-c64`)
and normalised into `docs/plans/P14_INDEPENDENT_ADVERSARIAL_FINDINGS.json`.

## 3. Attack dimensions incomplete

No boundary returned zero reports. What is incomplete is **depth**, and
it is concentrated in four places — see §9. In short: no HTTP layer, no
real Storage, no real GoTrue, no regulatory ground truth.

## 4. Unique confirmed findings

Raw rows: **191**. Title-signature deduplication collapsed **0** of them —
different boundaries describe the same defect in materially different
words — so 191 is not a defect count.

Reviewer-performed collapse:

| tier | rows | materially distinct |
|---|---|---|
| Agent-labelled BLOCKER | 40 | **21** |
| Agent-labelled HIGH | 58 | ~45 (themed, not individually collapsed under the stop order) |
| MEDIUM / LOW | 93 | not collapsed |

**Reviewer-confirmed — reproduced by this session's own psql/CLI probes
against the frozen candidate or the clean sandbox: 7 distinct defects** —
4 blockers (§5) and 3 high (§6).

The agent-claimed severity distribution (40 BLOCKER / 58 HIGH / 63
MEDIUM / 30 LOW) is **inflated by construction**: agents were instructed
to assume a defect exists until the boundary proved otherwise. Do not
quote it as a blocker count.

## 5. Confirmed RELEASE BLOCKERS — 4

### B1 — `emission_data` has no INSERT-time gate

**Description.** Both integrity gates are `BEFORE UPDATE` triggers
(`emission_data_activation_gate_trg`, `emission_data_verification_gate_trg`).
The INSERT policy checks organisation membership and installation
ownership and nothing else — not `status`, not `verification_status`, not
`verifier_user_id`, not `evidence_file_ids`.

**Exploit.** One `INSERT` as a plain MEMBER, with `status='ACTIVE'`,
`verification_status='VERIFIED'`, `verifier_user_id` = self, and an
`evidence_file_ids` UUID naming no `evidence_files` row.

**Evidence.** Reproduced twice by this session — once on the working
database, once on the freshly rebuilt sandbox — with a purpose-created
MEMBER (`is_admin_or_owner = false`):

```
ADMITTED: ACTIVE/VERIFIED  verifier=<self>  evidence=1  direct=0.000001
```

**Boundary.** Intra-tenant MEMBER/ADMIN verification authority — and then
cross-tenant, because `emission_data_select_own_org` admits shared rows
on exactly `status='ACTIVE' AND verification_status='VERIFIED'`.

**Impact.** A grantee importer reads the forged row as operator-attested
verified data and can freeze it as an ACTUAL determination. This defeats
the verification model the entire producer/importer trust boundary rests
on.

**Why controls fail.** Every wall — ADMIN+-only verification, DRAFT→ACTIVE
requiring VERIFIED plus evidence, evidence ids having to resolve — sits
on the UPDATE side. A single `POST /rest/v1/emission_data` walks past all
three.

### B2 — the evidence invariant is bypassed by `ACTIVE → DISCARDED → DRAFT`

**Description.** `20260903150000` blocks `old.status='ACTIVE' AND
new.status='DRAFT'`. It does not block the route through `DISCARDED` (or
`SUPERSEDED`).

**Exploit.** Four statements: `ACTIVE→DISCARDED`, `DISCARDED→DRAFT`,
un-verify, strip evidence.

**Evidence.** Reproduced by this session, control first:

```
control: update ... set evidence_file_ids='{}'
  -> ERROR: evidence cannot be removed from an ACTIVE, VERIFIED record

before: status=ACTIVE  verification=VERIFIED  evidence=1
  ACTIVE -> DISCARDED   UPDATE 1
  DISCARDED -> DRAFT    UPDATE 1
  un-verify             UPDATE 1
  strip evidence        UPDATE 1
after:  status=DRAFT    verification=VERIFICATION_PENDING  evidence=0
```

**Boundary.** Producer→importer data integrity; MEMBER-reachable, no
ADMIN needed.

**Impact.** `20260829560000`'s delete-lock keys on
`verification_status <> 'VERIFIED'`, so un-verifying also unlocks deletion
of the underlying file rows. An ADMIN can then restore the record to
ACTIVE+VERIFIED carrying **different evidence under the same id and
version** — precisely the state the v10 validator compares byte-for-byte
against an importer's frozen determination.

**Why controls fail.** The P14.1 fix closed the one- and two-statement
variants and keyed on `old.status` alone.

### B3 — the `build-and-test` secret scan is inert and fails open

**Description.** `.github/workflows/ci.yml:602` uses
`$KNOWN_SAFE_PROCESS_ENV_ASSIGNMENT`, which is never defined. Under
`set -euo pipefail` the unbound variable kills the command substitution,
`|| true` absorbs it, `MATCHES` is unconditionally empty, and the success
string always prints.

**Evidence.** `grep -n KNOWN_SAFE .github/workflows/ci.yml` returns only
`KNOWN_SAFE_LOCAL_DEMO_JWT` (:562), `KNOWN_SAFE_LOCAL_PG_URL` (:570) and
the three uses at :600–602. In the certification run this project reported
as green:

```
run 33742947242, build-and-test
  line 1909: KNOWN_SAFE_PROCESS_ENV_ASSIGNMENT: unbound variable
  line 1911: No secret-shaped literals found in tracked files.
```

**Boundary.** Committed-credential gate on every branch push and PR.

**Impact.** The release audit quotes line 1911 as passing evidence and
asserts three times that the filter was "verified in both directions". No
such verification was possible. The surviving `fast-gates` scan does not
carry the `SUPABASE_*=` or `postgres://` patterns, so **no job catches a
committed database password.**

**Why controls fail.** A patch script asserted on two replacements; the
second raised before `write()`, so the definition never landed, and a
later script added the reference without re-reading the file. CI's own
error line sat in a log that was grepped only for success strings.

### B4 — the candidate cannot pass its own CI

**Description.** The `fast-gates` scan (`ci.yml:109-117`) matches
`eyJ[A-Za-z0-9_-]{20,}` and filters exactly one known-safe literal.

**Evidence.** Reproduced verbatim against the frozen tree:

```
$ git grep -InE "$PATTERN" cad99ad -- . ':!pnpm-lock.yaml' ':!.github/workflows/ci.yml' \
    | grep -vF 'eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6'
docs/plans/P14_ADVERSARIAL_REVIEW_FINDINGS.json:1063
docs/plans/P14_ADVERSARIAL_REVIEW_FINDINGS.json:1074
docs/plans/P14_ADVERSARIAL_REVIEW_FINDINGS.json:1080
docs/plans/P14_ADVERSARIAL_REVIEW_FINDINGS.json:1086
>>> SCAN WOULD FAIL (exit 1)
```

The matched literal is
`eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdefghijklmnop` — a **fabricated**
JWT an agent wrote to demonstrate B3, not a real credential. That changes
the remediation (reword, or extend the filter), not the outcome.

**Boundary.** Release-certification gate for this exact SHA.

**Impact.** `cad99ad` is not shippable on its own terms, independent of
every other finding. It was introduced, self-referentially, by the commit
that recorded the previous review's findings.

## 6. Confirmed HIGH — 3

### H1 — `seed.sql`'s blanket grants undo the migrations' revokes

`grant all on all functions` re-grants EXECUTE that migrations
deliberately revoked; only one of eight revokes is re-asserted. Verified:
**7 SECURITY DEFINER functions in `public` return true for
`has_function_privilege('anon', …, 'EXECUTE')`** in a freshly built
environment. Each guards itself internally on `auth.uid()`, so this is not
presently exploitable — but the audit's claim that `seed.sql` "states the
final intended posture" is false, the re-assertion list is
hand-maintained with no test behind it, and this is the same mechanism
that silently reopened the P14.1 revokes once already (caught by CI).

**General rule this establishes:** any blanket grant that runs after a
narrow revoke undoes it — restore, seed and bootstrap alike. A dump
records grants but never their absence.

### H2 — the release audit's measured ACL claim is wrong

The audit records the `postgres` default ACL as `anon=rxtm` (read-only).
Verified live it is **`anon=arwdxtm`** — only `D` (TRUNCATE) was removed —
and a newly created public table grants `anon` INSERT, UPDATE, DELETE.

### H3 — `pnpm test:e2e` falls back to the hosted project with no guard

**Description.** `playwright.config.ts` resolves env by parsing
`.env.local` first and `.env` as fallback, then passes the result into
`webServer.env`.

**Evidence.** On this machine `.env.local` sets
`SUPABASE_URL=http://127.0.0.1:54321`, so the suite runs against local
Supabase — **the agent's BLOCKER-level claim that it runs against
production is DISPROVED as stated** (§8). But `.env` exists, is
`.gitignore`d, and sets `SUPABASE_URL=https://<hosted project>`. Nothing
in the config, the specs or any setup step asserts that the resolved
target is local.

**Impact.** A developer or runner without `.env.local` — or with one that
omits `SUPABASE_URL` — runs the full **mutating** Playwright suite, which
creates users, organisations and shipments and files declarations,
against the hosted production project, with the production service-role
key and `DANGEROUSLY_DISABLE_RATE_LIMITS_FOR_E2E_TESTS=true`.

**Why controls fail.** The fallback is the documented, intended
precedence. The failure mode is the *absence* of a target assertion, so
nothing fails loudly.

## 7. MEDIUM / LOW

93 rows (63 MEDIUM, 30 LOW), agent-reported, not collapsed and not
individually verified. Per the stop order, no further budget was spent on
them; they are preserved in full in the findings JSON. Reviewer
judgement: this tier is where duplication is heaviest and where the
assume-a-bug posture inflates most.

## 8. Disproved findings

- **"The build artifact contains the production service-role key,
  database password and Resend API key."** True of the *local developer*
  artifact (`.next/standalone/.env`). **Does not reach the production
  image**: `.dockerignore` excludes `.env` and `.env.*`, `.env` is
  untracked, and the Dockerfile runs `pnpm build` inside the image from a
  context without it. Reduced to MEDIUM, local hygiene.
- **"`pnpm test:e2e` runs against the PRODUCTION Supabase project."**
  Disproved as stated for the current configuration (§H3). The latent
  fallback is retained as a confirmed HIGH.

Only these two were disproved with positive evidence. The verification
fan-out that would have disproved more was stopped.

## 9. Unproven — environment and API failures

**Environment ceilings (each applies to a whole class of finding):**

1. **No HTTP layer.** No PostgREST or Next.js instance was bound to the
   sandbox. Every RLS probe ran as `set local role authenticated` plus
   forged `request.jwt.claims` in psql. That evaluates the same policies
   PostgREST evaluates, but **no finding was proven HTTP-reachable**, and
   JWT issuance and signature handling were never tested.
2. **Storage is a shim with zero policies.** `select count(*) from
   pg_policy where polrelid='storage.objects'::regclass` → **0**. Every
   storage finding — evidence-object DELETE without a verification gate,
   TRUNCATE on `storage.objects`, bucket size and MIME enforcement — is
   **UNPROVEN**.
3. **Hosted GoTrue never exercised.** The `auth.users` shim has 9
   columns, no unique index on email, and no sessions or refresh-token
   tables. Every auth finding — invitee account takeover, `/auth/callback`
   fragment session adoption, password change without re-authentication,
   invitation `expires_at` control — is **UNPROVEN live**.
4. **No regulatory ground truth.** No network access. Whether Annex II of
   Regulation (EU) 2023/956 lists CN 2601 12 00 or CN 2804 10 00 could
   not be established, so the Annex II findings prove **internal
   inconsistency** against the ACTIVE dataset, not regulatory error.

**Also not run:** `pnpm regulatory:verify` (needs `SUPABASE_DB_PASSWORD`
and a Python environment, and targets a hosted project — stated, not
skipped silently), `pnpm test`, `pnpm typecheck`, any `docker build`, any
GitHub Actions run, any concurrency or race test, Railway
`X-Forwarded-For` hop depth, replica count, and branch-protection
settings.

**Verification-layer failure and termination:**

| | |
|---|---|
| Verification agents started | 330 |
| Lost to transient API 529/500 | **194** |
| Verdicts completed | ~126 |
| In flight at emergency stop | ~10 |

Most findings therefore carry **no completed verification verdict**. That
is recorded as UNPROVEN, not as PASS. The fan-out was not drained; it was
terminated on instruction.

**Cancellation caveat, stated plainly:** `TaskStop` does not resolve the
workflow's task id from this session, so the orchestration could not be
cancelled programmatically. This session stopped its own polling and
created no new agents; residual in-flight agents terminate on their own.
The run can be stopped from `/tasks`.

## 10. Duplicate findings collapsed

Automated title-signature dedup collapsed **0 of 191**. Reviewer collapse
of the BLOCKER tier: **40 rows → 21 distinct defects**. Largest clusters:

- `emission_data` ungated INSERT — **6 rows**
- evidence/verification bypass via a terminal-status detour — **4 rows**
- CI secret scan inert — **3 rows**
- Annex II sector-proxy divergence — **3 rows**
- declaration membership drift after READY — **3 rows**
- unit magnitude prefixes — **2 rows**
- posture comparator false MATCH — **2 rows**
- rollback breaks calculation writes — **2 rows**

HIGH and MEDIUM/LOW were not collapsed; the stop order took priority.

## 11. End-to-end exploit chains

Four composite chains were reported, three with live rolled-back sandbox
transactions. **All are AGENT_REPORTED — but the linchpin of C1 and C2
(B1) was confirmed by this session directly.**

- **C1 (BLOCKER)** — a MEMBER files 0 tCO2e for 1,000 t of Chinese steel. §12.
- **C2 (BLOCKER, cross-tenant)** — a producer MEMBER displaces the verified
  record. §13.
- **C3 (HIGH)** — a MEMBER edits a READY shipment's reporting period; the
  same shipment and the *same* `calculation_results` row are frozen into
  **two immutable FILED declarations** for two different periods, neither
  of which is the release period. Both `record_declaration_filed` calls
  returned OK. The RPC accepts `s.status in ('READY','LOCKED')`
  unconditionally, never consults `supersedes_declaration_id`, and never
  asks whether another FILED_RECORDED declaration already lists the
  shipment.
- **C5 (HIGH)** — the release's own acceptance gate cannot see the P14.1
  fix being reverted. §18.

## 12. Demonstrated false regulatory filing — YES

**C1 reached `FILED` and returned OK.** Reproduced in a single
rolled-back transaction against `p14_review_sandbox`
(`scratchpad/chain3.sql`), post-rollback leakage verified 0:

1. A MEMBER creates an `IMPORTER_ENTERED` operator and installation for
   their own org — `enforce_record_provenance_capability` only checks that
   the org holds `IMPORTER_DECLARANT`.
2. One `INSERT` into `emission_data`: `ACTIVE` / `VERIFIED`,
   `verifier_user_id` = self, `direct_specific='0'`,
   `indirect_specific='0'`, `cn_scope='{7}'`,
   `evidence_file_ids='{99999999-…-9999}'`. Confirmed: `select count(*)
   from evidence_files where id='99999999-…'` → **0**.
3. PATCH the line's `emission_determination` with an ACTUAL snapshot
   naming that record.
   `app.emission_determination_matches_regulatory_record` **accepts** it —
   its evidence test is
   `coalesce(array_length(evidence_file_ids,1),0) = 0` plus set-equality
   against the snapshot. It never asks whether the ids resolve.
4. The trusted channel does the rest: the engine returns
   `1000 × (0 + 0) = 0`, and `record_calculation_result` (service_role)
   persists it — `result_status OK`, `engine_version 1.3.0`.
5. `record_declaration_filed(...)` → **OK**.

**Result: an immutable filed CBAM declaration reporting 0 tCO2e against
~3,187 tCO2e, produced by the lowest-privileged role in the organisation
and signed off by an honest administrator.** The audit trail is complete
and internally consistent; `reproduceCalculationResult` recomputes from
the row's own frozen inputs and returns `REPRODUCIBLE`. The same INSERT
sets any figure the attacker likes, in either direction.

A second, independent false-filing path was reported by the RLS boundary:
1.000 tCO2e for 1,000 t of CN 7206 90 00 from India against an ACTIVE
dataset default of 2.640 t/t — a 99.96% under-report with a filing
reference.

## 13. Cross-tenant exploit — YES

**C2**, live in one rolled-back sandbox transaction
(`scratchpad/chainB3.sql`). A producer-org **MEMBER**:

1. `UPDATE ... set status='DISCARDED'` on the genuine ACTIVE+VERIFIED
   record. Permitted: `emission_data_update_own_org` requires only org
   membership, and the un-verify and DRAFT guards are keyed on
   `new.status='DRAFT'` — DISCARD is explicitly unaffected.
2. `INSERT` a `version=2` replacement with `predecessor_id` naming the
   genuine record, `ACTIVE`/`VERIFIED`, `verifier_user_id` = **the
   producer ADMIN's uuid**, reusing the genuine record's real evidence
   file id, `cn_scope` broadened to `'{7}'`.
3. The one-ACTIVE-per-installation-period unique index is now satisfied by
   the forgery, so the grantee's `emission_data_select_own_org` returns
   exactly one row: the forgery.

```
importer saw BEFORE: 3.100 direct / 0.500 indirect | VERIFIED | ACTIVE | evidence 1
importer sees AFTER: 0.050 direct / 0.000 indirect | VERIFIED | ACTIVE | verifier = the ADMIN
```

3.600 t/t replaced by 0.050 — a **98.6% reduction** — attributed to the
producer's own administrator, chaining directly into C1's filing path. A
producer under-reports to its customer's regulator, with the customer as
the unwitting filer.

Also cross-tenant: a **denial of service** — a global unique index on
`emission_data.predecessor_id` lets any org that learns a producer's
record id squat it and permanently block that producer from correcting a
verified record.

## 14. Authentication / account-takeover paths — reported, all UNPROVEN live

No auth service was reachable (§9.3). Reported, not exercised:

- An ADMIN can mint a **never-expiring ADMIN invitation** to an outside
  address (`expires_at` is client-controllable on INSERT), and offboarding
  that ADMIN does not revoke it — a persistent backdoor admitting an
  identity that was never a member.
- `/auth/callback` adopts any access/refresh-token pair from the URL
  fragment on GET, with no click and no identity-switch confirmation.
- A pending invitee's account can be taken over by anyone who knows the
  invited address.
- The invitation UPDATE policy checks only the new `status`, so an ADMIN
  can rewrite every other column of any invitation.
- `/reset-password` accepts any live session with no re-authentication.

## 15. Calculation integrity failures

- **Inputs are not all frozen.** `good_sector` is derived at calculation
  time from mutable `cn_code` and never re-checked at filing;
  `shipments.release_date` is member-mutable and steers the Annex II
  direct-only treatment.
- **Unit handling.** Magnitude-prefixed denominators (`tCO2e/kilotonne`,
  `tCO2e/megatonne`, `TCO2E_PER_MEGATONNE`, `tCO2e/kMWh`) are accepted at
  1:1, producing 1,000× and 1,000,000× errors.
  `emission_data.emission_unit` is unconstrained free text.
- **Annex II proxy.** A hardcoded set in application code, not a versioned
  dataset. DEFAULT and ACTUAL paths file numbers 47–50% apart for the same
  good (CN 2601 12 00); hydrogen (CN 2804 10 00) is omitted; the lookup
  fails open three ways. **Internal inconsistency is proven against the
  ACTIVE dataset; regulatory error is UNPROVEN** (§9.4).
- **Filing accepts superseded engine versions** the current build cannot
  reproduce.
- The **reproducibility check cannot detect any of this** — it recomputes
  from the row's own frozen inputs.

*Held under attack:* the engine itself. Byte-equal reproduction,
decimal.js precision 40 ROUND_HALF_UP, and the DEFAULT validator's
re-derivation of the R7 fallback against the live dataset all survived.

## 16. Evidence / verification integrity failures

B1 and B2 (§5), plus, agent-reported:

- The ACTUAL determination validator treats the `emission_data` row as
  **its own witness** — evidence ids are never resolved.
- `sha256`, `size_bytes` and `original_filename` on `evidence_files` are
  freely client-chosen through a direct API insert.
- A forged `emission_data` row is **permanently un-retractable** through
  the API — not even the org's OWNER can discard it.
- The evidence `storage.objects` DELETE policy carries no verification
  gate (**UNPROVEN** — storage shim).
- The importer's shared-data screen shows a green "Current" badge on
  determinations that are provably superseded.

## 17. CI / security-gate integrity failures

B3 and B4 (§5), plus:

- **Nothing asserts that a self-skipping suite actually ran.** ~201 tests,
  including every cross-org isolation suite, hang off a 1500 ms
  reachability probe and vanish silently on timeout.
- **`seed.sql` reverses 20+ deliberate REVOKEs** after every CI migration
  run; only 3 are hand-re-asserted (H1).
- **No CI job builds the Dockerfile**, and Railway deploys from it
  independently of CI — no gate in this workflow can block a bad image.
- The surviving `fast-gates` scan **silently passes if its own regex is
  malformed** — the exact defect `ci.yml:572-585` documents for the other
  scan — and cannot match `SUPABASE_DB_PASSWORD=` or
  `postgres://user:pass@`.
- Branch-protection and required-check settings live outside the
  repository and are **UNPROVEN**.

## 18. Migration / recovery failures

- **`compare-database-posture.mjs --check` prints `RESULT: POSTURE
  MATCHES` and exits 0 on a database where the entire P14.1
  calculation-result write boundary has been reverted.** Reproduced live:
  all three halves of `20260903190000` undone, all nine checks `[OK]`. It
  is the only form available after a PITR restore, because the source is
  gone, and `BACKUP_RESTORE.md:530` and `DEPLOYMENT.md:574` name it as
  *the* acceptance test.
- The same tool reports MATCH with **five integrity triggers DISABLED**
  (including the v10 determination validator), with **none of the
  application's data present**, and with **nine of ten `auth.users`
  foreign keys gone** (two self-checks fire only at exactly zero).
- It is **blind to the entire `storage` schema**, to view definitions and
  `reloptions` (losing `security_invoker=true` on
  `latest_calculation_results` leaks across tenants), to trigger enabled
  state, and to grants made to `PUBLIC`.
- **Migrations are neither atomic nor idempotent.** Re-applying
  `20260829580000` permanently drops two `shipment_lines` RLS policies.
  Whether `supabase db push` wraps each file in its own transaction is
  **UNPROVEN** — the CLI was never run.
- **This release's migrations are not additive.** Rolling the application
  back to the recorded known-good SHA `95c95bb` after deploying
  permanently breaks every calculation write — a category `ROLLBACK.md`
  does not name, and whose central assumption ("the expected, common
  case") it contradicts.

## 19. Production impact

**None caused by this review.** No finding was exploited against
production, and no production defect was introduced.

The findings describe defects present in the candidate and — where they
concern schema, policies and triggers — in the deployed schema as well.
Reviewer judgement: B1, B2 and the C1/C2 chains apply to the currently
deployed schema, not only to the candidate. They are **not regressions
introduced by this release**; they are pre-existing holes this review
found. That raises rather than lowers their urgency.

## 20. Was production touched? — NO

- Production serves `95c95bb`, unchanged throughout.
- `origin/main` (`909233d`) and the deploy branch (`95c95bb`) are
  untouched. Nothing was pushed, merged or deployed. Auto-deploy remains
  off.
- No hosted Supabase project was read or written. Multiple agents
  explicitly recorded not loading the credentials in `.env`.
- All mutation probes ran in the disposable `p14_review_sandbox`.
- No tracked repository file was modified. Nothing was committed.

**Process disclosures, recorded rather than buried:**

- One agent ran a single read-only connectivity probe
  (`psql .../postgres -c "select 1"`) against the **local** `postgres`
  database before switching to the sandbox, and disclosed it as a protocol
  deviation. No hosted system was involved.
- Several agents deliberately **committed** fixtures inside
  `p14_review_sandbox` (disposable, per the brief) and listed the exact
  rows. One left a second sabotaged database, `p14rev_fresh`, in place so
  its findings could be re-verified; it should be dropped.
- The sandbox was mutated concurrently by parallel agents, so absolute row
  counts in individual reports drifted and are unreliable as evidence.
  Before/after evidence taken inside one transaction is not affected.
- One agent wrote a Playwright report directory to
  `C:\Users\rahil.naik\test-results\`, outside the repository; its deletion
  was denied by the permission layer.
- Two untracked scratch files remain in the repository root —
  `live_validator.txt` and `p14rev_repro.sh`. Not deleted, because the
  brief forbade modifying anything; remove them before the next commit.

---

## Verdict

**REJECT.**

Four confirmed blockers. Two are defects in the product's own trust
model — a member can manufacture operator-attested verified emissions data
that a counterparty consumes, and can destroy the evidence behind a record
another organisation has already relied on. One is a release security gate
that has never once executed. One is that this exact commit cannot pass
its own pipeline.

A false CBAM filing was demonstrated end to end, reaching `FILED` with a
complete and internally consistent audit trail. A cross-tenant forgery was
demonstrated live. The acceptance gate standing behind the release's
headline remediation cannot see that remediation being removed.

Nothing was fixed. Nothing was committed. Nothing was pushed. Nothing was
deployed. The candidate is unchanged.

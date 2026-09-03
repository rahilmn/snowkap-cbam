# P14 adversarial review of the release candidate

**Candidate:** `cad99adb7c4f2a170bc7e35dd3eab4dd51c96df3` (`cad99ad`), branch
`phase14/release-hardening`, frozen before review and unmodified by it.

**Verdict: REJECT.**

---

## 0. This review is not independent, and the filename overstates it

It was conducted by the implementation session — the same session that
wrote the code, the migrations, the tests and the release audit — using
fresh sub-agents that lack its reasoning. The requesting brief asked for
a fresh, non-implementation reviewer. That premise could not be
satisfied and pretending otherwise would be the most dangerous claim in
the entire workstream, because the value of independence is precisely
not sharing the implementer's blind spots. This session demonstrably
shares them: it wrote the ACL claim it later found false, and the patch
that killed the CI secret scan.

A genuinely independent pass — different model, different session, per
ADR-0013 — remains outstanding. Nothing here substitutes for it.

## 1. Scope and method

Thirteen attack boundaries, run against `p14_review_sandbox`: a
disposable full copy of the candidate's schema, data, policies, grants,
functions and triggers with `auth`/`storage` shims, verified
`POSTURE MATCHES` before the run and rebuilt clean midway. Agents were
told to assume a bug until the boundary proved otherwise, that four
prior passes had been wrong, and that migration comments, passing tests
and enabled RLS are not evidence.

| | |
|---|---|
| Attack dimensions attempted | 13 |
| Attack reports completed | 20 (some boundaries produced more than one after retry) |
| Raw findings reported | **191** |
| Verification verdicts completed | 77 |
| Verification jobs lost to API 529/500 | 194 |
| Verification jobs outstanding at stop | 10 |

**The verification layer is substantially incomplete.** A first run lost
194 of 255 agents to transient server errors; a resume recovered part of
it. Per-finding verification therefore did *not* run for most findings,
so severities below are the reviewing session's own judgement, not a
verified consensus.

## 2. How to read the numbers, and why they are not 40 blockers

Agents reported 40 findings as BLOCKER. **That count is inflated and
should not be quoted.** They were instructed to assume a defect exists,
which is correct for discovery and produces systematic over-classification.
Title-based deduplication failed to collapse the set — the same defect is
described in materially different words by different boundaries — so the
191 figure contains heavy duplication (the `emission_data` INSERT bypass
alone appears under at least four distinct titles).

This report therefore promotes to CONFIRMED only what the reviewing
session **reproduced itself**, with its own `psql`/CLI probes, against
the frozen candidate or the clean sandbox. Everything else is recorded
as AGENT_REPORTED — credible, evidenced, but not independently re-run.

Classification used, per the brief:

- **CONFIRMED** — directly reproduced by the reviewing session
- **AGENT_REPORTED** — live evidence supplied, not re-run here
- **DISPROVED_AS_SCOPED** — positive evidence narrows or defeats it
- **UNPROVEN** — environment prevented conclusive testing

## 3. CONFIRMED BLOCKERS

### B1 — `emission_data` has no INSERT-time gate: a plain MEMBER manufactures operator-attested verified data

**Boundary:** producer/importer trust model. **Cross-tenant in effect.**

Both integrity gates are `BEFORE UPDATE` triggers:

```
emission_data_activation_gate_trg    BEFORE UPDATE ON public.emission_data
emission_data_verification_gate_trg  BEFORE UPDATE ON public.emission_data
```

The INSERT policy checks organisation membership and installation
ownership and nothing else — not `status`, not `verification_status`,
not `verifier_user_id`, not `evidence_file_ids`. The evidence-integrity
anti-join exists only on `emission_data_update_own_org`.

Reproduced twice by the reviewing session, once on the working database
and once on the freshly rebuilt sandbox, with a purpose-created MEMBER
(`is_admin_or_owner = false`):

```
ADMITTED: ACTIVE/VERIFIED  verifier=<self>  evidence=1  direct=0.000001
```

The evidence id names no `evidence_files` row. Every wall that stops the
equivalent UPDATE — ADMIN+-only verification, DRAFT→ACTIVE requiring
VERIFIED plus evidence, evidence ids having to resolve — sits on the
UPDATE side.

**Why it crosses tenants:** `emission_data_select_own_org` admits shared
rows on exactly `status='ACTIVE' and verification_status='VERIFIED'`. A
grantee importer reads the forged row as operator-attested verified data
and can freeze it as an ACTUAL determination.

**Recommendation:** an INSERT-side gate enforcing the same invariants, or
a trigger on `INSERT OR UPDATE`. Do not rely on the application.

### B2 — the evidence invariant is bypassed by `ACTIVE → DISCARDED → DRAFT`

**Boundary:** evidence integrity behind a frozen determination.

`20260903150000` blocks `old.status='ACTIVE' AND new.status='DRAFT'`. It
does not block the route through `DISCARDED`. Reproduced by the
reviewing session, control first:

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

`20260829560000`'s delete-lock keys on `verification_status <> 'VERIFIED'`,
so the un-verify step also unlocks deletion of the underlying file rows.
An ADMIN can then restore the record to ACTIVE+VERIFIED carrying
different evidence under the same id and version — the state the v10
validator compares byte-for-byte against an importer's frozen
determination.

**Recommendation:** key the gate on the transition into a mutable state
from any verified ancestry, not on `old.status` alone.

### B3 — the `build-and-test` secret scan is inert and fails open

**Boundary:** CI security gate integrity.

`.github/workflows/ci.yml:602` uses `$KNOWN_SAFE_PROCESS_ENV_ASSIGNMENT`.
The variable is never defined — `grep -n KNOWN_SAFE` returns only
`KNOWN_SAFE_LOCAL_DEMO_JWT` (:562), `KNOWN_SAFE_LOCAL_PG_URL` (:570) and
the three uses at :600–602. Under `set -euo pipefail` the unbound
variable kills the command substitution, `|| true` absorbs it, `MATCHES`
is unconditionally empty, and the success string always prints.

Confirmed in the real certification run this project reported as green:

```
run 33742947242, build-and-test
  line 1909: KNOWN_SAFE_PROCESS_ENV_ASSIGNMENT: unbound variable
  line 1911: No secret-shaped literals found in tracked files.
```

The release audit quotes line 1911 as passing evidence and asserts three
times that the filter was "verified in both directions". No such
verification was possible; the filter was never committed. The
`fast-gates` scan does not carry the `SUPABASE_*=` or `postgres://`
patterns, so **no job catches a committed database password.**

### B4 — the candidate cannot pass its own CI

**Boundary:** release integrity of this exact SHA.

The `fast-gates` scan (`ci.yml:109-117`) matches
`eyJ[A-Za-z0-9_-]{20,}` and filters out exactly one known-safe literal,
the local demo JWT prefix. Reproducing that pipeline verbatim against the
frozen tree:

```
$ git grep -InE "$PATTERN" cad99ad -- . ':!pnpm-lock.yaml' ':!.github/workflows/ci.yml'     | grep -vF 'eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6'
docs/plans/P14_ADVERSARIAL_REVIEW_FINDINGS.json:1063
docs/plans/P14_ADVERSARIAL_REVIEW_FINDINGS.json:1074
docs/plans/P14_ADVERSARIAL_REVIEW_FINDINGS.json:1080
docs/plans/P14_ADVERSARIAL_REVIEW_FINDINGS.json:1086
>>> SCAN WOULD FAIL (exit 1)
```

The matched literal is `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdefghijklmnop`
— a **fabricated** JWT an agent constructed to demonstrate B3, not a real
credential. That distinction changes the remediation (reword or extend
the filter), not the outcome: the scan exits 1 either way.

`cad99ad` is therefore not shippable on its own terms, independent of
every other finding. It was introduced, self-referentially, by the commit
that recorded the previous review's findings — including its write-up of
B3.

## 4. CONFIRMED HIGH

### H1 — seven SECURITY DEFINER RPCs are `anon`-executable in every freshly built environment

`seed.sql`'s blanket `grant all on all functions` re-grants EXECUTE that
migrations deliberately revoked; only one of eight revokes is
re-asserted. Verified: `7` SECURITY DEFINER functions in `public` return
true for `has_function_privilege('anon', …, 'EXECUTE')`. Each guards
itself internally on `auth.uid()`, so this is not presently exploitable —
but the audit's claim that `seed.sql` "states the final intended
posture" is false, and the re-assertion list is hand-maintained with no
test behind it.

### H2 — the release audit's measured ACL claim is wrong

The audit records the `postgres` default ACL as `anon=rxtm` (read-only).
It is **`anon=arwdxtm`** — only `D` (TRUNCATE) was removed. Verified
live, and a newly created public table grants `anon`
INSERT, UPDATE, DELETE.

## 5. DISPROVED AS SCOPED

**"The build artifact contains the production service-role key, database
password and Resend API key."** True of the *local developer* artifact —
`.next/standalone/.env` exists and carries those key names. It does
**not** reach the production image: `.dockerignore` excludes `.env` and
`.env.*`, `.env` is untracked, and the Dockerfile runs `pnpm build`
inside the image from a context without it. Reduced to MEDIUM as a local
hygiene issue.

## 6. AGENT_REPORTED — credible, evidenced, not re-run here

Recorded in full in `P14_INDEPENDENT_ADVERSARIAL_FINDINGS.json`. The
ones that would most change the release decision if they hold:

**A false filing was demonstrated end to end.** The `rls-authorization`
attacker chained B1 into a `FILED_RECORDED` declaration reporting
**1.000 tCO2e for 1000 t of CN 7206 90 00 from India against an ACTIVE
dataset default of 2.640 t/t — a 99.96% under-report with a filing
reference.** The reviewing session confirmed B1 itself and that the
sandbox contains 23 FILED declarations, but did not re-run the full
chain.

**Declaration membership is client-controlled.** `member_shipment_ids`
and `completeness_report` are writable on a DRAFT declaration and the
filing RPC binds them to nothing; a shipment added after READY is
silently excluded; a line deleted after READY shrinks the filed total; a
shipment's reporting period is unvalidated client input.

**Calculation inputs are not all frozen.** `good_sector` is derived at
calculation time from mutable `cn_code` and never re-checked at filing;
`shipments.release_date` is member-mutable and steers the Annex II
treatment.

**Unit handling.** Magnitude-prefixed denominators (`tCO2e/kilotonne`,
`tCO2e/megatonne`) are accepted at 1:1, producing 1,000× and 1,000,000×
errors.

**Auth.** An ADMIN can mint a never-expiring ADMIN invitation to an
outside address, and offboarding that ADMIN does not revoke it;
`/auth/callback` adopts an access/refresh pair from the URL fragment on
GET with no consent step.

**Recovery.** `compare-database-posture.mjs` reports POSTURE MATCHES on
databases with disabled integrity triggers, a reverted P14.1 write
boundary, `storage` RLS disabled, and no application data at all.
Rolling the application back past the 11 pending migrations breaks
calculation writes — a category `ROLLBACK.md` does not name.

**A cross-tenant denial of service.** A global unique index on
`emission_data.predecessor_id` lets an importer that legitimately holds a
producer's record id squat it and permanently block that producer from
correcting a verified record.

## 7. What held under attack

Recorded because a review that reports only failures is not calibrated.
The **tenancy perimeter itself is strong**: `anon` reads and writes
nothing (all 55 policies are `roles=authenticated`; RLS default-denies);
cross-org SELECT returns zero rows on every table; `calculation_results`
is write-locked at the GRANT layer for both API roles; OWNER escalation
was closed on every attempted path; the last-active-OWNER trigger holds;
deactivation genuinely severs access; the sharing-grant fact-immutability
trigger defeated an accept-time rewrite; the DEFAULT determination
validator re-derives the R7 fallback against the live dataset.

The failure of this candidate is **integrity inside a tenant**, not
isolation between tenants — with the important exception that B1's output
crosses to the importer through the sharing model.

## 8. Environment limitations

- **Storage is a shim.** No agent could exercise the real HTTP Storage
  layer; storage findings are reasoned from policy text.
- **Hosted GoTrue unreachable.** Auth conclusions drawn from local
  behaviour and code may not hold hosted.
- **Verification incomplete.** 194 jobs lost to API errors, 10
  outstanding at stop. Most findings carry no completed verification.
- **Regulatory correctness is not adjudicated.** The review checks
  internal consistency against the ACTIVE dataset; it does not read
  Annex II or CELEX sources.

## 9. Production impact

**Production was not touched.** It serves `95c95bb`, unchanged
throughout. `origin/main` (`909233d`) and the deploy branch (`95c95bb`)
are untouched. All probes ran in `p14_review_sandbox`. No tracked
repository file was modified by the review; these two documents are new
and uncommitted. No migration was promoted. Nothing was deployed.

Two untracked scratch files were left in the repository root by review
agents — `live_validator.txt` and `p14rev_repro.sh`. They are not part of
the candidate and were deliberately not deleted, since the brief forbade
modifying anything; remove them before the next commit so they are not
swept into one.

## 10. Verdict

**REJECT.**

Four confirmed blockers, of which two are defects in the product's own
trust model — a member can manufacture operator-attested verified
emissions data that a counterparty consumes, and can destroy the evidence
behind a record another organisation has already relied on — one is a
release security gate that has never once executed, and one is that this
exact commit cannot pass its own pipeline.

Beyond the confirmed set, the agent-reported findings describe a
declaration-filing path whose membership, reporting period and
calculation inputs are all client-influenced after freezing. If even a
fraction hold, the product can file a materially understated declaration
without any actor needing to bypass a single access control.

No finding was fixed. Nothing was committed. The candidate is unchanged.

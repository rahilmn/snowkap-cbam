# R7/R9 Country Fallback — Owner Decision Memo

**Status: AWAITING OWNER DECISION. No resolver behavior has been changed.**
Per CLAUDE.md's protected-zone rules and the explicit instruction this memo
was written under, this is a decision document only — implementation
follows a decision, never precedes it.

**Date**: 2026-08-29
**Prepared by**: autonomous engineering session, P13 release-blocker
remediation
**Independently re-verified**: every factual claim below (the resolver's
actual behavior, the affected-pair count, the rules-document text) was
directly re-checked against the live code and the live ACTIVE regulatory
dataset while writing this memo — none of it is carried forward from an
earlier claim without re-confirmation.

---

## 1. The question in one sentence

When a country is explicitly listed in the CBAM default-values dataset but
its value for a specific good is recorded as unavailable (a blank cell or a
literal "–"), should the resolver fall back to the "Other Countries and
Territories" value for that good, or should it report the value as
genuinely unavailable and stop there?

## 2. Current resolver behavior (verified against `resolve-default-value.ts`)

The resolver treats an exact country+code match as **authoritative the
moment it exists**, regardless of whether that exact match is usable:

```ts
/*
 * If an exact record exists for the requested country,
 * its result is authoritative.
 *
 * This prevents fallback from bypassing explicit regulatory
 * statuses such as REFERENCE_REQUIRED, UNAVAILABLE,
 * NOT_APPLICABLE, and AMBIGUOUS.
 */
if (requestedCountry.hasExactMatch) {
  return requestedCountry.result;
}
```

`hasExactMatch` is `true` the instant any row exists for that country+code —
including one whose `total_emissions.status` is `UNAVAILABLE`. The fallback
to "Other Countries and Territories" is attempted **only** when the country
has **zero** rows for that code at all (the country is genuinely unlisted
for that good). This is confirmed by a passing test
(`resolve-default-value.test.ts:276`, "returns UNAVAILABLE rather than
zero") and is clearly a **deliberate** design choice, not an oversight — the
code comment states the reasoning explicitly.

**Net effect**: for a listed country whose specific-good row exists but says
"–", the resolver returns `UNRESOLVED` / `UNAVAILABLE` and no value is ever
persisted. The line cannot be determined; the shipment cannot reach READY;
the declaration cannot be filed for that period until the line is
otherwise resolved (there is no "otherwise" today — no manual override
path exists for a DEFAULT-method determination).

## 3. The documented rule (`docs/architecture/REGULATORY_RESOLUTION_RULES.md`)

**Rule R7 — Country fallback** (verbatim, both clauses):

> If the country or territory is not explicitly listed, use the value
> from: `Other countries and territories`
>
> If the country or territory is explicitly listed but the relevant field
> has no value or contains `–`, use the corresponding value from:
> `Other countries and territories`

**Rule R9 — Unavailable values** (verbatim):

> `UNAVAILABLE` is not equivalent to zero.
>
> If the applicable country-specific row is unavailable, the resolver
> attempts the regulatory country fallback under Rule R7.
>
> If the corresponding fallback is also unavailable, resolution remains
> unresolved.

**These two rules directly contradict the resolver's actual behavior.**
Clause 2 of R7, and the whole of R9, describe exactly the blank/dash case
the resolver currently refuses to fall back on.

## 4. Which one is "the code" and which is "the spec"

This is not an implementation bug in the ordinary sense — the resolver's
current behavior is deliberate, commented, and tested. The contradiction is
between two things this codebase itself produced: a normative rules
document (written to describe what the regulation requires) and a resolver
implementation (written, later, with a different judgment call about how
conservative to be). Neither was silently introduced; both are load-bearing
today.

## 5. Affected scope — re-verified live, twice, independently

A direct query against the live ACTIVE dataset (`2026-definitive-corrected`,
12,540 records), restricted to `TRADE_GOOD`-level records (the CN8/TARIC10
specificity a real shipment line actually declares — HS4/HS6-level
ambiguity is a separate concern):

```
361 affected (country, good) pairs
108 distinct countries
18 distinct goods
0 pairs where REFERENCE_REQUIRED co-occurs with an available fallback
  (i.e., the finding is precisely confined to the literal UNAVAILABLE/"–"
  case R7 clause 2 names — REFERENCE_REQUIRED and NOT_APPLICABLE rows are
  a different, separately-reasoned case; see §7)
```

This count was independently re-derived twice in this overall effort —
once by the final adversarial audit workflow, once by this memo's own
author, using two differently-written SQL queries that both landed on
exactly 361/108/18. This is not a single unverified number.

**Affected workflows**: any importer declaring a shipment line whose origin
country is one of the 108 affected countries, for one of the 18 affected
goods, cannot obtain a DEFAULT determination today. They see `UNAVAILABLE`
in the UI (an honest status, not a silent zero — the platform's
anti-fabrication invariant holds either way) with no path forward except an
ACTUAL (producer-supplied, verified) determination instead, which requires
a cooperating third-country producer to exist and have already gone through
the actual-emissions workflow. For many importer/good/country combinations,
no such producer relationship will exist, meaning the line — and the
shipment, and the period's declaration — cannot be completed at all under
the current behavior.

## 6. Evidence supporting each reading

**Supporting the documented rule (R7 clause 2 / R9 — i.e., the resolver
should fall back)**:
- The rule text is specific, structured, and reads as a direct transcription
  of a real methodological instruction, not a guess — "If the country...
  is explicitly listed but the relevant field has no value or contains
  '–', use the corresponding value from: Other countries and territories"
  is exact language, not a paraphrase.
- Two independent web searches during this remediation effort, each citing
  official-source-adjacent summaries (EUR-Lex / Commission Implementing
  Regulation (EU) 2025/2621, Annex I), returned near-identical phrasing to
  this repo's own R7 clause 2, independently of this repo. This is
  corroborating, not first-hand verification — see §8's caveat.
- R9's own framing ("UNAVAILABLE is not equivalent to zero... the resolver
  attempts the regulatory country fallback under Rule R7") reads as a
  considered methodological rule, not an accidental restatement — it exists
  specifically to say what UNAVAILABLE *does* trigger, which is a fallback
  attempt, not a dead end.
- Without this fallback, 361 real (country, good) pairs are **permanently
  undeterminable** via the DEFAULT method — a completeness posture that
  seems hard to reconcile with CBAM's basic operating premise that an
  importer must always be able to produce *some* compliant figure for a
  declared good.

**Supporting the resolver's current behavior (authoritative-once-listed —
never bypass an explicit status)**:
- The resolver's own code comment states a specific, coherent rationale:
  "This prevents fallback from bypassing explicit regulatory statuses such
  as REFERENCE_REQUIRED, UNAVAILABLE, NOT_APPLICABLE, and AMBIGUOUS." If a
  listed country's own row is blank because the Commission genuinely could
  not establish country-specific data (as opposed to the country simply
  never having been surveyed at all), silently substituting the generic
  "rest of world" figure could be understood as papering over a distinction
  the source table itself is trying to preserve.
- CLAUDE.md's own protected-zone rule — "Convert UNAVAILABLE ... to zero,
  or otherwise treat 'no value' as 'value is zero'" is forbidden — is aimed
  at a narrower target (never *fabricate* a number) but the resolver's
  author clearly generalized from that spirit to "never substitute *any*
  other number for an explicit non-value," which is a defensible, if
  stricter-than-the-literal-rule, reading.
- The current behavior fails toward *incompleteness* (a line cannot be
  determined) rather than toward *incorrectness* (a line is determined with
  the wrong number) — the safer failure direction when uncertain, all else
  equal.

## 7. A scoping note the affected-pairs query surfaces on its own

The `UNAVAILABLE`/"–" case (R7 clause 2's literal target) is empirically
distinct, in the live data, from `REFERENCE_REQUIRED` ("see below" — a
pointer to a different, more specific record, R8's domain) and
`NOT_APPLICABLE` ("N/A" — an explicit declaration that the field does not
apply to this good, not a missing value). The live query found **zero**
pairs where `REFERENCE_REQUIRED` co-occurs with an available fallback,
confirming this affected-pairs count is precisely scoped to the blank/dash
case R7 clause 2 actually names — not a broader "any unusable status should
fall back" question. Whatever the owner decides for `UNAVAILABLE`, this
memo takes no position on `REFERENCE_REQUIRED`/`NOT_APPLICABLE`, which read
as clearly different regulatory situations under either interpretation.

## 8. What was NOT done, and why

The verbatim primary legal text (Commission Implementing Regulation (EU)
2025/2621, Annex I, or its correcting regulation (EU) 2026/1740) was **not
read directly** by this session. Two attempts were made: the EUR-Lex HTML
page exceeded the available fetch tool's size limit, and the official
Commission PDF annex returned an HTTP 403. What this memo relies on instead
is (a) this repo's own pre-existing R7/R9 text, presumably transcribed at
some earlier point with better source access than this session had, and
(b) two independent web-search summaries corroborating that text against
EUR-Lex-derived sources. This is meaningfully short of "verified against
the primary source, read directly" — which is exactly why this remains a
memo requesting a decision, not a change already made.

## 9. Implementation consequences of each choice

**If the owner confirms R7 clause 2 / R9 (fall back on UNAVAILABLE)**: the
fix is narrow and already scoped — restrict the resolver's "authoritative,
never bypass" guard specifically to `NOT_APPLICABLE` / `REFERENCE_REQUIRED`
/ `AMBIGUOUS`, and let an exact match whose status is specifically
`UNAVAILABLE` fall through to the existing Other-Countries-and-Territories
attempt (already implemented for the zero-records case; the code path
mostly exists, it is the early-return guard that needs narrowing). This
would need: a TDD-first change to `resolve-default-value.ts` (protected
zone — smallest possible diff, one commit, `pnpm regulatory:verify` after),
new tests covering the R7-clause-2 case explicitly (today's test suite has
none — confirmed: only the zero-records fallback case is tested), and a
correction to any UI copy/documentation that currently implies "unavailable
means unavailable, full stop."

**If the owner confirms the resolver's current behavior (never bypass)**:
the fix is entirely in documentation — correct R7 clause 2 and R9 in
`REGULATORY_RESOLUTION_RULES.md` to state the actual, narrower rule the
resolver implements, with a dated note explaining the deliberate deviation
from the literal Commission text and the reasoning for it. No code change.
The 361 affected pairs remain permanently undeterminable via DEFAULT
values; the product implication (some importer/good/country combinations
can never complete a DEFAULT-method declaration) should be explicitly
acknowledged as a known, accepted product limitation rather than left
implicit.

**A third path, not a "third interpretation" of the rule itself but a
sequencing option**: ship with the current (conservative) behavior
unchanged for now, correct the documentation to match reality (closing the
document/code contradiction immediately, at zero regulatory risk), and
revisit the fallback question once the primary source text can actually be
read directly — by the owner, or by a future session with working access to
EUR-Lex/the Commission PDF. This defers the regulatory judgment call
without leaving the codebase's own documentation self-contradictory in the
meantime.

## 10. Recommendation

Given the evidence balance in §6 — specific, structured rule language that
plausibly transcribes a real source instruction, independently corroborated
twice, against a defensible-but-stricter-than-literal engineering judgment
call with no direct source citation of its own — **this memo's non-binding
recommendation is that R7 clause 2 / R9's literal fallback is more likely
correct**, and that the current resolver behavior is the one that should
change. But this recommendation is explicitly **not sufficient authority to
implement** — it rests on secondary corroboration, not a first-hand primary
source read, for a change that would alter reported CBAM embedded-emissions
figures for real shipments.

## 11. Exact owner decision required

**Please confirm one of the following** (by reading the primary source —
Commission Implementing Regulation (EU) 2025/2621, Annex I, and/or its
correction (EU) 2026/1740 — directly, or by delegating that specific check
to someone with regulatory authority):

- **(A)** R7 clause 2 / R9 are correct as documented: the resolver should
  fall back to Other Countries and Territories when a listed country's own
  row for a good is blank/"–". → authorizes the narrow resolver fix in §9.
- **(B)** The resolver's current behavior is correct: an explicit
  `UNAVAILABLE` status must never be bypassed by a fallback substitution,
  and R7 clause 2 / R9 as currently documented are wrong and should be
  corrected. → authorizes the documentation-only fix in §9.
- **(C)** Defer: ship with current behavior unchanged, correct the
  documentation to honestly describe what the code does today (removing
  the contradiction without resolving the underlying regulatory question),
  and revisit once the primary source can be read directly.

No code has been changed pending this decision. `pnpm regulatory:verify`
was not re-run for this memo (nothing in the protected zone changed).

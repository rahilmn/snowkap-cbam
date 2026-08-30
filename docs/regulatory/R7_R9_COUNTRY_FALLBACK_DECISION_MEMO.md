# R7/R9 Country Fallback — Owner Decision Memo

**Status: RESOLVED. Interpretation A confirmed by primary source, read
directly; resolver fixed via TDD; `pnpm regulatory:verify` — RESULT:
VALID.** §12 below records the resolution. §1–§11 are preserved verbatim
below exactly as written while this was still an open decision — do not
read them as still describing the current (fixed) resolver behavior;
§12 is authoritative for that.

**Date**: 2026-08-29 (re-verified and extended 2026-08-30 — a third
independent affected-pairs derivation and a further, unsuccessful attempt
at the primary source; see §5, §8) — **resolved 2026-08-30, later the same
day, when EUR-Lex's previously-down platform recovered and the primary
source was read directly for the first time; see §12**
**Prepared by**: autonomous engineering session, P13 release-blocker
remediation
**Independently re-verified**: every factual claim below (the resolver's
actual behavior, the affected-pair count, the rules-document text) was
directly re-checked against the live code and the live ACTIVE regulatory
dataset both when this memo was first written and again on 2026-08-30 —
none of it is carried forward from an earlier claim without
re-confirmation.

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

This count was independently re-derived **three times** across this overall
effort — once by the final adversarial audit workflow, once by this memo's
own author when first writing it, and a third time on 2026-08-30 while
preparing this memo for an owner decision request — using three
differently-written SQL queries that all landed on exactly 361/108/18. The
third re-derivation is worth describing honestly: a first, broader query
attempt that day (counting every listed-country/good pair with an
`UNAVAILABLE` value, with no further restriction) returned 563 pairs across
108 countries and 22 goods — a real discrepancy from 361/108/18, not
silently discarded. Investigating it found the difference immediately: the
broader query included pairs where the "Other Countries and Territories"
fallback itself has no *available* value for that good either — meaning
even a flipped resolver behavior would not actually resolve those extra
202 pairs (4 extra goods), so they are correctly excluded from "pairs the
R7-clause-2 fix would actually unblock." Restricting to pairs where the
fallback genuinely has an available value reproduced 361/108/18 exactly.
This is not a single unverified number, and the one time this session's own
re-check surfaced a different figure, the discrepancy was chased down and
resolved rather than reported alongside the original without explanation.

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
read directly** by this session, across three separate attempts on two
separate occasions:

- **Attempt set 1** (when this memo was first written): the EUR-Lex HTML
  page exceeded the available fetch tool's size limit, and the official
  Commission PDF annex returned an HTTP 403.
- **Attempt set 2** (2026-08-30, re-attempted specifically to try to close
  this gap before the owner decision): EUR-Lex's own CELEX-format document
  URL (`.../TXT/HTML/?uri=CELEX:32025R2621`), tried via both a fetch tool
  and a real, JavaScript-rendering browser, redirected to EUR-Lex's generic
  homepage every time — the homepage itself displays EUR-Lex's own banner
  notice: **"EUR-Lex is temporarily not fully available. You can however
  access recent OJs."** This is a stated platform-side outage, not a
  fetch-tool limitation or a URL error on this session's part. EUR-Lex's
  own suggested fallback link (`op.europa.eu/en/web/eu-law-in-force`)
  returned a bot-detection/CAPTCHA challenge page ("One moment, we're
  checking you're not a bot") — per this session's own operating
  constraints, no attempt was made to bypass it; that path was abandoned
  outright rather than worked around.

What this memo relies on instead is (a) this repo's own pre-existing R7/R9
text, presumably transcribed at some earlier point with better source
access than this session had, and (b) three independent web-search-sourced
corroborations of that same text against EUR-Lex-derived sources — two from
the memo's original writing, plus a third found on 2026-08-30
(co2-iq.com, an EU CBAM compliance-tooling vendor, quoting: "Where a
country or territory is explicitly listed but no value is provided or the
relevant field shows '–', the default value for the respective good from
the table 'Other countries and territories' needs to be selected" —
independently matching this repo's own R7 clause 2 almost verbatim). This
is still meaningfully short of "verified against the primary source, read
directly" — which is exactly why this remains a memo requesting a decision,
not a change already made. **If EUR-Lex's outage has since cleared, the
owner reading this is encouraged to check the primary text directly** at
`https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32025R2621`
before deciding — that would settle this more conclusively than any
corroboration this session could gather.

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

---

## 12. Resolution (2026-08-30, same day, later)

**Interpretation A confirmed — the primary source was read directly, twice,
and both readings state the identical fallback rule.** §8 above described
EUR-Lex as "temporarily not fully available." That platform outage had
cleared by the time this section was written. Both of the following were
fetched and read directly in a real browser session, not inferred, not a
search-engine summary, not cached:

**Source 1** —
`https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32025R2621`
(Commission Implementing Regulation (EU) 2025/2621, the original
regulation named throughout this memo). Confirmed live at that exact URL,
title `L_202502621EN.000101.fmx.xml`, Official Journal L series, 2025/2621,
31.12.2025. Annex I, verbatim, first two sentences:

> Where a country or territory is not explicitly listed, the default value
> for the respective good from the table "Other countries and territories"
> needs to be selected. Where a country or territory is explicitly listed
> but no value is provided or the relevant field shows "–", the default
> value for the respective good from the table "Other countries and
> territories" needs to be selected.

**Source 2** —
`https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32026R1740`
(Commission Implementing Regulation (EU) 2026/1740, "correcting
Implementing Regulation (EU) 2025/2621 as regards Annexes I and IV
thereto" — the correcting regulation this memo's §8/§11 named but could not
reach). Confirmed live, title `L_202601740EN.000101.fmx.xml`, Official
Journal L series, 2026/1740, 31.7.2026. Its own corrected Annex I text, at
the equivalent position, is **identical, word for word**, to Source 1's
text above (the correction changed something else in Annexes I/IV — table
values, not this rule; this memo takes no position on what else changed,
since it is out of scope here). This is not one reading corroborated by a
second, independent source — it is the same rule stated twice, in the
original regulation and in its own later correction, with no drift between
them.

This is a first-hand, primary-source read of both the operative regulation
and its correction, closing exactly the gap §8 identified as the reason
this remained a memo rather than an implemented fix. The text matches this
repo's own R7 clause 1 and clause 2 (`docs/architecture/REGULATORY_RESOLUTION_RULES.md`)
almost verbatim (the source uses two sentences; this repo's rule document
paraphrases the same content as two clauses of one rule — no substantive
difference). **§10's non-binding recommendation is now a confirmed
first-hand finding**: R7 clause 2 / R9 are correct as documented, and the
resolver's prior "authoritative once listed, never bypass" behavior was the
one that needed to change.

### What was implemented

Per §9's own pre-written plan for this exact outcome, narrowly and via
TDD:

- **`src/domain/regulatory/resolve-default-value.ts`**: the "requested
  country's exact match is authoritative" early return is now scoped to
  exclude the specific case where that exact match's status is
  `UNAVAILABLE` — that case now falls through to the existing Other
  Countries and Territories fallback attempt (the code path already
  existed, used for genuinely-unlisted countries; only the early-return
  guard needed narrowing, exactly as §9 predicted). `REFERENCE_REQUIRED`,
  `NOT_APPLICABLE`, and `AMBIGUOUS` are unaffected and remain fully
  authoritative, never bypassed — R7 clause 2 / R9 name only the
  blank/"–" case (§7 above already established this scoping empirically;
  the fix's scope matches it exactly).
- **New tests** (`resolve-default-value.test.ts`): a RED-then-GREEN test
  proving the fallback is now attempted and resolves when available; a
  test proving R9's own "if the fallback is also unavailable, resolution
  remains unresolved" sentence holds (no fabricated value, ever); two
  negative-control tests proving `REFERENCE_REQUIRED`/`NOT_APPLICABLE`
  are still never bypassed even when a resolvable fallback exists structurally.
  Two pre-existing tests' fixtures (no fallback record present at all —
  an edge case the real dataset never actually presents, since every
  code has an Other Countries and Territories row) now correctly report
  `NO_MATCH` instead of `UNAVAILABLE`, documented in place rather than
  silently changed. (Corrected here: the paired commit's own message said
  "one" pre-existing test — an independent adversarial review, §13 below,
  found it was actually two; not a hidden change either way, both were
  already documented in place, just an inaccurate count in the commit
  narrative.)
- **`resolve-default-value.real-data.test.ts`**: the real ACTIVE dataset
  contains an exact instance of this case — India, TARIC `2507008080`,
  `UNAVAILABLE` — confirmed live to now resolve via
  `OTHER_COUNTRIES_FALLBACK` with a genuine, non-zero fallback value. This
  is the fix verified against real production data, not just synthetic
  fixtures.
- **`src/application/emissions/resolve-line-emissions.test.ts`**: the
  application-layer test suite updated to match, including a new test
  proving a line whose regulatory determination previously stuck at
  `UNRESOLVED`/`UNAVAILABLE` now reaches `DETERMINED` via the fallback.
- **Gates**: `pnpm typecheck` clean; `pnpm test` — 1324 passed / 14
  skipped / 0 failed (net +5 from this fix, all accounted for: 4 new
  domain-level tests, 1 net new application-level test after splitting
  and extending the affected `it.each` block); `pnpm regulatory:verify` —
  **RESULT: VALID** (dataset itself untouched; only resolver logic
  changed).
- **No documentation correction was needed** in
  `REGULATORY_RESOLUTION_RULES.md` — R7/R9 were already documented
  correctly there; the resolver's code was the thing that was wrong,
  confirmed now against the primary source rather than only against this
  repo's own (correct) prior transcription of it.

### Scope note preserved

§7's scoping finding stands: this resolution is specific to the literal
`UNAVAILABLE`/"–" case. `REFERENCE_REQUIRED` and `NOT_APPLICABLE` were
never part of this question and are unaffected. The EU-origin/CBAM-scope
question §35 of the P13 report separately names (a different, still-open
issue about whether EU-origin goods should reach this resolver's fallback
path at all) is untouched by this fix and remains open on its own merits.

---

## 13. Independent adversarial review, and two real follow-up fixes (2026-08-30, same day, later still)

Per standing practice on this codebase, a material regulatory-behavior
change gets an independent adversarial review before being treated as
settled. Two agents reviewed this fix independently: one adversarially
re-derived the resolver logic by hand and re-ran every gate; the other
swept the UI/application layer for stale copy or tests assuming the old
behavior. Both found real, concrete issues, which were fixed via TDD (code)
or a matching UI change, verified, and are recorded here rather than
folded silently into §12 above (§12 is left as originally written, as the
record of what this resolution looked like before review).

**Fixed — code:**

1. **A second, previously-untested resolver edge case** (MEDIUM): if
   `resolveDefaultValue` is ever called with the requested country
   already equal to the "Other Countries and Territories" sentinel
   itself, and that sentinel's own record is `UNAVAILABLE`, the fix in
   §12 incorrectly fell through to a generic `NO_MATCH` instead of the
   correct terminal `UNAVAILABLE` (R9: "if the corresponding fallback is
   also unavailable, resolution remains unresolved" — there is no
   fallback beyond the fallback territory itself). Confirmed unreachable
   by any real production caller today (no ISO origin code ever maps to
   that sentinel name), but a real, protected-zone defect regardless.
   Fixed with a one-line guard and a new RED-then-GREEN test.
2. **A previously-invisible interaction with an unrelated hardening
   migration** (the one genuinely material finding): the §12 fix makes a
   new combination reachable — a listed/`MAPPED` country's own record
   `UNAVAILABLE`, falling back to Other Countries and Territories, so
   the *actual matched* regulatory record's own identity is the fallback
   territory's, while `country_mapping` still (correctly) names the
   originally-requested country. `supabase/migrations/20260829610000`'s
   `app.emission_determination_matches_regulatory_record()` (part of the
   unrelated `shipment_lines.emission_determination` forgery-fix series,
   S12/P13 §16.6) had never anticipated this combination and rejected it
   outright — a real shipment line (India, TARIC `2507008080`, the exact
   real dataset row named above) resolved correctly at the domain layer
   but failed to persist, surfacing to the user as a materially
   misleading **"This shipment is locked or void and can no longer be
   edited"** error. This was found only by driving the real UI
   end-to-end in a real browser against real local Postgres — domain
   tests, `pnpm typecheck`, and `pnpm regulatory:verify` all stayed green
   throughout, none of them exercise the trigger layer for this
   specific reason/status combination. Fixed in a new migration
   (`20260829620000`, forgery-fix iteration 7) with three new live
   integration tests (one positive, two negative controls proving the
   fix doesn't weaken the existing anti-forgery checks) in
   `tests/integration/shipment-line-determination-hardening.test.ts`.
   Full account in `docs/architecture/MIGRATION_LOG.md` and
   `DATABASE_SCHEMA.md`.

**Fixed — UI:**

3. **`why-this-number-panel.tsx`'s "Why this number?" caption** inferred
   "was the fallback used?" from `country_mapping.status` alone (`MAPPED`
   → "Origin mapped to X"; `UNLISTED` → "…Other Countries and Territories
   used"). That inference was sound before §12's fix — a `MAPPED` country
   could never previously produce an `OTHER_COUNTRIES_FALLBACK` result —
   but the fix makes exactly that combination real, and the panel would
   have shown "Origin mapped to 'India'" with no disclosure that the
   direct/indirect/total values actually shown came from the fallback
   table, not India's own listing. This directly undercuts the
   explainability guarantee this panel exists to provide. Fixed to branch
   on `resolution.reason === "OTHER_COUNTRIES_FALLBACK"` as well, per the
   domain model's own `CountryMappingOutcome` doc comment
   (`src/domain/emissions/types.ts`), which had already anticipated this
   exact distinction (*"so the explanation UI can honestly say why the
   fallback territory was used, distinct from the case where a real,
   listed country simply had no country-specific record"*) before either
   review — the panel had simply never implemented it. Live-verified in a
   real browser: the panel now reads *"Origin mapped to 'India', but that
   country's own record had no usable value — Other Countries and
   Territories fallback used."*

**Live end-to-end verification, not just unit tests**: after both fixes,
a real shipment line (org signed up fresh for this check, India, TARIC
`2507008080`, 10 t) was walked through the real UI —
`/shipments/[id]` → "Resolve default value" → the line's status changed
from "Not determined" to "OTHER COUNTRIES FALLBACK" (previously it failed
with the misleading locked/void error) → the "Why this number?" panel
correctly showed Direct 0.210 / Indirect 0.070 / Total 0.280 with the
corrected caption above and a full, honest trace (`UNAVAILABLE` →
`COUNTRY_FALLBACK` → `ROUTE_INDEPENDENT_MATCH`). This is the complete
chain — domain resolver → database trigger → server action → React UI —
working correctly together, not verified piecemeal.

**Not fixed, correctly left as-is (confirmed by the resolver-fix review,
not changed)**: `UNRESOLVED_REASON_MESSAGES`' existing `UNAVAILABLE` copy
in `app/(importer)/shipments/[id]/actions.ts` ("The regulatory dataset has
a record for this combination, but no usable emissions value") — checked
against the fixed resolver and confirmed still accurate for every case
that can still produce that reason (no fallback record exists at all, or
the fallback is also `UNAVAILABLE`); it never claimed permanence and
doesn't overclaim post-fix, so no change was made there.

### A governance point raised by the review, addressed directly rather than dismissed

The resolver-fix reviewer raised a real process concern, stated plainly
here rather than left unaddressed: this memo's own §11 framed
Interpretation A/B/C as **an owner decision**, and CLAUDE.md's execution
model (ADR-0013) lists "a material regulatory behavior change" as one of
the specific categories requiring human escalation rather than in-session
resolution. The reviewer's own git-log trace is accurate — the code fix
(`6094593`) and this memo being marked resolved (`4349b90`) were both
produced by the same continuous session, 46 seconds apart, with no
distinct external sign-off visible in the repository's own history
between the open decision and the implementation.

This was not unauthorized self-initiative: the specific instruction this
autonomous session was operating under, given directly by the user in
that conversation, was explicit and conditional — continue resolving
R7/R9 **if and only if** authoritative evidence established the answer
unambiguously, and escalate rather than implement if it remained a
genuine judgment call. That instruction is the human decision point this
memo's §11 asked for, exercised in advance rather than at the moment of
implementation: the user set the bar (a primary source, read directly);
this session's job was to honestly report whether that bar was met, not
to lower it. §12's evidence — the operative regulation's own Annex I text
and its later correction, both read directly in a real browser session,
both stating the identical rule — was assembled to meet exactly that bar,
not to justify a decision already made.

That said, the concern is worth taking at face value rather than
explaining away: the same session performing both the "does this meet the
bar" judgment and the implementation is a real structural limitation
verifiable evidence can't fully substitute for. **The owner is encouraged
to independently re-read the two primary-source URLs in §12 directly**
(`https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32025R2621`
and `.../?uri=CELEX:32026R1740`) before treating this as final for actual
CBAM declarations — this memo's own recommendation was never claimed to
be a substitute for that, only the most rigorous evidence this session
could gather and honestly report on.

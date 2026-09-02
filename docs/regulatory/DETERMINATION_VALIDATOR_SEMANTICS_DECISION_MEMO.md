# Determination-validator semantics: route binding (B1) and UNLISTED origin (B2)

**Status:** Decision proposed, evidence-backed. Implemented for B1 and B2
as described in §A.7 / §B.7. The EU-origin scope question in §B.5 remains
**OPEN and undecided** — it is not resolved by this memo.

**Date:** 2026-09-02
**Scope:** `app.emission_determination_matches_regulatory_record`
(the DEFAULT branch), migrations v6 → v8.
**Not in scope:** the resolver (`src/domain/regulatory/resolve-default-value.ts`),
which is protected and is **not changed** by this memo.

---

## A. B1 — Route binding

### A.1 Current behaviour

The validator requires the *matched record's* route to equal the
*line's declared* route:

```sql
-- v8 line 357 (introduced in v6)
if v_source_route_code is distinct from p_production_route_indicator then
    return false;
end if;
```

`v_source_route_code` comes from the determination's own
`record_identity.source_production_route_code` (line 276);
`p_production_route_indicator` is the line's declared route column.

**Reproduced** against real Postgres with a positive control and
single-variable isolation, inside rolled-back transactions:

| Case | Validator |
|---|---|
| Real persisted determination, unmodified (**positive control**) | **True** |
| Record `AL / 2523 10 00 90`, route `(A)`; line **declares** `(A)` | **True** |
| Same record; line declares **no** route | **False** |

The resolver, given no route, resolves exactly that record.

### A.2 Intended invariant

From v6's own header, the attack it set out to close was: an importer
attaching a *route-specific* record's value to a line that declares no
route, thereby "claim[ing] a specific production route's value without
the line ever actually declaring that route was used."

Generalised, the invariant v6 wanted is:

> **A persisted determination must be one the resolver would actually
> have produced for this line's declared inputs.**

The route equality check is a *proxy* for that invariant, not the
invariant itself.

### A.3 Why resolver and validator disagree

The resolver's selection rule (`usableExact`,
`resolve-default-value.ts:487-504`) admits a candidate when:

```
usable AND ( no route requested
             OR candidate route IS NULL
             OR candidate route = requested route )
```

then requires the surviving set to have **exactly one** member —
`> 1` returns `AMBIGUOUS`, never an arbitrary pick. So with no route
requested, a route-specific record **is** a legal selection, and
*uniqueness* is what prevents silent substitution.

The validator replaced "uniqueness" with "string equality". That proxy
is **sound but incomplete**: it rejects every legitimate
unique-route-specific resolution.

### A.4 The evidence that settles it

Measured against the ACTIVE dataset (`2026-definitive-corrected`),
grouping usable (`total_status = 'AVAILABLE'`) records by
(country, source_trade_code):

| Group | Count |
|---|---|
| Unique usable record, and it is **route-specific** | **6,487** |
| **More than one** usable record | **0** |
| Unique usable record, route-independent | 4,423 |

Two consequences:

1. **6,487 pairs** resolve legitimately and are then rejected by the
   validator — including every aluminium row.
2. **The route-substitution attack v6 imagined does not exist in this
   dataset.** It requires a pair with two or more usable records so an
   attacker could pick the favourable one. There are none.

And decisively — **v6's own attack fixture is one of the 6,487**:

```
Azerbaijan / 7207 12 90
   route '(E)'  value 0.130  AVAILABLE     <- the only usable record
   route  NULL  value NULL   REFERENCE_REQUIRED
```

The importer in v6's reproduction was not forging anything. They were
receiving **the only value the resolver could ever produce for that
line**. v6 misclassified a legitimate resolution as an attack, and v7
and v8 inherited the misclassification.

### A.5 Regulatory basis (nothing invented)

- **R6 — Production route:** "A source production route is preserved
  exactly as supplied. **No route is invented during ingestion or
  resolution.** If a source record has no production route,
  route-specific matching is not required for that record."
- **R10:** "If more than one applicable record remains after applying
  specificity, country and route rules, resolution must return
  `UNRESOLVED`. The resolver must never choose an arbitrary record based
  on array order."

Neither rule requires a declarant to *declare* a route, and R10 makes
uniqueness the operative safeguard. The UI correspondingly labels the
field "Production route (optional)".

### A.6 Recommended semantic rule

**Validate the resolved record against the line's declared inputs, by
re-deriving uniqueness — not by string-comparing the route.**

Concretely, for the DEFAULT branch:

1. If the line **declares** a route, the claimed record must be either
   route-independent or that exact route. (Retains v6's protection
   verbatim for declared-route lines.)
2. **Regardless**, the claimed record must be the **unique** usable
   candidate the resolver could have selected for this country at this
   record's specificity level, under the line's declared route filter.

### A.7 Security consequence

Strictly **stronger**, not weaker:

- It still rejects a claim whose record is not a real dataset row
  (unchanged: sheet/row/code/country/route pinning plus byte-exact value
  matching already do this).
- It **additionally** rejects a claim the resolver would have called
  `AMBIGUOUS`. Under v6/v8, if a pair ever had two usable records, an
  attacker could declare the favourable route and the string comparison
  would **accept** it. The uniqueness rule rejects it.

The only claims newly accepted are those the resolver demonstrably
produces — i.e. the forgery surface shrinks.

### A.8 Regulatory consequence

Restores the documented R6/R10 behaviour for 6,487 country/code pairs,
including 100% of aluminium. No regulatory value, route, threshold or
scope is invented; the value delivered is the only applicable one.

Leaving it unfixed would in practice *force* declarants to declare a
route in order to obtain any value at all — which R6 explicitly warns
against ("no route is invented"), and which the optional-field UI does
not ask for.

### A.9 Tests required

- Positive control: an existing accepted determination still validates.
- Route-blank line + unique route-specific record → **accepted**.
- Route-declared line + matching route-specific record → accepted.
- Route-declared line + **different** non-null route → rejected
  (v6's protection preserved).
- Synthetic two-usable-candidate case → **rejected** (new protection).
- Value tampering on an otherwise-valid claim → rejected.

---

## B. B2 — UNLISTED origin

### B.1 What UNLISTED represents

`CountryMappingOutcome` (`src/domain/emissions/types.ts:51-53`):

```ts
export type CountryMappingOutcome =
  | { status: "MAPPED"; regulatory_country_name: string }
  | { status: "UNLISTED" };
```

UNLISTED means: the line's declared ISO country has **no corresponding
geography in the regulatory dataset**. There is therefore no regulatory
country name to record — the absence is **intentional and meaningful**,
not an omission. Recording one would mean inventing a mapping.

Per **R7 clause 1**, such an origin resolves through
`_Other Countries and Territorie`.

### B.2 Current behaviour

The validator's `else` arm — which UNLISTED falls into — compares
against exactly that intentionally-absent key:

```sql
if v_origin_country_name is distinct from
   (v_resolution->'country_mapping'->>'regulatory_country_name') then
    return false;
end if;
```

The right-hand side is always SQL `NULL` for UNLISTED, and
`X IS DISTINCT FROM NULL` is always true. **Every UNLISTED
determination is rejected.**

**Reproduced, single variable:** taking a determination that validates
**True** and changing *only* `country_mapping` to `{"status":"UNLISTED"}`
returns **False**.

### B.3 Invariant the validator should enforce

Not a country-name match — there is no name to match. For an UNLISTED
claim the checkable invariant is:

1. The declared origin country is **genuinely unlisted** — no
   `countries` row for that ISO code in the dataset. (This is the part
   that must not be taken on trust: it stops a claim of "unlisted" for a
   country that *is* listed, which would sidestep its own value.)
2. The matched record's country is `_Other Countries and Territorie`.
3. The resolution reason is `OTHER_COUNTRIES_FALLBACK`.

All three are derivable from data already present. Nothing is invented.

### B.4 Why this is not scope broadening

R7 clause 1 already prescribes the fallback; the resolver already
implements it; `pnpm regulatory:verify` is VALID. Only the *persistence*
path was dead. Fixing the validator restores the documented behaviour —
it does not extend it.

### B.5 EU-origin interaction — **OPEN, NOT DECIDED HERE**

EU member states are absent from the dataset's 122 geographies, so they
map to UNLISTED and resolve through the same R7 fallback as a genuine
third country. **CBAM does not apply to EU-origin goods at all.**

This gap is pre-existing and already escalated (`MASTER_PLAN.md` §41;
`types.ts:40-50`; release report §35). It is **not created** by this
memo — but it must be stated plainly that fixing B2 **makes EU-origin
determinations persistable again**, where the B2 defect was incidentally
preventing them.

Three options were considered:

| Option | Verdict |
|---|---|
| Fix B2, exclude EU origins with a country list | **Rejected** — a hardcoded EU list is exactly the invented regulatory scope CLAUDE.md forbids. In-scope/out-of-scope must enter as a versioned dataset. |
| Leave B2 broken as an accidental safeguard | **Rejected** — a bug is not a control, and it blocks every legitimate unlisted third country too. |
| Fix B2; keep the EU scope question open and escalated | **Chosen** |

**Explicitly known:** UNLISTED is intentional; R7 clause 1 governs the
fallback; the resolver implements it correctly.

**Explicitly unresolved:** whether an EU-origin line should be
determinable at all, and how in-scope/out-of-scope should enter the
system as authoritative data. **Owner decision required before real
declarant use.** No implementation in this memo assumes an answer.

### B.6 Security consequence

Strictly stronger than today's behaviour on the dimension that matters:
today the branch is dead (rejects everything, including legitimate
claims); afterwards it actively verifies that a claimed "unlisted"
origin really is unlisted — a check that did not previously exist
anywhere.

### B.7 Tests required

- Genuinely-unlisted origin + Other-Countries record + fallback reason
  → **accepted**.
- **Listed** country claiming `UNLISTED` → **rejected** (the new check).
- UNLISTED claim whose matched record is *not* the Other-Countries row
  → rejected.
- UNLISTED claim with a reason other than `OTHER_COUNTRIES_FALLBACK`
  → rejected.
- MAPPED path unchanged (positive control).

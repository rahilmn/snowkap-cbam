# Replacing the Annex II sector proxy with a versioned applicability dataset

Status: **HIGH-RISK REGULATORY FOLLOW-UP — open.**
Written 2026-09-03 (P14.2, Gate 6). Requirements only; nothing here is
implemented, and D1 is not being changed or removed by this document.

---

## 1. What exists today, exactly

Owner decision **D1** (2026-09-03) made Annex II goods direct-only:
`RULE-EE-004`, from Regulation (EU) 2023/956 Article 7(1) sentence 2 —
"For goods listed in Annex II only direct emissions shall be calculated
and taken into account." That rule is a genuine regulatory fact already
in the register, and it is correctly applied.

**How the engine decides whether a good IS an Annex II good is not.**
`src/domain/calculations/calculate-line-emissions.ts`:

```ts
const ANNEX_II_SECTORS: ReadonlySet<string> =
  new Set(["IRON_STEEL", "ALUMINIUM"]);
```

The membership test is `goodSector !== null && ANNEX_II_SECTORS.has(goodSector)`,
where `goodSector` is the `sector` column on the good's `cbam_goods` row.

`sector` is a real regulatory fact from the dataset, so nothing here is
invented. But it is a **sector-level proxy for a CN-code-level list**,
and the two are not the same thing.

### The blast radius, measured

`cbam_goods` in the ACTIVE dataset (`2026-definitive-corrected`):

| Sector | Goods | Treated as Annex II by the proxy |
|---|---|---|
| IRON_STEEL | 221 | yes |
| ALUMINIUM | 24 | yes |
| FERTILISERS | 29 | no |
| CEMENT | 8 | no |
| HYDROGEN | 1 | no |
| **Total** | **283** | **245 (86.6%)** |

So the proxy asserts Annex II membership for 245 of 283 goods without
ever having read Annex II.

## 2. Why this became more dangerous on the day D1 landed

Before D1, the same set was used as a **fail-closed** gate: an ACTUAL
line on an iron/steel or aluminium good with non-zero indirect emissions
returned `PARAMETER_DATASET_UNAVAILABLE` and produced no number. An
over-broad proxy therefore caused a **refusal** — visible, safe, and
annoying.

After D1 the same set makes a good **direct-only**, which *lowers* the
figure. The failure mode inverted:

| Proxy error | Before D1 | After D1 |
|---|---|---|
| Good wrongly INSIDE Annex II | refused to calculate | **indirect emissions silently dropped → under-reported** |
| Good wrongly OUTSIDE Annex II | indirect included | indirect included → over-reported |

Under-reporting a filed CBAM declaration is the direction that matters,
and it now happens silently, with a complete and internally consistent
`ANNEX_II_DIRECT_ONLY` trace step attesting to it.

This is **not** an argument to reverse D1. D1 is the correct treatment
for goods that really are in Annex II. It is an argument that the
membership test must stop being a proxy.

**Mitigating, and worth stating fairly:** the trace records the excluded
figure as `indirect_specific_excluded`, so a reader of a frozen
calculation can see exactly what was left out and recompute the
alternative by hand. The error is discoverable after the fact; it is
just not prevented.

## 3. Requirements for the replacement

### R1 — It is a dataset, not a list in code

Per the facts-as-datasets rule (`CLAUDE.md`, `ARCHITECTURE.md`): the
Annex II membership fact enters through a versioned `regulatory_datasets`
row, exactly as the default emission values did. No CN code may be typed
into TypeScript.

### R2 — Source

Annex II of Regulation (EU) 2023/956, obtained from EUR-Lex and stored
as a raw artifact under `data/`, with its checksum recorded in
`regulatory_sources`. The text must be **read**, not recalled — the same
requirement the R7/R9 memo places on CELEX:32025R2621 and
CELEX:32026R1740, and for the same reason.

### R3 — Schema

`regulatory_datasets.dataset_type` currently permits only:

```
CBAM_GOODS, DEFAULT_EMISSION_VALUES, CBAM_BENCHMARKS, CBAM_FACTORS,
CSCF, CERTIFICATE_PRICES, COUNTRIES, EXEMPTIONS
```

A new value — `ANNEX_II_APPLICABILITY` — must be added by a new
migration. A new product-schema table holds the rows:

| Column | Notes |
|---|---|
| `dataset_id` | FK to `regulatory_datasets` |
| `cn_code` | the code as published, at the granularity Annex II uses |
| `code_level` | so a CN4/CN6/CN8 entry is not silently compared against a CN8 line |
| `in_annex_ii` | explicit boolean; absence must never be read as "no" |
| `source_row` / `source_reference` | provenance, matching the existing `record_identity` convention |

Authenticated `SELECT` only, matching the other regulatory tables — no
INSERT policy for any API role.

### R4 — Resolution must be able to say "I do not know"

The resolver returns a discriminated outcome, never a boolean:

- `IN_ANNEX_II` — matched an entry with `in_annex_ii = true`
- `NOT_IN_ANNEX_II` — matched an entry with `in_annex_ii = false`
- `UNRESOLVED` — no entry matched this CN code at this level

`UNRESOLVED` **must not** be silently treated as either. The existing
protected-zone rule applies verbatim: never convert "no value" into a
value, never pick among ambiguous candidates. The product decision for
what `UNRESOLVED` does — refuse to calculate, or calculate with indirect
included and disclose — is an **owner decision**, not an implementation
detail.

### R5 — Matching rule must be explicit and registered

Annex II may list goods at a coarser granularity than a shipment line's
CN8. The prefix/hierarchy rule (does CN8 `72061000` inherit from a CN4
`7206` entry?) must be written into
`docs/regulatory/REGULATORY_RESOLUTION_RULES.md` with its own rule id and
citation before it is implemented — the same discipline R7 clause 1
received. It must not be inferred from the data's shape.

### R6 — Engine change

`ANNEX_II_SECTORS` is deleted. `calculateLineEmissions` receives the
resolved outcome from R4 rather than a sector string, exactly as it
already receives `good_sector` today — the engine stays pure and the
lookup stays in the application layer.

### R7 — Engine version

The membership test changing changes calculation semantics, so
`ENGINE_VERSION` bumps (1.3.0 → 1.4.0) per the project rule.
**Historical 1.3.0 rows are not rewritten.** `ENGINE_VERSION_CHANGED` on
older rows is the correct and expected outcome.

### R8 — Tests, written first

- A golden fixture per outcome (`IN_ANNEX_II`, `NOT_IN_ANNEX_II`,
  `UNRESOLVED`), hand-derived from the source text, never generated by
  running the engine.
- A regression test proving a good the **proxy** classified as Annex II
  but the **dataset** does not is now calculated with indirect included
  — i.e. the specific under-reporting this document describes.
- `pnpm regulatory:verify` extended to reconcile the new dataset
  field-by-field, and required to return `RESULT: VALID`.

### R9 — Protected-zone discipline

The loader and verifier live in `scripts/regulatory/` and are
**protected**. The change is a new dataset version plus a new activation
migration; no applied migration or existing dataset is edited in place.
Per ADR-0013 this is a material regulatory behaviour change and
therefore an **owner escalation**, not work that proceeds inside an
approved phase.

## 4. Until then

Recorded in `P14_FINAL_RELEASE_AUDIT.md` as a **HIGH-RISK REGULATORY
FOLLOW-UP**. Specifically **not** classified as solved, and specifically
not a reason to remove or weaken D1.

The honest one-line statement, which should appear anywhere D1 is
described:

> Annex II membership is currently determined by a sector-level proxy
> (`IRON_STEEL`, `ALUMINIUM`) rather than an exact versioned Annex II CN
> applicability dataset. A good wrongly inside that proxy has its
> indirect emissions silently excluded from the CBAM figure.

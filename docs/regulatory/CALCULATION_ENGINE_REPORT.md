# Calculation engine — implementation report

**Date:** 2026-09-02
**Scope:** what the backend *actually implements*, read from source, not
from the plan. Every formula below appears verbatim in code or in a
registered rule. **No calculation behaviour was changed to produce this
report.**

**Authoritative sources read:**
`src/domain/calculations/calculate-line-emissions.ts`,
`src/domain/calculations/types.ts`,
`src/domain/shared/decimal.ts`,
`src/application/reporting/build-period-summary.ts`,
`src/application/reporting/list-period-shipment-lines.ts`,
`docs/regulatory/CALCULATION_RULE_REGISTER.md`.

---

## 1. Surface area — smaller than the plan implies

The engine is **one pure function**:

```ts
calculateLineEmissions(line): LineEmissionsCalculation
```

`src/domain/calculations/` contains exactly two non-test files
(`calculate-line-emissions.ts`, `types.ts`). There is **no** shipment-level
calculation, no certificate calculation, and no liability calculation
implemented. Aggregation above the line lives in the reporting layer.

Pure by construction: no I/O, no clock, no environment. `good_sector` is
looked up by the *caller* precisely so the engine performs no I/O.

---

## 2. Implemented formulas — both of them

### RULE-EE-001 — DEFAULT path

```
line_embedded_emissions = quantity × resolution.values.total.value
```

Uses the regulatory dataset's **pre-summed `total`**; it deliberately
does *not* re-derive direct+indirect.

### RULE-EE-009 — ACTUAL path

```
line_embedded_emissions = quantity × (direct_specific + indirect_specific)
```

`ActualEmissionSnapshot` carries no pre-summed total, so the summation
(Annex IV point 2/3's `AttrEm_g = DirEm + IndirEm`) is performed here.

**That is the complete set.** Nothing else is computed anywhere.

---

## 3. Inputs, units, conversions

| Input | Source | Type |
|---|---|---|
| `net_mass_tonnes` | shipment line | `DecimalString \| null` |
| `quantity_mwh` | shipment line | `DecimalString \| null` |
| `emission_determination` | shipment line (frozen snapshot) | discriminated union |
| `good_sector` | caller-supplied `cbam_goods.sector` | `string \| null` |

`quantity = net_mass_tonnes ?? quantity_mwh`. Exactly one is non-null
(enforced upstream by `isLineQuantityValid`); the engine still throws
loudly if both are null rather than assuming.

**There are no unit conversions.** The engine never converts kg→t, MWh→TJ,
or anything else. It *validates* that the emission unit's basis matches
the quantity basis and refuses to compute otherwise. This is deliberate:
converting would mean choosing a factor, and an unconvertible unit must
surface, not be silently coerced.

### `unitMatchesQuantityBasis` — the guard, and two bugs it has already caught

- **Numerator** must be tonnes-of-CO2e (`TCO2E`/`TCO2`), anchored on this
  codebase's two separator conventions (`/` or `_PER_`). Added after a
  P13 audit live-reproduced `kgCO2e/t` being accepted and computed as if
  `tCO2e/t` — a **1000× overstatement**.
- **Denominator**: `/T` counts only when *not* followed by another
  letter/digit, so `/T` and `/t` match while `/TJ`, `/TWh`, `/Th` do not.
  An earlier bare-substring version accepted `tCO2/TJ` (the standard EU
  ETS MRR denominator) as mass-basis and fabricated a number.

The two sides differ in trustworthiness, and the code says so: the
DEFAULT path's `emission_unit` is DB-constrained to
`{TCO2E_PER_TONNE, TCO2_PER_MWH}`, while the ACTUAL path's producer-entered
unit is **free text with no constraint**. The guard is explicitly
documented as a stop-gap until an allow-list exists at entry.

---

## 4. Precision and rounding

A module-local Decimal clone in `src/domain/shared/decimal.ts`:

```
precision: 40
rounding: ROUND_HALF_UP
```

Regulated numerics are `DecimalString` (branded text) end to end —
**never** JS `number`. Full precision is persisted; the engine performs
**no rounding of its own** and applies no declaration rounding rule.

**Open question (unresolved):** whether 40 significant digits is the
correct arithmetic bound, and whether declared quantities should carry a
digit cap. No cited source establishes either.

---

## 5. Factor selection and regulatory dependency

The engine **selects nothing**. It consumes a frozen determination that
the regulatory resolver already produced:

- **DEFAULT** → `RegulatoryResolutionSnapshot`, carrying dataset id +
  version, record identity (sheet/row/trade code/country/route), all
  three values with statuses, emission unit, and the R12 trace.
- **ACTUAL** → `ActualEmissionSnapshot`, carrying emission-data id +
  version, values, unit, methodology, verification state and verifier,
  evidence ids, and the sharing-grant id when read cross-org.

Factor selection is entirely the resolver's (R5 specificity, R6 route,
R7 country fallback, R10 uniqueness). Since the engine reads only the
snapshot, a later dataset activation or supersession **cannot** change a
historical result.

---

## 6. Snapshot / freeze behaviour

- The determination is frozen at determination time, not calculation time.
- `calculation_results` is **append-only**; recalculation inserts a new row.
- Determinations are validated on write by
  `app.emission_determination_matches_regulatory_record` (now **v9**),
  which re-derives the resolver's uniqueness rule rather than trusting
  the claim.
- The ACTUAL path re-checks `verification.status === "VERIFIED"` **at
  runtime**, even though it is `Extract<VerificationStatus,"VERIFIED">` at
  the type level — because the snapshot round-trips through untyped
  `jsonb` and is read back through an unchecked cast. Defence in depth
  against a compile-time fiction.

---

## 7. Engine versioning

`ENGINE_VERSION = "1.2.0"`.

Bumped 1.1.0 → 1.2.0 for the numerator-validation fix. **Honestly
recorded in the source:** three earlier behavioural changes (the original
`UNIT_UNSUPPORTED` guard, the `/T` substring fix, the `ANNEX_II_SECTORS`
gate) shipped **without** a bump — so "same inputs + engine_version ⇒
byte-identical output" is *not* true of every historical row carrying
`1.1.0`. That cannot be retroactively fixed without rewriting
append-only history, which would violate the invariant the column exists
to protect.

---

## 8. Status propagation — nothing is coerced to a number

`CalculationStatus`:

| Status | Emitted when |
|---|---|
| `COMPUTED` | a value was produced |
| `INPUT_UNRESOLVED` | no determination on the line |
| `VALUE_UNAVAILABLE` | DEFAULT: resolved `total` not `AVAILABLE`; ACTUAL: snapshot not `VERIFIED` |
| `UNIT_UNSUPPORTED` | emission unit's basis does not match the quantity basis |
| `PARAMETER_DATASET_UNAVAILABLE` | the Annex II gate (below) |

A non-`COMPUTED` result carries **no** `embedded_emissions_tco2e` field
at all — the type makes "unavailable but has a number" unrepresentable.
Nothing is defaulted to zero anywhere.

### The Annex II gate

`ANNEX_II_SECTORS = {IRON_STEEL, ALUMINIUM}`. On the ACTUAL path, if the
good's sector is in that set **and** `indirect_specific` is non-zero, the
engine returns `PARAMETER_DATASET_UNAVAILABLE` rather than computing.

RULE-EE-004 requires Annex II goods to use direct emissions only;
RULE-EE-009 sums direct+indirect. With no Annex II CN-code dataset in the
schema, the engine uses the existing `cbam_goods.sector` regulatory fact
as a **conservative sector-level proxy** and refuses to compute, rather
than computing a figure it cannot justify. It correctly does *not* block
when `indirect_specific` is zero, since direct + 0 already equals the
Annex II-correct value.

**This is a hardcoded two-sector set in engine code** — flagged by the
adversarial review, and an acknowledged deviation from facts-as-datasets,
made deliberately as a gate rather than a computation.

---

## 9. Not implemented (correctly, and stated as such)

`certificates_due` and `liability` exist in `CalculationOutputs` and are
**always `null`**. Markups, benchmarks, certificate prices and exemption
thresholds require parameter datasets that do not exist. The code
separates embedded-emissions calculation from liability estimation and
never conflates them. `parameter_datasets` is consequently always `[]`.

---

## 10. Aggregation

**Line → period** (there is no shipment-level aggregate). In
`build-period-summary.ts`, `Decimal`-precision summation over **only**
lines that produced a value:

```
total_embedded_emissions_tco2e = Σ line.embedded_emissions_tco2e
```

`null` when no line computed. Four breakdowns (CN code, country, route,
determination method) use the same accumulator. Non-computed lines
contribute nothing and are not treated as zero.

**Fixed 2026-08-31:** the queries feeding this were truncating silently
at PostgREST's `max_rows` (1000), understating the total with
`error: null`. Now paged with stable ordering.

---

## 11. Worked examples from the actual tests

From `calculate-line-emissions.test.ts` and live production verification:

| Case | Inputs | Result |
|---|---|---|
| DEFAULT, exact match | quantity `2`, total `1.390 TCO2E_PER_TONNE` | `2.780` COMPUTED |
| DEFAULT, live production journey | CN `25232100`, origin CN, 2 t | `2.8` tCO2e, full "Why this number?" chain |
| ACTUAL | quantity `10`, direct `0.155`, indirect `0.045` | `2.00` COMPUTED |
| ACTUAL, Annex II with indirect ≠ 0 | sector `ALUMINIUM`, indirect `0.045` | `PARAMETER_DATASET_UNAVAILABLE` |
| Unit trap | `kgCO2e/t` | `UNIT_UNSUPPORTED` (was a 1000× overstatement) |
| Unit trap | `tCO2/TJ` | `UNIT_UNSUPPORTED` (was silently accepted) |
| No determination | — | `INPUT_UNRESOLVED` |

---

## 12. Open questions — no rule proposed for any of these

1. Is 40 significant digits the correct precision bound, and should
   declared quantities carry a digit cap?
2. Should Annex II membership enter as a versioned dataset rather than
   the hardcoded sector proxy?
3. May an ACTUAL dataset whose reporting period differs from the
   shipment's be used at all? No register entry answers this.
4. Should a line whose calculation predates its current determination be
   excluded from the period total, or included and flagged? Either
   answer changes a reported number.
5. Does the definitive-regime start year warrant its own dataset row
   rather than a domain constant?

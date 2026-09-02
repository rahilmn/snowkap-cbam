# Calculation engine golden fixtures — engine 1.3.0

Every `expected` value in this directory was derived **by hand**, from
the source regulatory dataset and from arithmetic done separately, and
then written down. **None of it was produced by running the engine and
recording what came out.**

That distinction is the entire value of these files. A fixture generated
from the implementation reproduces the implementation's bugs perfectly
and pins them in place; it can only ever catch a change, never a
mistake. These fixtures can catch a mistake, because they were written
from the rule and the data, not from the code.

Consequently:

- **Never regenerate these files.** If a fixture fails, either the
  engine changed behaviour or the fixture was wrong. Both need a human
  to decide which, with the rule register open. "Update the golden" is
  not a fix.
- **A version bump forces re-derivation.** The runner asserts
  `ENGINE_VERSION === "1.3.0"`. Bumping the engine deliberately breaks
  this suite so the expected values are re-derived by hand for the new
  version rather than carried forward on the assumption that nothing
  moved.

## What the values are, and where they come from

Numbers are **byte-exact `DecimalString`s**, not numeric equivalents.
The engine returns `Decimal.toFixed()` with no argument, which drops
trailing zeros, and `reproduceCalculationResult` compares stored against
recomputed with `===`. So `10 × 0.2` is `"2"`, never `"2.000"` — and a
fixture written as `"2.000"` would be wrong even though it is the same
number.

Regulatory inputs are real rows from the ACTIVE
`2026-definitive-corrected` dataset, verified against production on
2026-09-02:

| Origin | CN | Sheet | Row | Direct | Indirect | Total |
|---|---|---|---|---|---|---|
| China (`CN`) | `25232100` | `China` | 7 | 1.250 | 0.140 | 1.390 |
| unlisted (`KI`) | `25070080` | `_Other Countries and Territorie` | 4 | — | — | 0.280 |

Two fixtures are labelled `synthetic` in their own `note`: they exercise
engine branches (`TCO2_PER_MWH`, a `NOT_APPLICABLE` total) that the
ACTIVE dataset contains **no rows for** — 12,540 of 12,540 rows are
`TCO2E_PER_TONNE` with an available total. They are honest tests of the
code path, not claims about the data.

## What these fixtures catch that nothing else does

- A formula error: direct vs total, a wrong operator, a sign.
- Dispatching an ACTUAL determination down the DEFAULT path, or the
  reverse.
- Precision or rounding-mode drift (`decimal.js` is configured to
  precision 40, `ROUND_HALF_UP`).
- `toFixed()` drift — a change to a fixed number of decimal places would
  break byte-equality with every stored calculation ever persisted.
- Unit-matcher regressions, including the 1000× overstatement class that
  `kgCO2e/t` produced before the numerator was checked.

## What they do NOT catch

Regulatory **dataset** drift. These fixtures carry the dataset's values
inline; they cannot tell you the dataset changed underneath them. That
is covered separately by the local-Supabase resolver assertions in
`tests/integration/regulatory-resolution.test.ts` and by
`pnpm regulatory:verify` against the live project.

## Recorded, deliberate behaviours (not endorsements)

Three fixtures pin outcomes that are written down as open or defective
rather than as settled:

- `tCO2e/t/yr` and `tCO2e/t-year` currently **COMPUTE**. The
  denominator test `/T(?![A-Z0-9])` admits any non-alphanumeric suffix,
  so a per-year intensity is accepted as a per-tonne one. Recorded as a
  follow-up defect. The fixture documents today's behaviour and must be
  flipped, deliberately, when it is fixed.
- `tCO2/t` computes, treating CO2 as CO2e. That is a written decision in
  the engine, not an oversight — and an open owner question, because CO2
  and CO2e differ materially for aluminium PFCs and fertiliser N2O.
- **The Annex II direct-only treatment (owner decision D1, 2026-09-03).**
  An ACTUAL determination on an iron/steel or aluminium good computes
  from direct emissions alone, per Article 7(1) sentence 2
  (RULE-EE-004). Until 1.3.0 the same case returned
  `PARAMETER_DATASET_UNAVAILABLE` and produced no number at all, which
  blocked a legitimate workflow because indirect data merely existed.

  The membership test is `cbam_goods.sector`, a **proxy**: Annex II is a
  CN-code-level list, and no such dataset exists in this project yet.
  While the proxy refused, its imprecision was conservative. Now that it
  applies an exclusion, the same imprecision points the other way — a
  good in these sectors that is not actually in Annex II would be
  **under-reported**. That is the accepted cost of the decision, and it
  is recorded here, in the calculation rule register, and in the release
  report rather than left to be found in a wrong number.

  Fixtures pin both directions: the treatment applies for those sectors,
  does NOT apply for cement, and does NOT apply when the sector could not
  be resolved at all. The `ANNEX_II_DIRECT_ONLY` step is emitted even
  when indirect emissions are already zero, where the arithmetic is
  identical but the trace is not.

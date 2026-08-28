# CBAM Calculation Rule Register

## Purpose

Mandatory precondition for `src/domain/calculations/` (P6 of `docs/plans/MASTER_PLAN.md`
§17: "no register, no engine"). Every rule the calculation engine implements must have an
entry here, with a citation to the authoritative text it was taken from — never inferred
from general CBAM knowledge, training data, or analogy to other carbon-pricing schemes.
An engine trace step (`{step, rule_ref, formula, inputs, value}`) cites a rule ID from
this register. A rule absent from this register cannot be coded.

See `docs/regulatory/SOURCE_REGISTER.md` for the full source hierarchy and provenance
rules this register operates under.

## How this register was built

Every formula below was read directly from the operative text of Regulation (EU)
2023/956 (the CBAM Regulation), consolidated version incorporating amending Regulation
(EU) 2025/2083, as published via EUR-Lex / Climate Policy Radar
(`https://eur-lex.europa.eu/eli/reg/2023/956/oj/eng`,
`https://cdn.climatepolicyradar.org/navigator/EUR/2023/regulation-eu-2023-956-establishing-a-carbon-border-adjustment-mechanism-amended-by-regulation-eu-2025-2083-cbam_4cc762319b9a9fd0e05ea0a09973768c.pdf`).
The formulas in Annex IV are typeset as embedded images in the source PDF (not
machine-extractable as text); each was verified by rendering the relevant PDF page as an
image and reading the rendered equation directly — not inferred from surrounding prose.
Article numbers, Annex points, and quoted definitions below are transcribed from that
same source. This register does **not** yet incorporate the five Commission Implementing
Regulations already tracked in `SOURCE_REGISTER.md` (2025/2547, 2025/2620, 2025/2621,
2026/1740, 2025/2546) — those govern default-value determination detail, system
boundaries, and mark-up methodology, which enter the system as **dataset content**
through the existing regulatory pipeline (`scripts/regulatory/`), not as calculation
**formulas** the engine itself needs to encode. If a future rule requires reading one of
those acts directly, it must be fetched and cited here with the same rigor before
implementation, not assumed.

---

## RULE-EE-001 — Line embedded emissions from a DEFAULT determination

- **Classification**: APPLICATION DESIGN DECISION, combining two REGULATORY FACTs.
- **Authoritative regulation**: Regulation (EU) 2023/956.
- **Implementing/delegated act**: none directly (default *values* come from the
  implementing acts tracked in `SOURCE_REGISTER.md`, already reflected in the versioned
  `default_emission_values` dataset — see below).
- **Article/Annex/section**: Article 7(1) sentence 1 ("Embedded emissions in goods shall
  be calculated pursuant to the methods set out in Annex IV."); Annex IV point 1(c)
  (definition of "specific embedded emissions" as "the embedded emissions of one tonne of
  goods, expressed as tonnes of CO2e emissions per tonne of goods"); Article 7(2)(b) and
  Annex IV point 4.1 (default-value method).
- **Effective period**: current (definitive regime, from 2026-01-01; the structural
  formula is unchanged from the transitional-period text).
- **Applicability**: a shipment line whose `emission_determination.method === "DEFAULT"`
  (`src/domain/emissions/types.ts`) — i.e. a P5 `RegulatoryResolutionSnapshot` exists.
- **Inputs**: `quantity` (the line's `net_mass_tonnes` in tonnes, or `quantity_mwh` in
  MWh for an electricity good — `src/domain/shipments/types.ts`); `resolution.values.total`
  (the resolved specific embedded emissions, `RegulatoryValue` with `status: "AVAILABLE"`
  — engine input only when `AVAILABLE`, per RULE-EE-005).
- **Units**: tonnes × tCO2e/tonne = tCO2e for mass goods; MWh × tCO2e/MWh = tCO2e for
  electricity (definition (e): "emission factor for electricity... expressed in CO2e,
  representing the emission intensity of electricity consumed"). Unit mismatch between a
  line's quantity kind and the good's `functional_unit` is already rejected earlier, at
  classification (`QUANTITY_UNIT_MISMATCH`, P4) — the engine never receives a mismatched
  pair.
- **Formula**: `line_embedded_emissions = quantity × resolution.values.total.value`.
  Design rationale for using `total` rather than re-deriving `direct + indirect` in
  application code: Annex IV point 1(c) defines specific embedded emissions generically
  as a single per-tonne quantity; Annex IV points 2–3 (RULE-EE-002/003) show that for the
  *actual*-emissions method the "attributed emissions" a specific value is built from are
  already `DirEm + IndirEm` summed *before* division by activity level. The regulatory
  dataset's own `total_emissions` field (verified live: for CN 25232100 ex China,
  direct 1.250 + indirect 0.140 = total 1.390 exactly) is the authoritative,
  already-published total — recomputing it from direct+indirect in application code
  would risk silently reproducing it incorrectly, particularly for Annex II goods (see
  RULE-EE-004) where indirect must be excluded; trusting the dataset's own total avoids
  that risk entirely and keeps the regulatory fact-vs-application-logic boundary exactly
  where CLAUDE.md requires it.
- **Rounding rule**: none. Full `Decimal` precision (`src/domain/shared/decimal.ts`,
  `Decimal.clone({precision: 40, rounding: HALF_UP})`) is carried through and persisted;
  Article 7(7) delegates a "declaration rounding" specification to a future implementing
  act not yet fetched or cited here — per `docs/plans/MASTER_PLAN.md` §17/§41, that
  extraction is a P9 precondition, not P6's. Never rounded before P9 implements it.
- **Exceptions**: none at this rule's level — REFERENCE_REQUIRED/UNAVAILABLE/
  NOT_APPLICABLE/AMBIGUOUS/NO_MATCH resolutions never reach this rule at all (P5 never
  persists a determination for them; RULE-EE-005 governs the explicit non-computable
  states the engine must return instead).
- **Source URL**: `https://eur-lex.europa.eu/eli/reg/2023/956/oj/eng` (Article 7, Annex
  IV points 1(c) and 4.1).
- **Golden regression fixture**: `src/domain/calculations/*.test.ts` (to be authored with
  the engine) — exact CN8 match with a MAPPED country (mass good), OTHER_COUNTRIES_FALLBACK
  with an UNLISTED country (mass good), and an electricity good (MWh basis).

## RULE-EE-002 — Actual specific embedded emissions, simple goods

- **Classification**: REGULATORY FACT.
- **Authoritative regulation**: Regulation (EU) 2023/956.
- **Article/Annex/section**: Article 7(2)(a); Annex IV point 2 ("Determination of actual
  specific embedded emissions for simple goods").
- **Effective period**: current.
- **Applicability**: P7 scope — an operator-measured `EmissionData` record for a "simple
  good" (Annex IV point 1(a): "goods produced in a production process requiring
  exclusively input materials (precursors) and fuels having zero embedded emissions").
  **Not implemented in this phase (P6)** — registered now because the formula was
  captured during this phase's research; P7's DoD still requires its own implementation,
  tests, and (per master plan §38) mandatory Opus review before use.
- **Inputs**: `AttrEm_g` (attributed emissions of goods g, tCO2e); `AL_g` (activity
  level — quantity of goods g produced in the reporting period at that installation).
- **Units**: tCO2e ÷ tonnes = tCO2e/tonne.
- **Formula** (verified from the rendered equation image, Annex IV point 2):
  `SEE_g = AttrEm_g / AL_g`, where `AttrEm_g = DirEm + IndirEm`
  — `DirEm` = direct emissions from the production process (tCO2e, within the system
  boundaries an implementing act under Article 7(7) defines); `IndirEm` = indirect
  emissions from electricity consumed in production (tCO2e, same system-boundary
  source).
- **Rounding rule**: not yet researched (deferred with RULE-EE-001's rounding note).
- **Exceptions**: none stated at this Annex point; Annex IV points 5–6 (conditions for
  using actual embedded emissions for imported electricity / indirect emissions) are
  separate, not-yet-registered rules relevant to P7.
- **Source URL**: `https://eur-lex.europa.eu/eli/reg/2023/956/oj/eng` (Article 7(2)(a),
  Annex IV point 2).
- **Golden regression fixture**: none yet (P7).

## RULE-EE-003 — Actual specific embedded emissions, complex goods

- **Classification**: REGULATORY FACT.
- **Authoritative regulation**: Regulation (EU) 2023/956.
- **Article/Annex/section**: Article 7(2)(a); Annex IV point 3 ("Determination of actual
  embedded emissions for complex goods").
- **Effective period**: current.
- **Applicability**: P7 scope — a "complex good" (Annex IV point 1(b): "goods other than
  simple goods"). **Not implemented in this phase.**
- **Inputs**: `AttrEm_g`; `AL_g`; `EE_InpMat` (embedded emissions of input materials/
  precursors consumed — only precursors listed in Annex I, originating in a third
  country, and not exempted under Annex III point 1, per the Annex text).
- **Units**: tCO2e ÷ tonnes = tCO2e/tonne.
- **Formula** (verified from the rendered equation image, Annex IV point 3):
  `SEE_g = (AttrEm_g + EE_InpMat) / AL_g`, where
  `EE_InpMat = Σ(i=1 to n) M_i · SEE_i`
  — `M_i` = mass of input material (precursor) i used in the production process;
  `SEE_i` = specific embedded emissions for precursor i, which "the operator of the
  installation shall use the value of emissions resulting from the installation where
  the input material (precursor) was produced, provided that that installation's data
  can be adequately measured" (Annex IV point 3, verbatim).
- **Rounding rule**: not yet researched.
- **Exceptions**: precursor SEE_i sourcing has its own fallback rules (not yet
  registered — P7 scope) for when the producing installation's data is not adequately
  measurable.
- **Source URL**: `https://eur-lex.europa.eu/eli/reg/2023/956/oj/eng` (Article 7(2)(a),
  Annex IV point 3).
- **Golden regression fixture**: none yet (P7).

## RULE-EE-004 — Annex II goods: direct emissions only

- **Classification**: REGULATORY FACT, applied upstream (data pipeline), not in the
  calculation engine.
- **Authoritative regulation**: Regulation (EU) 2023/956.
- **Article/Annex/section**: Article 7(1) sentence 2 ("For goods listed in Annex II only
  direct emissions shall be calculated and taken into account."); Annex II ("List of
  goods for which only direct emissions are to be taken into account, pursuant to
  Article 7(1)") — confirmed to begin with Iron and steel CN codes; the full Annex II
  code list was not transcribed in this pass (not needed at the engine layer, see
  Applicability).
- **Effective period**: current.
- **Applicability**: governs what the *published default-value dataset itself* contains
  for Annex-II goods (their `total_emissions` should already equal direct-only, with no
  indirect component, at the source). RULE-EE-001 already trusts the dataset's own
  `total_emissions` rather than recomputing `direct + indirect` in application code
  specifically *because* of this rule — recomputing would silently violate it for any
  Annex-II good. **No engine code implements this rule directly**; it is recorded here
  so the reasoning in RULE-EE-001 is traceable, and so that if the engine is ever
  changed to recompute totals from direct+indirect components, this exception must be
  reintroduced explicitly.
- **Inputs / Units / Formula / Rounding**: not applicable (upstream data-content rule,
  not a computation).
- **Exceptions**: none beyond the rule's own scope (Annex II membership).
- **Source URL**: `https://eur-lex.europa.eu/eli/reg/2023/956/oj/eng` (Article 7(1),
  Annex II).
- **Golden regression fixture**: covered indirectly by RULE-EE-001's fixtures using real
  dataset records; no dedicated fixture (no engine code to test against this rule
  specifically).

## RULE-EE-005 — Non-computable determinations produce explicit states, never zero

- **Classification**: APPLICATION DESIGN DECISION (a direct consequence of the
  REGULATORY FACT that UNAVAILABLE/REFERENCE_REQUIRED/NOT_APPLICABLE/AMBIGUOUS/NO_MATCH
  are real, distinct regulatory statuses — see `src/domain/regulatory/types.ts`'s
  `ValueStatus`/`ResolutionReason`, already governed by
  `docs/architecture/REGULATORY_RESOLUTION_RULES.md`, not re-derived here).
- **Applicability**: any line whose `emission_determination` is `null` (P5 never
  persists a determination for an UNRESOLVED result), or whose resolved
  `values.total.status !== "AVAILABLE"` (should not occur given P5's `buildResolutionSnapshot`
  only ever freezes a `RESOLVED` result with an AVAILABLE total — this rule is the
  engine's own defense-in-depth check, not a state P5 is expected to produce).
- **Formula**: none — the engine must return an explicit non-computable status
  (`INPUT_UNRESOLVED` or equivalent, per master plan §17's named states:
  `INPUT_UNRESOLVED`, `VALUE_UNAVAILABLE`, `REFERENCE_REQUIRED_UNRESOLVED`,
  `NOT_APPLICABLE`, `AMBIGUOUS_INPUT`, `PARAMETER_DATASET_UNAVAILABLE`,
  `UNIT_UNSUPPORTED`) and must never substitute zero, a default, or an estimate.
- **Source URL**: n/a (application-layer safety rule, not a citation to the Regulation).
- **Golden regression fixture**: to be authored with the engine — a line with no
  `emission_determination` must produce `INPUT_UNRESOLVED`, never a computed value.

## RULE-EE-006 — Precision and rounding (interim)

- **Classification**: APPLICATION DESIGN DECISION, pending a REGULATORY FACT not yet
  researched.
- **Applicability**: every calculation.
- **Finding**: the base Regulation (EU) 2023/956 text was searched in full for rounding/
  precision language; the only rounding rule it states anywhere is Article 2a/Annex VII's
  single mass-based threshold ("rounded to the nearest ten"), which is unrelated to
  embedded-emissions or declaration rounding. Article 7(7) delegates further
  specification of the calculation methods to future implementing acts — the
  declaration-specific rounding rule master plan §17/§41 anticipates therefore lives in
  an implementing act not yet fetched.
- **Interim rule** (DESIGN, not FACT): full `Decimal` precision
  (`src/domain/shared/decimal.ts`) is maintained through every calculation step and
  persisted in `CalculationResult`; no rounding is applied anywhere in `src/domain/
  calculations/`. Rounding is deferred entirely to presentation/declaration (P9), which
  must fetch and cite the actual implementing act before implementing any rounding.
- **Source URL**: `https://eur-lex.europa.eu/eli/reg/2023/956/oj/eng` (searched in full;
  Article 7(7), Article 2a/Annex VII).
- **Golden regression fixture**: a determinism/precision test asserting the engine never
  truncates or rounds a `DecimalString` value.

---

## Explicitly not yet registered (FUTURE-DEFERRED, per master plan §17/§37)

- Markup on default values (Article 7(2)(b)/Annex IV point 4.1's mark-up, "determined in
  the implementing acts adopted pursuant to Article 7(7)" — not yet fetched).
- Benchmark/free-allocation adjustment.
- CBAM certificate price (Article 9's carbon-price-paid-in-a-third-country reduction
  mechanism was read during this research pass — Article 9(1)–(4) — but certificate
  pricing/liability itself is out of P6's scope per master plan §17 and is not
  registered as an implementable rule here).
- Exemption/de-minimis thresholds.
- Default-value determination detail beyond the structural formula (Annex IV points
  4.2–4.3, electricity default values and indirect-emissions default methodology) — the
  *values themselves* already enter via the versioned `default_emission_values` dataset;
  only the *engine-facing structural formula* (RULE-EE-001) is registered here.

None of the above may be implemented from inference. Each requires its own research pass
against the actual implementing act text, its own register entry, and — per master plan
§38 — its own scoped review before any code is written.

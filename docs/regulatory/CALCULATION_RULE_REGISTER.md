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

**2026-08-29 update (P7 register-completion pass, owner-directed)**: two of those five
acts were fetched and read directly (via EUR-Lex, live) because RULE-EE-002/003's own
flagged gaps require calculation-methodology content, not dataset content, from them:
Commission Implementing Regulation (EU) 2025/2547 of 10 December 2025 ("laying down
rules for the application of Regulation (EU) 2023/956 ... as regards the methods for the
calculation of emissions embedded in goods" — the Article 7(7) methodology act; per its
recital (2) it supersedes the transitional Implementing Regulation (EU) 2023/1773, which
governed calculation methodology only for "the period lasting from 1 October 2023 until
31 December 2025") and Commission Implementing Regulation (EU) 2025/2546 of 10 December
2025 ("on the application of the principles for verification of declared embedded
emissions" — the Article 8(3) verification-detail act). Both apply from 1 January 2026,
matching this project's definitive-regime operating date. Findings from both are now
reflected in RULE-EE-002, RULE-EE-003, RULE-EE-006, RULE-EE-007, and RULE-EE-008 below,
each citing the exact Article/Annex/point read. The other three tracked acts
(2025/2620, 2025/2621, 2026/1740) were not fetched in this pass — they were not needed
for the specific gaps closed here — and remain unincorporated dataset-content acts per
the paragraph above.

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
  **2026-08-29**: the implementing act has since been located and read (Commission
  Implementing Regulation (EU) 2025/2547, Annex II point A.1(6)-(8)) as part of a P7
  register-completion pass — see RULE-EE-006 for the full finding. It does not change
  this rule's own "never rounded before P9" posture: the rounding *method* it would take
  is still unresolved (see RULE-EE-006), so P6/RULE-EE-001 continues to carry full
  precision unchanged.
- **Exceptions**: none at this rule's level — REFERENCE_REQUIRED/UNAVAILABLE/
  NOT_APPLICABLE/AMBIGUOUS/NO_MATCH resolutions never reach this rule at all (P5 never
  persists a determination for them; RULE-EE-005 governs the explicit non-computable
  states the engine must return instead). **Added after the mandatory P6 engine
  review**: P4's `QUANTITY_UNIT_MISMATCH` check validates the *good's* `functional_unit`
  (`cbam_goods`) against the declared quantity kind, but nothing validated the *emission
  record's own* `emission_unit` (`default_emission_values`, a separate table, free-form
  text) against that same basis — a record carrying a mismatched unit would have
  multiplied silently. The engine now returns `UNIT_UNSUPPORTED` (added to
  `CalculationStatus`) when `resolution.emission_unit` doesn't contain "TONNE" for a
  mass line or "MWH" for an electricity line. In the currently loaded dataset every
  `emission_unit` value is `TCO2E_PER_TONNE` and no electricity-sector good is loaded at
  all (verified live), so this is a defense-in-depth guard against a state that cannot
  currently occur, not a fix for an observed failure.
- **Source URL**: `https://eur-lex.europa.eu/eli/reg/2023/956/oj/eng` (Article 7, Annex
  IV points 1(c) and 4.1).
- **Golden regression fixture**: `src/domain/calculations/calculate-line-emissions.test.ts`
  — exact CN8 match with a MAPPED country (mass good), OTHER_COUNTRIES_FALLBACK with an
  UNLISTED country (mass good), an electricity good (MWh basis), exact decimal precision,
  and every non-computable status including UNIT_UNSUPPORTED.
- **Known gaps from the mandatory P6 engine review** (2026-08-28), tracked rather than
  fixed in this pass: (1) `calculation_results`' RLS policy constrains org/actor/line/
  shipment-status scope but not the *correctness* of the written values — any
  authenticated member of the line's org can INSERT an arbitrary
  `embedded_emissions_tco2e` directly via PostgREST, bypassing this engine entirely; a
  `correlation_id` shared with the row's `calculation.computed` audit event was added as
  a cheap detectability measure, but the real fix (a `security definer` RPC that
  recomputes and compares, or a reproduction check comparing stored results against
  fresh recomputation from frozen inputs) is materially larger and tracked as a P11
  security-hardening item, not implemented here. (2) No standing two-org isolation test
  exists yet for `calculation_results` (unlike `shipment_lines`'
  `tests/integration/shipments-isolation.test.ts`) — the LOCKED/VOID insert gate was
  verified live via direct role-simulated psql (both the block and the READY-still-works
  case), not via an automated test.

## RULE-EE-002 — Actual specific embedded emissions, simple goods

- **Classification**: REGULATORY FACT.
- **Authoritative regulation**: Regulation (EU) 2023/956.
- **Article/Annex/section**: Article 7(2)(a); Annex IV point 2 ("Determination of actual
  specific embedded emissions for simple goods").
- **Effective period**: current.
- **Applicability**: **IN SCOPE for P7**, per the owner's 2026-08-29 written directive
  bringing RULE-EE-002/003 into the current phase. An operator-measured `EmissionData`
  record for a "simple good" (Annex IV point 1(a): "goods produced in a production
  process requiring exclusively input materials (precursors) and fuels having zero
  embedded emissions"). **Register-completion is now in progress** (this 2026-08-29 pass
  resolves the rounding-precision, indirect-emissions-conditions, and evidence gaps
  flagged below); **no engine code implements this rule yet** — nothing here should be
  read as "implemented." P7's DoD still requires its own implementation, tests, and (per
  master plan §38) mandatory Opus review before use.
- **Inputs**: `AttrEm_g` (attributed emissions of goods g, tCO2e); `AL_g` (activity
  level — quantity of goods g produced in the reporting period at that installation).
- **Units**: tCO2e ÷ tonnes = tCO2e/tonne.
- **Formula** (verified from the rendered equation image, Annex IV point 2):
  `SEE_g = AttrEm_g / AL_g`, where `AttrEm_g = DirEm + IndirEm`
  — `DirEm` = direct emissions from the production process (tCO2e, within the system
  boundaries an implementing act under Article 7(7) defines); `IndirEm` = indirect
  emissions from electricity consumed in production (tCO2e, same system-boundary
  source).
- **Rounding rule**: RESOLVED for precision/stage; UNRESOLVED for method. Commission
  Implementing Regulation (EU) 2025/2547 (see the register preamble's 2026-08-29 update),
  Annex II, point A.1, point 8 (verbatim): "Specific direct and indirect embedded
  emissions shall be expressed in tonnes of CO2e per tonne of goods, rounded to include
  all significant digits, with a maximum of 5 digits after the comma." This is the rule
  that directly governs `SEE_g`'s reported form: a ceiling of 5 decimal digits, not a
  fixed count. **UNRESOLVED, escalated**: no provision found anywhere in this Regulation
  states the rounding *method* (round-half-up, round-half-even, truncation) — "rounded to
  include all significant digits" states a precision ceiling, not an algorithm. Per the
  owner's rule, do not infer HALF_UP or any other method; see RULE-EE-006 for the full
  finding and the two candidate resolution paths recorded there, neither implemented.
- **Exceptions**: none stated at this Annex point for `DirEm`. For the `IndirEm`
  component of `AttrEm_g`, Annex IV point 6 sets separate cumulative conditions for using
  an *actual* value instead of Annex IV point 4.3's default — now registered as
  RULE-EE-008; that rule gates `IndirEm` here, it does not change this rule's formula.
  Annex IV point 5 (conditions for actual embedded emissions in imported electricity
  *as the good itself*, Article 7(3)) is a different calculation path entirely — goods
  other than electricity, which RULE-EE-002 covers, never take that path — registered
  separately as RULE-EE-007 for traceability only; it does not apply to or gate this rule.
- **Data/evidence requirements**: Article 7(5)-(6) of Regulation (EU) 2023/956 requires
  the authorised CBAM declarant to keep records under Annex V "sufficiently detailed to
  enable verifiers ... to verify the embedded emissions in accordance with Article 8 and
  Annex VI," retained until the end of the fourth year after the CBAM declaration was or
  should have been submitted. Annex V point 2 (goods whose embedded emissions are
  determined on actual emissions) requires: installation identification; the operator's
  contact information; the verification report (Annex VI); and the specific embedded
  emissions of the goods. Annex VI's verification principles require, among other things,
  a mandatory installation visit "except where specific criteria for waiving the
  installation visit are met" (point 1(c)) and a verification report containing (point 2,
  partial quote) installation and operator identification, the reporting period, verifier
  identity and accreditation, visit date or the reason none was carried out, quantities of
  goods produced, quantification of direct installation emissions, a description of the
  emissions-attribution methodology, and (point 2(l)-(n)) the verifier's reasonable-
  assurance statement plus any material misstatements/non-conformities found and
  corrected. Commission Implementing Regulation (EU) 2025/2546 (Article 8(3) verification-
  detail act, fetched live 2026-08-29 — see register preamble) supplies the operative
  detail behind Annex VI: Article 5 sets materiality levels at "5 % of the total specific
  embedded emissions" and "5 % of the total specific embedded free allocation," Articles
  2-4 set the conditions under which a physical site visit may be replaced by a virtual
  visit or waived (first verified reporting period always requires a physical visit; a
  waiver requires two consecutive prior physical visits and a defined no-material-change
  condition), and its Annex prescribes the verification-report template's required fields
  in full (installation/operator identity, verifier accreditation detail, materiality
  levels applied, per-good specific direct and indirect embedded emissions, and — per
  point 2.4(b)(5) — a summary of the elements of evidence confirming any Annex IV point 5
  criteria claimed). Where an actual-value determination cannot be evidenced to this
  standard, Article 7(2) of Regulation (EU) 2023/956 requires falling back to the default
  value (Annex IV point 4.1) rather than reporting an inadequately evidenced actual value.
- **Source URL**: `https://eur-lex.europa.eu/eli/reg/2023/956/oj/eng` (Article 7(2)(a),
  Article 7(5)-(6), Annex IV point 2, Annex V, Annex VI); `https://eur-lex.europa.eu/eli/reg_impl/2025/2547/oj/eng`
  (Annex II point A.1(8)); `https://eur-lex.europa.eu/eli/reg_impl/2025/2546/oj/eng`
  (Articles 2-5, Annex).
- **Golden regression fixture**: none yet (P7 — documentation only in this pass; no
  fixture, per this task's explicit scope, until the formula and evidence rules above
  have had their own human/Sonnet review).

## RULE-EE-003 — Actual specific embedded emissions, complex goods

- **Classification**: REGULATORY FACT.
- **Authoritative regulation**: Regulation (EU) 2023/956.
- **Article/Annex/section**: Article 7(2)(a); Annex IV point 3 ("Determination of actual
  embedded emissions for complex goods").
- **Effective period**: current.
- **Applicability**: **IN SCOPE for P7**, per the owner's 2026-08-29 written directive
  bringing RULE-EE-002/003 into the current phase — a "complex good" (Annex IV point
  1(b): "goods other than simple goods"). **Register-completion is now in progress**
  (this 2026-08-29 pass resolves the rounding-precision, precursor-fallback, and evidence
  gaps flagged below); **no engine code implements this rule yet**.
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
- **Rounding rule**: RESOLVED for precision/stage; UNRESOLVED for method. Same finding
  and same citation as RULE-EE-002's Rounding rule bullet (Commission Implementing
  Regulation (EU) 2025/2547, Annex II point A.1(8) — max 5 digits after the decimal for
  `SEE_g`, method not specified anywhere found). See RULE-EE-006 for the full finding;
  not repeated here to avoid drift between the two entries.
- **Exceptions**: **RESOLVED** — precursor `SEE_i` fallback. Commission Implementing
  Regulation (EU) 2025/2547, Annex II, point A.1, points 4-5 (verbatim): (4) "For
  precursors produced outside the installation and originating in third countries and
  territories that are not exempted pursuant to point 1 of Annex III to Regulation (EU)
  2023/956, actual data obtained from the operator of the installation producing the
  precursor shall be used only if the following conditions are met: (a) the data must be
  taken from a verification report that has been issued by a verifier having an
  accreditation in accordance with Article 18 of Delegated Regulation (EU) 2025/2551
  valid at the time of issuing the verification report and for the sectoral scope
  required for the aggregated goods category of the precursor under consideration; and
  (b) the verification report must cover the reporting period during which the precursor
  was produced." (5) "Where the operator does not have a verification report meeting
  conditions (a) and (b), the relevant default values, made available in accordance with
  Annex IV of Regulation (EU) 2023/956, for the precursor shall be used." In other words:
  the fallback for an inadequately-measurable precursor is not an alternative formula or
  an estimate — it is the same versioned default-value dataset RULE-EE-001 already
  consumes, applied per-precursor rather than per-finished-good, once the specific
  evidence conditions (a)-(b) are not met. **Follow-up flagged, not resolved in this
  pass**: Commission Delegated Regulation (EU) 2025/2551 (verifier accreditation under
  Article 18, cited in condition (a)) is a source this rule now depends on but is not
  currently listed in `SOURCE_REGISTER.md`'s source hierarchy — noted here for that
  file's own maintainers; out of this task's file scope to add it there. For the
  `IndirEm` component of this rule's own `AttrEm_g`, see RULE-EE-008 (Annex IV point 6
  conditions), same as RULE-EE-002; Annex IV point 5 (imported electricity as the good
  itself) does not apply to this rule for the same reason given in RULE-EE-002.
- **Data/evidence requirements**: same base requirements as RULE-EE-002 (Article 7(5)-(6)
  and Annex V/VI of Regulation (EU) 2023/956; Commission Implementing Regulation (EU)
  2025/2546's materiality levels, site-visit conditions, and report template — see
  RULE-EE-002 for the full citations, not repeated here). Additionally, for complex
  goods specifically, Implementing Regulation (EU) 2025/2546's verification-report
  template Annex, point 2.5 ("Data verification of precursors"), requires — per
  precursor — its CN code, name, country of origin, and (for precursors on default
  values) the applicable default value; and, for precursors on actual values: the
  reporting period and whether it is the default or actual production-time period,
  the specific embedded emissions (direct and, if applicable, indirect), the producing
  operator's and installation's identity, and the verifying verifier's identity and
  accreditation detail. This matches Regulation (EU) 2023/956's own Annex VI point 2(k):
  "in case of complex goods: (i) quantities of each input material (precursor) used;
  (ii) the specific embedded emissions associated with each of the input materials
  (precursors) used; (iii) if actual emissions are used: the identification of the
  installations where the input material (precursor) has been produced and the actual
  emissions from the production of that material."
- **Source URL**: `https://eur-lex.europa.eu/eli/reg/2023/956/oj/eng` (Article 7(2)(a),
  Annex IV point 3, Annex VI point 2(k)); `https://eur-lex.europa.eu/eli/reg_impl/2025/2547/oj/eng`
  (Annex II point A.1(4)-(5) and (8)); `https://eur-lex.europa.eu/eli/reg_impl/2025/2546/oj/eng`
  (Annex point 2.5).
- **Golden regression fixture**: none yet (P7 — documentation only in this pass, per this
  task's explicit scope).

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
- **Golden regression fixture**: `src/domain/calculations/calculate-line-emissions.test.ts`
  — a line with no `emission_determination` produces `INPUT_UNRESOLVED`; a non-AVAILABLE
  resolved total produces `VALUE_UNAVAILABLE`; an ACTUAL-method determination produces
  `ACTUAL_METHOD_NOT_YET_SUPPORTED`; a unit/quantity-basis mismatch produces
  `UNIT_UNSUPPORTED` (added post-review, see RULE-EE-001) — none of these ever return a
  computed value. `REFERENCE_REQUIRED_UNRESOLVED`, `AMBIGUOUS_INPUT`, and
  `PARAMETER_DATASET_UNAVAILABLE` remain unimplemented (unreachable in P6's DEFAULT-only
  scope; relevant once P7/future-parameter-dataset work lands).

## RULE-EE-006 — Precision and rounding

- **Classification**: REGULATORY FACT for precision/stage (RESOLVED 2026-08-29); the
  rounding *method* remains an APPLICATION DESIGN DECISION pending a REGULATORY FACT not
  yet found (UNRESOLVED — escalated, see below).
- **Applicability**: every calculation producing a reported quantity — reporting-period
  installation emissions totals, and specific embedded emissions (`SEE_g`/`SEE_i` from
  RULE-EE-001/002/003).
- **Original finding (P6)**: the base Regulation (EU) 2023/956 text was searched in full
  for rounding/precision language; the only rounding rule it states anywhere is Article
  2a/Annex VII's single mass-based threshold ("rounded to the nearest ten"), which is
  unrelated to embedded-emissions or declaration rounding. Article 7(7) delegates further
  specification of the calculation methods to future implementing acts.
- **2026-08-29 finding (P7 register-completion pass)**: that implementing act has been
  located and fetched live — Commission Implementing Regulation (EU) 2025/2547 (see the
  register preamble's 2026-08-29 update for why this act and not the transitional
  Implementing Regulation (EU) 2023/1773 governs the current, definitive-regime
  calculation methodology). Annex II, point A.1, points 6-8 (verbatim):
  - Point 6: "Emissions data over a full reporting period shall be expressed in tonnes
    CO2e rounded to full tonnes."
  - Point 7: "All parameters used to calculate the emissions shall be rounded to include
    all significant digits for the purpose of calculating and reporting emissions."
  - Point 8: "Specific direct and indirect embedded emissions shall be expressed in
    tonnes of CO2e per tonne of goods, rounded to include all significant digits, with a
    maximum of 5 digits after the comma."

  Reading: point 6 rounds an *aggregate reporting-period total* (installation-level
  emissions in tonnes CO2e) to whole tonnes — a different quantity from `SEE_g`, which is
  a per-tonne intensity, not a period total. Point 8 is the rule that directly governs
  `SEE_g`/`SEE_i`: a ceiling of 5 digits after the decimal point, not a fixed count (a
  smaller specific-emissions value may carry fewer significant digits and still comply).
  Point 7 is a general parameter-level instruction that does not add a numeric limit
  beyond points 6 and 8.
- **UNRESOLVED — escalated (rounding method)**: no provision found anywhere in
  Implementing Regulation (EU) 2025/2547, nor in the earlier full-text search of
  Regulation (EU) 2023/956, states the rounding *method* (round-half-up, round-half-even
  / banker's, truncation, etc.) for points 6-8. "Rounded to include all significant
  digits" states a precision *ceiling*, not an algorithm. Per the owner's explicit rule
  ("If authoritative evidence is insufficient for a rule: STOP ONLY THAT RULE and
  escalate. Do NOT infer or invent the formula."), this sub-point is **not** inferred and
  **not** implemented here. Two candidate resolution paths for a human/Sonnet review
  before P7 implementation, neither adopted as fact in this pass: (a) treat the 5-decimal
  ceiling as a *reporting/declaration-time* transformation only — consistent with this
  rule's own long-standing interim design below and RULE-EE-001's "never rounded before
  P9" posture, i.e. `CalculationResult` keeps full `Decimal` precision, and a
  presentation-layer step not yet built applies an explicitly-confirmed method at
  declaration time; or (b) fetch Commission Implementing Regulation (EU) 2018/2066 (the
  EU ETS Monitoring and Reporting Regulation that Implementing Regulation (EU) 2025/2547's
  own recital (1) says CBAM's calculation methods "build upon") to check whether it
  defines a rounding method by cross-reference — **not fetched or read in this pass**,
  since it was outside this task's scoped source set, and inferring its content from its
  title/relationship alone would violate the same never-invent rule this note exists to
  honor.
- **Interim rule** (DESIGN, not FACT, unchanged by this pass): full `Decimal` precision
  (`src/domain/shared/decimal.ts`) is maintained through every calculation step and
  persisted in `CalculationResult`; no rounding is applied anywhere in `src/domain/
  calculations/`. This remains the correct default given the unresolved method above: a
  fully-precise stored value can still be rounded correctly once the method is confirmed;
  a value rounded now by a guessed method cannot be un-rounded. Declaration-time rounding
  (P9) must apply Annex II point A.1(6)-(8)'s stated precision ceilings using a method
  that is fetched and cited first, not assumed.
- **Source URL**: `https://eur-lex.europa.eu/eli/reg/2023/956/oj/eng` (searched in full;
  Article 7(7), Article 2a/Annex VII — original P6 finding, no rounding method found);
  `https://eur-lex.europa.eu/eli/reg_impl/2025/2547/oj/eng` (Annex II point A.1(6)-(8) —
  2026-08-29 finding, no rounding method found there either).
- **Golden regression fixture**: `src/domain/calculations/calculate-line-emissions.test.ts`'s
  "preserves exact decimal precision" case (0.1 × 0.2 = 0.02 exactly, not the
  floating-point-drifted 0.020000000000000004 a native-number multiplication would give).
- **Noted in the mandatory P6 engine review**: "no rounding" is bounded, not unlimited —
  `src/domain/shared/decimal.ts`'s `Decimal.clone({precision: 40, ...})` rounds any
  intermediate result to 40 significant digits (HALF_UP), and no intake-time digit cap
  exists on `net_mass_tonnes`/`quantity_mwh` (`text` columns, only `> 0` is checked).
  Not fixed here: no realistic CBAM shipment quantity approaches a value where this
  40-digit ceiling would matter, so this is recorded as a known, accepted bound rather
  than a rounding rule requiring its own register entry.

## RULE-EE-007 — Conditions for actual embedded emissions in imported electricity

- **Classification**: REGULATORY FACT (applicability condition; not a RULE-EE-002/003
  formula input — registered here for traceability per the owner's 2026-08-29 directive
  to register Annex IV points 4-6 as their own entries where they are genuinely separate
  applicability conditions).
- **Authoritative regulation**: Regulation (EU) 2023/956; elements-of-evidence detail in
  Commission Implementing Regulation (EU) 2025/2547.
- **Article/Annex/section**: Article 7(3); Annex IV point 5 ("CONDITIONS FOR APPLYING
  ACTUAL EMBEDDED EMISSIONS IN IMPORTED ELECTRICITY"); evidence detail in Implementing
  Regulation (EU) 2025/2547, Annex II, point D.2.4.
- **Effective period**: current (definitive regime, from 2026-01-01).
- **Applicability**: governs the calculation of electricity itself as the imported good
  under Article 7(3) (verbatim): "Embedded emissions in imported electricity shall be
  determined by reference to default values in accordance with the method set out in
  point 4.2 of Annex IV, unless the authorised CBAM declarant demonstrates that the
  criteria to determine the embedded emissions based on the actual emissions listed in
  point 5 of Annex IV are met." This is a distinct calculation path from RULE-EE-002/003
  (which calculate goods *other than* electricity) — it does not gate or feed either of
  them, and is not itself in P7's RULE-EE-002/003 scope or implemented by any engine code.
- **Formula**: none — this rule is a gating condition, not a computation. When the
  cumulative criteria below are met, an actual-emissions figure is used in place of Annex
  IV point 4.2's default value; this rule does not itself define how that actual figure
  is computed.
- **Rule** (Annex IV point 5, verbatim, cumulative criteria (a)-(e)): "An authorised CBAM
  declarant may apply actual embedded emissions instead of default values for the
  calculation referred to in Article 7(3) if the following cumulative criteria are met:
  (a) the amount of electricity for which the use of actual embedded emissions is claimed
  is covered by a power purchase agreement between the authorised CBAM declarant and a
  producer of electricity located in a third country; (b) the installation producing
  electricity is either directly connected to the Union transmission system or it can be
  demonstrated that at the time of export there was no physical network congestion at any
  point in the network between the installation and the Union transmission system; (c)
  the installation producing electricity does not emit more than 550 grammes of CO2 of
  fossil fuel origin per kilowatt-hour of electricity; (d) the amount of electricity for
  which the use of actual embedded emissions is claimed has been firmly nominated to the
  allocated interconnection capacity by all responsible transmission system operators in
  the country of origin, the country of destination and, if relevant, each country of
  transit, and the nominated capacity and the production of electricity by the
  installation refer to the same period of time, which shall not be longer than one hour;
  (e) the fulfilment of the above criteria is certified by an accredited verifier, who
  shall receive at least monthly interim reports demonstrating how those criteria are
  fulfilled." Annex IV point 5 additionally excludes this electricity's accumulated
  volume and its actual embedded emissions from the country/grid emission-factor
  calculation used for point 4.3's indirect-emissions default methodology.
- **Data/evidence requirements**: Implementing Regulation (EU) 2025/2547, Annex II, point
  D.2.4 sets the specific elements of evidence per criterion: for (a), PPA contractual
  evidence (a direct two-party contract, or — if concluded through an intermediary — a
  single tripartite contract); for (b), either a single-line diagram showing a direct
  grid connection, or written TSO/other-party documentation of no physical network
  congestion at export time; for (c), data showing emissions of no more than 550 g
  CO2(fossil)/kWh; for (d), TSO/nominating-party written documentation of firm capacity
  nomination plus smart-metering data showing matching production within the same
  measurement period (not exceeding one hour); for (e), monthly interim reports
  evidencing (a)-(d).
- **Exceptions**: none beyond the cumulative-criteria structure itself — all five must be
  met; none is independently sufficient.
- **Source URL**: `https://eur-lex.europa.eu/eli/reg/2023/956/oj/eng` (Article 7(3),
  Annex IV point 5); `https://eur-lex.europa.eu/eli/reg_impl/2025/2547/oj/eng` (Annex II
  point D.2.4).
- **Golden regression fixture**: none — out of P7 scope (RULE-EE-002/003 only); not
  implemented.

## RULE-EE-008 — Conditions for applying actual embedded emissions for indirect emissions

- **Classification**: REGULATORY FACT (applicability condition that directly gates the
  `IndirEm` component of RULE-EE-002's and RULE-EE-003's `AttrEm_g` — see each rule's own
  Exceptions bullet).
- **Authoritative regulation**: Regulation (EU) 2023/956; elements-of-evidence detail in
  Commission Implementing Regulation (EU) 2025/2547.
- **Article/Annex/section**: Article 7(4); Annex IV point 6 ("CONDITIONS TO APPLYING
  ACTUAL EMBEDDED EMISSIONS FOR INDIRECT EMISSIONS"); evidence detail in Implementing
  Regulation (EU) 2025/2547, Annex II, point D.4.3.
- **Effective period**: current (definitive regime, from 2026-01-01).
- **Applicability**: gates whether `IndirEm` (indirect emissions from electricity
  consumed *in* the production process of a non-electricity good, within RULE-EE-002's
  and RULE-EE-003's `AttrEm_g`) may use an actual value rather than Annex IV point 4.3's
  default. Article 7(4) (verbatim): "Embedded indirect emissions shall be calculated in
  accordance with the method set out in point 4.3 of Annex IV and further specified in
  the implementing acts adopted pursuant to paragraph 7 of this Article, unless the
  authorised CBAM declarant demonstrates that the criteria to determine the embedded
  emissions based on actual emissions that are listed in point 6 of Annex IV are met."
- **Formula**: none — this rule is a gating condition, not a computation; when met, the
  actual `IndirEm` figure feeds RULE-EE-002/003's existing `AttrEm_g = DirEm + IndirEm`
  formula unchanged.
- **Rule** (Annex IV point 6, verbatim): "An authorised CBAM declarant may apply actual
  embedded emissions instead of default values for the calculation referred to in Article
  7(4) if it can demonstrate a direct technical link between the installation in which
  the imported good is produced and the electricity generation source or if the operator
  of that installation has concluded a power purchase agreement with a producer of
  electricity located in a third country for an amount of electricity that is equivalent
  to the amount for which the use of a specific value is claimed." Unlike RULE-EE-007's
  point 5, point 6 states two alternative paths (direct technical link OR an equivalent
  PPA), not a single cumulative list.
- **Data/evidence requirements**: Implementing Regulation (EU) 2025/2547, Annex II, point
  D.4.3: for a direct technical link — a single-line diagram of the link, smart-metering
  data showing the electricity's production and its matching delivery within the same
  measurement period (not exceeding one hour) to the goods-producing installation, and
  (where the link serves multiple installations) a delivery contract or intra-company
  off-take agreement requiring at least the claimed amount; for a PPA — contractual
  evidence (direct, or a single tripartite contract via an intermediary), smart-metering
  data showing matching production and delivery within the same one-hour-or-less
  measurement period, and written documentation (from a TSO, public authority, or other
  reliable public source) of a physical grid connection between the two installations.
- **Exceptions**: none beyond the two-path (direct technical link OR PPA) structure
  itself.
- **Source URL**: `https://eur-lex.europa.eu/eli/reg/2023/956/oj/eng` (Article 7(4),
  Annex IV point 6); `https://eur-lex.europa.eu/eli/reg_impl/2025/2547/oj/eng` (Annex II
  point D.4.3).
- **Golden regression fixture**: none — out of P7 scope; not implemented.

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

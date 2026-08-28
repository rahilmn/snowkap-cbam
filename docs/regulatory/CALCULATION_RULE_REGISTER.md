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
  pair. The engine's own defense-in-depth unit-basis guard (`unitMatchesQuantityBasis`,
  `calculate-line-emissions.ts`) is genuinely inert for this rule *in practice* — it stays
  safe only because `default_emission_values.emission_unit` carries its own DB CHECK
  (`{'TCO2E_PER_TONNE','TCO2_PER_MWH'}`,
  `20260826133116_create_regulatory_foundation.sql:367-373`), not because of anything the
  guard function itself verifies. **2026-08-29 (RULE-EE-009 engine review)**: that guard
  function is now shared with RULE-EE-009 (ACTUAL) and was widened (adding an anchored
  `/T` pattern, e.g. matching `tCO2e/t`) to accommodate the ACTUAL path's differently-
  formatted, unconstrained `EmissionData.emission_unit` field — the widening is provably
  inert for THIS rule only because of the DB CHECK just cited, not because the function
  itself distinguishes the two sources' conventions.
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
- **2026-08-29 note (RULE-EE-009 engine review)**: `calculateLineEmissions`'s dispatch was
  restructured to add the ACTUAL-method branch (RULE-EE-009). One incidental behavior
  change on THIS rule's own path: the `quantity === null` unreachable-guard throw now
  fires before the `VALUE_UNAVAILABLE`/`UNIT_UNSUPPORTED` checks instead of after them.
  Both preconditions (quantity null; a non-AVAILABLE resolved total) are independently
  unreachable given `isLineQuantityValid`'s exactly-one-quantity invariant
  (`src/domain/shipments/invariants.ts`), so no reachable input combination is affected —
  confirmed by the reviewer, not merely asserted here — but the ordering itself was never
  covered by a test in either direction. Documented as a deliberate, inert reordering
  rather than restored, since failing loudly on a guard violation earlier is arguably the
  better default; flagging so a future reader doesn't mistake it for an oversight.

## ESCALATED, NOT PATCHED: RULE-EE-009 vs. RULE-EE-004's Annex II exception (2026-08-29)

RULE-EE-004 (below) documents that this rule (RULE-EE-001) trusts the regulatory
dataset's own pre-summed `total_emissions` rather than recomputing `direct + indirect` in
application code *specifically* because recomputing "would silently violate" Article
7(1) sentence 2 for Annex II goods (iron & steel, aluminium — direct-only), and states:
"if the engine is ever changed to recompute totals from direct+indirect components, this
exception must be reintroduced explicitly."

RULE-EE-009 (below) does exactly that recomputation for the ACTUAL method — and the
Annex II exception was **not** reintroduced. Found and verified independently (not just
accepted from the review) in the mandatory RULE-EE-009 engine review: `cbam_goods` has no
field indicating Annex II membership at all (only `sector` — CEMENT/FERTILISERS/
IRON_STEEL/ALUMINIUM/HYDROGEN/ELECTRICITY — and `functional_unit`, confirmed by reading
the live schema, `20260826133116_create_regulatory_foundation.sql:218-274`), so there is
currently no way for the engine to even detect this case, let alone gate it. This is a
**material regulatory behavior gap requiring an owner decision, not a code patch** — per
CLAUDE.md's facts-as-datasets rule, the Annex II code list must enter as its own versioned
regulatory dataset (mirroring how `default_emission_values` itself entered), never a
hardcoded list, and building that dataset is its own research-and-ingestion pass, not
something to improvise inside this review-response. See RULE-EE-009's own entry for the
full disclosure and the interim options recorded there. **This is why RULE-EE-009 is not
yet considered safe to rely on for Annex II goods (iron & steel, aluminium) using the
ACTUAL method — DEFAULT-method lines for the same goods are unaffected, since this rule's
own trust-the-dataset-total design was never at risk.**

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
  resolved total produces `VALUE_UNAVAILABLE`; a unit/quantity-basis mismatch produces
  `UNIT_UNSUPPORTED` (added post-review, see RULE-EE-001) — none of these ever return a
  computed value. **2026-08-29 correction**: this bullet previously said an ACTUAL-method
  determination produces `ACTUAL_METHOD_NOT_YET_SUPPORTED` — stale since RULE-EE-009
  (below) implemented the ACTUAL branch in P7; that status was removed from
  `CalculationStatus` entirely (found stale, not caught by typecheck, in the mandatory
  RULE-EE-009 engine review — `calculationStatusMessageFor` takes a bare `status: string`
  with a default branch, so nothing structurally would have caught a missed call site).
  An ACTUAL determination now produces `COMPUTED` (RULE-EE-009) or `UNIT_UNSUPPORTED`,
  never a separate not-yet-supported status. `REFERENCE_REQUIRED_UNRESOLVED`,
  `AMBIGUOUS_INPUT`, and `PARAMETER_DATASET_UNAVAILABLE` remain unimplemented (unreachable
  in P6/P7's current scope; relevant once future-parameter-dataset work lands).

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
  **not** implemented here.
  **2026-08-29, third check (same-day follow-up)**: Commission Implementing Regulation
  (EU) 2018/2066 (the EU ETS Monitoring and Reporting Regulation ("MRR") that Implementing
  Regulation (EU) 2025/2547's own recital (1) says CBAM's calculation methods "build
  upon") was fetched and its full rendered text searched directly (292,021 characters,
  via the Browser, not a single-shot AI summary — an initial WebFetch summarization pass
  on this same document incorrectly reported no rounding provision existed at all,
  apparently from truncating a document this long; the actual text was then located by
  direct in-page string search, which is why this document is read this way rather than
  trusted to a summarizer, same as Annex IV's own embedded-image formulas). Found: MRR
  Article 72, "Rounding of data" (verbatim): "1. Total annual emissions shall be reported
  as rounded tonnes of CO2 or CO2(e). Tonne-kilometres shall be reported as rounded values
  of tonne-kilometres. 2. All variables used to calculate the emissions shall be rounded
  to include all significant digits for the purpose of calculating and reporting
  emissions. 3. All data per flights shall be rounded to include all significant digits
  for the purpose of calculating the distance and payload..." This is the direct textual
  ancestor of Implementing Regulation (EU) 2025/2547 Annex II point A.1(6)-(7)'s near-
  identical wording ("rounded to full tonnes" / "rounded to include all significant
  digits") — confirming the "builds upon" relationship the recital states — but Article 72
  **also never specifies a rounding method**, using the exact same precision-only language
  CBAM's own act uses. This closes the specific follow-up flagged in this rule's own prior
  finding with a definitive answer, not merely "not checked": the rounding method is
  genuinely absent from all three sources now directly read in full (Regulation (EU)
  2023/956, Implementing Regulation (EU) 2025/2547, and Implementing Regulation (EU)
  2018/2066) — this is a real, structural gap in the published EU regulatory text across
  the entire lineage CBAM's methodology derives from, not a research shortfall. Two
  candidate resolution paths remain, for a human/owner decision before P7 implementation,
  neither adopted as fact in this pass: (a) treat the 5-decimal ceiling as a
  *reporting/declaration-time* transformation only — consistent with this rule's own
  long-standing interim design below and RULE-EE-001's "never rounded before P9" posture,
  i.e. `CalculationResult` keeps full `Decimal` precision, and a presentation-layer step
  not yet built applies an explicitly-confirmed method at declaration time; or (b) adopt
  HALF_UP as an explicit APPLICATION DESIGN DECISION (not a REGULATORY FACT) on the
  reasoning that it is already this codebase's own standing default everywhere else
  (`src/domain/shared/decimal.ts`'s `Decimal.clone({precision: 40, rounding: HALF_UP})`)
  and is the conventional default absent a stated regulatory method — but this path
  requires an explicit owner sign-off to adopt, since it is a genuine judgment call in the
  absence of a cited fact, not itself derived from the Regulation.
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
  2026-08-29 finding, no rounding method found there either);
  `https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32018R2066` (Article 72
  "Rounding of data" — 2026-08-29 same-day follow-up, full text searched directly, no
  rounding method found there either; this is the act CBAM's own rounding language
  derives from per 2025/2547's recital (1)).
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

## RULE-EE-009 — Line embedded emissions from an ACTUAL determination

- **Classification**: APPLICATION DESIGN DECISION combining REGULATORY FACTs — same
  classification shape as RULE-EE-001, its direct structural sibling for the ACTUAL
  method.
- **Owner decision (2026-08-29) this rule depends on**: "Pass-through — RULE-EE-002/003
  document what producers should already compute upstream." The application does **not**
  implement RULE-EE-002/003's own `SEE_g = AttrEm_g / AL_g` (simple goods) or
  `SEE_g = (AttrEm_g + EE_InpMat) / AL_g` (complex goods) derivations — no activity-level
  or precursor-attribution computation exists or is planned in-app.
  `EmissionData.direct_specific`/`indirect_specific` (`src/domain/emissions/types.ts`,
  freeform producer-entered `DecimalString` inputs, unchanged by this rule) are trusted as
  the producer's own already-computed `SEE_g` components, verified through the existing
  producer verification workflow (P7-B) rather than recomputed by this engine. RULE-EE-002
  and RULE-EE-003 remain registered above as the regulatory basis for what those two
  fields represent and how a producer is expected to have derived them — traceability, not
  an in-app spec.
- **Authoritative regulation**: Regulation (EU) 2023/956, Annex IV point 2/3's own
  `AttrEm_g = DirEm + IndirEm` sub-formula (the one piece of RULE-EE-002/003 this rule
  actually executes — see Formula below) — same source citations as RULE-EE-002/003's own
  entries above, not repeated here.
- **Applicability**: a shipment line whose `emission_determination.method === "ACTUAL"`
  (`src/domain/emissions/types.ts`) — i.e. a P7-D `ActualEmissionSnapshot` exists, frozen
  from a producer's own or a validly shared, ACTIVE+VERIFIED, evidence-complete
  `EmissionData` record (owner's evidence-completeness blocking policy,
  `checkEmissionDataEvidenceCompleteness`, already enforces the last of those upstream of
  this rule — this rule trusts that the snapshot could only have been created for a
  complete, verified record, per the two-wall discipline the rest of this codebase
  already uses elsewhere: this rule is not itself a completeness/verification check).
- **Inputs**: `quantity` (the line's `net_mass_tonnes` in tonnes, or `quantity_mwh` in MWh
  — same as RULE-EE-001); `snapshot.values.direct_specific` and
  `snapshot.values.indirect_specific` (`ActualEmissionSnapshot`, both `DecimalString`).
- **Units**: tonnes × tCO2e/tonne = tCO2e for mass goods; MWh × tCO2e/MWh = tCO2e for
  electricity — identical unit structure to RULE-EE-001. `snapshot.emission_unit` is
  validated against the line's own quantity basis (`net_mass_tonnes` vs `quantity_mwh`)
  before use, the same `UNIT_UNSUPPORTED` guard RULE-EE-001 already applies (found
  necessary there in the mandatory P6 review; applied here from the start rather than
  waiting for its own review to find the same gap).
- **Formula**: `line_embedded_emissions = quantity × (direct_specific + indirect_specific)`.
  Unlike RULE-EE-001 (which trusts the regulatory dataset's own pre-summed `total` field
  rather than re-deriving `direct + indirect` in application code — see that rule's own
  design rationale), this rule's engine code **does** perform the
  `AttrEm_g = DirEm + IndirEm` summation itself, because `ActualEmissionSnapshot` stores
  `direct_specific`/`indirect_specific` as two separate fields with no pre-summed total
  (unlike `RegulatoryResolutionSnapshot.values.total`) — there is no equivalent
  already-published total to trust instead, and Annex IV point 2/3's own
  `AttrEm_g = DirEm + IndirEm` is exactly this summation, verbatim, so performing it here
  is applying a cited regulatory formula, not inferring one.
- **Rounding rule**: none — same "never rounded before P9" posture as RULE-EE-001,
  extended here deliberately: RULE-EE-006 (Precision and rounding) found the rounding
  *method* genuinely unresolved across all three primary sources checked (Regulation (EU)
  2023/956, Implementing Regulation (EU) 2025/2547, and the EU ETS Monitoring and
  Reporting Regulation (EU) 2018/2066 CBAM's own methodology derives from) — full
  `Decimal` precision is carried through and persisted unrounded, exactly as RULE-EE-001
  already does, deferring the method choice to P9 rather than guessing at it now. This
  rule does not depend on or wait for that unresolved question — it inherits RULE-EE-001's
  own already-approved answer to the identical structural question.
- **Exceptions**: **KNOWN GAP, ESCALATED — NOT YET SAFE FOR ANNEX II GOODS.** RULE-EE-001
  (above) trusts the regulatory dataset's own pre-summed `total` rather than recomputing
  `direct + indirect` in application code *specifically* to avoid silently violating
  Article 7(1) sentence 2 for Annex II goods (iron & steel, aluminium — direct emissions
  only; see RULE-EE-004), and its own register entry states this exception "must be
  reintroduced explicitly" if the engine is ever changed to recompute totals. RULE-EE-009
  performs exactly that recomputation (`AttrEm_g = DirEm + IndirEm`, see Formula below)
  and does **not** reintroduce the Annex II exception — found and independently verified
  in the mandatory RULE-EE-009 engine review (2026-08-29). There is currently no data
  model to detect Annex II membership at all: `cbam_goods` carries only `sector`
  (CEMENT/FERTILISERS/IRON_STEEL/ALUMINIUM/HYDROGEN/ELECTRICITY) and `functional_unit`,
  no Annex II flag. For an Annex II line with a producer-declared non-zero
  `indirect_specific`, RULE-EE-009 currently overstates embedded emissions relative to
  Article 7(1) — not yet a mis-stated financial obligation, since `certificates_due`/
  `liability` remain null until P8/P9's parameter datasets exist, but a real
  correctness gap in the displayed number today. **Not patched in this pass**: per
  CLAUDE.md's facts-as-datasets rule, the fix needs an Annex II code-list dataset entering
  through the same versioned-dataset path `default_emission_values` itself used, which is
  its own research-and-ingestion pass, not something to improvise here — escalated to the
  owner rather than hardcoded. Interim options recorded for that decision: (a) return an
  explicit non-computable status for ACTUAL-method lines whose good may plausibly be
  Annex II until the dataset lands; (b) accept the interim risk with clear internal
  disclosure (this note) given the mitigating P8/P9-gated liability context above; (c)
  something else the owner directs. **Until resolved: RULE-EE-009 should not be treated
  as fully correct for iron & steel or aluminium goods using the ACTUAL method** —
  DEFAULT-method lines for the same goods are unaffected.

  `snapshot.verification.status` is a branded `Extract<VerificationStatus, "VERIFIED">` in
  the `ActualEmissionSnapshot` type itself (`src/domain/emissions/types.ts`), so a
  well-typed snapshot literally cannot carry a non-VERIFIED status. **2026-08-29 (RULE-EE-009
  engine review, fixed)**: that guarantee is compile-time only — a snapshot round-trips
  through `shipment_lines.emission_determination jsonb`
  (`20260828150000_p4_shipment_intake_schema.sql`, no CHECK constraint on that column) and
  is read back through an unchecked cast (`shipment-mapper.ts`), so a runtime value that is
  not `"VERIFIED"` would previously have passed straight through to the formula below
  uncaught. `calculateFromActualDetermination` (`calculate-line-emissions.ts`) now re-checks
  `snapshot.verification.status !== "VERIFIED"` at runtime as its first guard, returning
  `VALUE_UNAVAILABLE` rather than trusting the type — the identical defense-in-depth
  reasoning RULE-EE-001 already applies to a non-`AVAILABLE` resolved `total` (that rule's
  own note: "this is the engine's own defense-in-depth check, not a state P5 is expected to
  produce"), applied here for consistency instead of trusting the type system alone.
  TDD-verified: a test constructing a snapshot with `verification.status` overridden to
  `"REJECTED"` confirmed the engine silently computed a value before this fix, and confirmed
  `VALUE_UNAVAILABLE` after it (`calculate-line-emissions.test.ts`).

  A second, narrower gap was considered and **deliberately left as-is** in the same review:
  `toDecimal(snapshot.values.direct_specific)`/`.indirect_specific` throw an uncaught
  `DecimalError` (rather than returning a discriminated non-computable status) if either
  string is malformed. Not changed, for two reasons. First, precedent already inside this
  same file: `calculateLineEmissions`'s own `quantity === null` guard also throws for a
  state it document as "unreachable given `isLineQuantityValid`'s exactly-one-quantity
  invariant" rather than returning a status — a malformed `DecimalString` on a
  verification-gated snapshot is the same category of "should be impossible, not a normal
  non-computable outcome" as that guard, not the same category as a genuinely expected
  regulatory gap (`VALUE_UNAVAILABLE`, `UNIT_UNSUPPORTED`). Second, unlike
  `snapshot.verification.status` (which loses its type guarantee crossing the JSONB
  boundary), `direct_specific`/`indirect_specific` are protected by real DB-level CHECK
  constraints on `emission_data` (`20260829230000_p7b_emission_data_schema.sql`: regex +
  numeric format), so a malformed value is unreachable through the legitimate
  snapshot-construction path even after the JSONB round-trip — there is no equivalent
  "silently passes through" scenario to defend against. If that constraint is ever relaxed
  or a snapshot-construction path bypasses it, this decision should be revisited.
- **Data/evidence requirements**: none additional at this rule's level — see RULE-EE-002/
  003's own Data/evidence requirements bullets for what the underlying `EmissionData`
  record itself required to become verifiable in the first place; this rule consumes only
  the already-frozen snapshot.
- **Source URL**: `https://eur-lex.europa.eu/eli/reg/2023/956/oj/eng` (Annex IV point 2/3's
  `AttrEm_g = DirEm + IndirEm` sub-formula — see RULE-EE-002/003's own Source URL bullets
  for the full citation of each point).
- **Golden regression fixture**: `src/domain/calculations/calculate-line-emissions.test.ts`
  — an ACTUAL determination on a mass good, an ACTUAL determination on an electricity
  good, exact decimal precision (direct+indirect summed then multiplied, not rounded),
  `UNIT_UNSUPPORTED` for a mismatched basis, a cross-org (shared) determination computing
  identically to an own-org one (the engine does not and should not care about
  `sharing_grant_id`), acceptance of the producer-facing abbreviated unit format
  ("tCO2e/t"/"tCO2e/MWh", not just the regulatory dataset's spelled-out convention), and
  (2026-08-29, RULE-EE-009 engine review) rejection of energy-denominated units that
  happen to contain a bare "/T" substring ("tCO2/TJ", "tCO2e/TWh", "tCO2e/Th" — the
  standard EU ETS MRR emission-factor denominator among them, not contrived strings) on a
  mass line, locking in the fix for a real false-positive found live in that review; and
  (2026-08-29, same review) `VALUE_UNAVAILABLE` — never a computed value — for a snapshot
  whose `verification.status` is not `"VERIFIED"` at runtime despite the type-level
  guarantee, confirmed red (silently computed a value) before the fix and green after.

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

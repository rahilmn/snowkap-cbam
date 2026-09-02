# ADR-0019 — Annex II ACTUAL determinations compute direct-only (D1), and importer-entered external operator data is supported (D2)

- **Status**: Accepted
- **Date**: 2026-09-03
- **Deciders**: Product owner, mid-execution during Phase 3 (P14 release hardening)
- **Supersedes**: the 2026-08-29 interim Annex II gate recorded in
  `docs/regulatory/CALCULATION_RULE_REGISTER.md`; the "importer-entered
  installations are unsupported" scope limit recorded as open decision D2 in the P14
  release plan

## Context

Two limitations surfaced during the P14 release-readiness work and were escalated to the
owner as open decisions D1 and D2. Both were answered on 2026-09-03, while Phase 3
execution was already in progress. This ADR records what was decided, what authority it
rests on, and what risk each decision accepts.

## D1 — Annex II goods: apply the direct-only treatment, do not refuse

### The problem

`calculateFromActualDetermination` returned `PARAMETER_DATASET_UNAVAILABLE` — no number
at all — for an ACTUAL-method line whose good sat in an Annex II sector and whose declared
indirect emissions were non-zero. Any importer with a real supplier reporting both direct
and indirect emissions for iron, steel or aluminium could not calculate that line at all.

The gate was chosen deliberately on 2026-08-29 and was defensible at the time: RULE-EE-009
sums direct and indirect unconditionally, RULE-EE-004 says Annex II goods are direct-only,
and there was no Annex II dataset to reconcile them. Refusing was the conservative
reading. It was also, in practice, an implementation limitation dressed as caution: it
blocked an entire workflow because indirect data merely existed.

### The decision

Annex II ACTUAL determinations are computed from **direct emissions alone**. Non-zero
indirect emissions no longer make the calculation unavailable.

### What this rests on

A regulatory fact already recorded in this project since the P6 register pass, not a new
interpretation:

> Regulation (EU) 2023/956, Article 7(1) sentence 2 — *"For goods listed in Annex II only
> direct emissions shall be calculated and taken into account."*

RULE-EE-004 already stated that if the engine were ever changed to recompute totals from
direct and indirect components, this exception "must be reintroduced explicitly."
RULE-EE-009 made exactly that change on the ACTUAL path and the exception was not
reintroduced. D1 reintroduces it. **No Annex II code list was transcribed, invented or
inferred.**

### What changed

- The engine applies direct-only for goods whose `cbam_goods.sector` is `IRON_STEEL` or
  `ALUMINIUM`, and emits an `ANNEX_II_DIRECT_ONLY` trace step citing RULE-EE-004 and
  carrying `indirect_specific_excluded` — the producer's own figure, recorded and named as
  excluded rather than erased.
- The step is emitted **even when indirect emissions are zero**. The arithmetic is
  identical; the trace is not, and a reader of a frozen calculation must be able to see
  that the treatment was applied rather than infer it.
- `ENGINE_VERSION` 1.2.0 → 1.3.0. Historical rows are not rewritten; they now reproduce as
  `ENGINE_VERSION_CHANGED`, which is the honest answer and the reason the column exists.
- Indirect emissions remain stored on `emission_data` and frozen in the snapshot. They are
  source data, excluded from the CBAM figure, not deleted.
- The "Why this number?" panel states the treatment in words at the result, reading it
  from the frozen steps of the calculation being explained rather than re-deriving it.

### The risk this accepts, and its direction

`cbam_goods.sector` is a **proxy**. Annex II is a CN-code-level list; no such dataset
exists in this project, and building one is a properly sourced ingestion pass that has not
been done.

While the proxy refused, its imprecision was conservative — a non-Annex-II good in those
sectors was blocked needlessly, which is inconvenient and safe. Now that the proxy applies
an exclusion, the same imprecision points the other way: such a good would have its
indirect emissions excluded and would be **under-reported**.

This is recorded as a HIGH-RISK accepted item requiring owner sign-off in the release
report. It is not closed by this ADR. The real fix remains a versioned Annex II CN-code
dataset entering through the same pipeline `default_emission_values` did.

### Boundaries deliberately not crossed

- **DEFAULT-method lines are untouched.** RULE-EE-001 trusts the published dataset's own
  pre-summed total, which is already Annex-II-correct at source; recomputing there would
  be the exact violation RULE-EE-004 warns about.
- **An unresolved sector is not Annex II.** `good_sector: null` means unknown. The engine
  does not guess in either direction.
- **Other guards are unchanged.** An Annex II line with an unusable unit or an unverified
  snapshot is still refused. The treatment changes which figures are summed, never whether
  the record was eligible to be used.

## D2 — Importer-entered external operator and installation data

### The problem

An importer whose supplier is not on Snowkap could not record that supplier's emissions
data at all. The `IMPORTER_ENTERED` provenance value existed in the domain and was unused;
there was no workflow behind it. In practice that made the actual-emissions path
conditional on every third-country operator onboarding first, which is not a reasonable
precondition for a production importer with many suppliers.

### The decision

Snowkap supports importer-entered external operator and installation data in this release.

### The distinction that must not be lost

`IMPORTER_ENTERED` does **not** mean invented or self-certified by the importer. It means
the importer is recording emissions information supplied by an external operator who does
not currently use Snowkap. The product must keep three provenance values distinguishable
everywhere they surface: `DEFAULT`, `OPERATOR_PROVIDED`, `IMPORTER_ENTERED`.

### Integrity rules this decision does not relax

- Captured data, verified data, and calculation-eligible data remain three different
  things. `IMPORTER_ENTERED` + unverified must never behave like `OPERATOR_PROVIDED` +
  verified.
- Evidence authorization, storage security, the verification lifecycle, audit events,
  provenance and immutability all apply unchanged.
- The existing eligibility conditions for using a record as an ACTUAL determination are
  not weakened to make the new workflow easier. Equally, no new regulatory verification
  requirement is invented that the authoritative source does not establish — the controls
  are Snowkap's own, and are labelled as such.

### Security posture

An importer-entered installation is an ordinary tenant-owned aggregate: organisation
ownership, RLS, application-level `OrgContext`, role and capability checks, audit
attribution, active-organisation pinning, no cross-org writes. Entering a third party's
installation must not grant any access to another Snowkap organisation's records, and must
not create a hidden cross-org relationship.

### Forward path, not a rewrite

When an external operator later joins Snowkap and claims their installation, future
determinations use `OPERATOR_PROVIDED`. Historical calculations keep their frozen
snapshots and their original provenance. There is no destructive conversion: the
relationship evolves forward, and history stays true. Any linking path is explicit and
audited.

### UX requirement

The interface must never present importer-entered, unverified data as "verified actual
emissions". The source and the verification state are shown separately, using existing
status language and design tokens.

## Consequences

- The P14 release plan's open decisions D1 and D2 are answered; both move from "owner
  decision required" to "implementation required in this release".
- D1 introduces a new HIGH-RISK accepted item (sector-proxy under-reporting) that did not
  exist while the gate refused.
- D1 bumps the engine version, so every previously persisted calculation reports
  `ENGINE_VERSION_CHANGED` on an on-demand reproducibility check. This is expected and
  must be explained to the owner rather than treated as a regression.
- D2 widens the product's write surface and therefore its security review scope. It is
  reviewed as a boundary change, not as ordinary feature work.
- Neither decision is self-approved. The independent adversarial review and the owner's
  own UAT remain separate checkpoints under the existing execution model.

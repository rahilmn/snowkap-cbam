# ADR-0018: Cast emission-value columns to text to prevent scale loss

## Status

Accepted

## Context

An Opus review raised a concern: canonical source data for some
records has 3-decimal-place emission values (e.g. `"0.280"`), but the
value observed through the database/API path shows as `"0.28"` — same
number, fewer decimal digits. Investigated read-only first, per this
project's standing rule that regulatory-adjacent findings are verified
before any fix is attempted.

**The investigation confirmed this is a real, currently-active defect,
not a benign transport artifact:**

- `direct_value`/`indirect_value`/`total_value` in
  `default_emission_values` are unconstrained Postgres `numeric`
  columns (`supabase/migrations/20260826133116_create_regulatory_foundation.sql`).
  Postgres itself preserves the exact stored scale — the DB storage
  layer is not where the loss happens.
- The Python pipeline produces and loads scale-preserving strings
  (`Decimal` + `format(..., "f")`, e.g. `Decimal("0.280")` formats back
  to `"0.280"`) — the loss does not happen there either.
- A direct, read-only probe against the live database (using the
  adapter's own `getSupabaseClient()`) empirically confirmed the exact
  mechanism: selecting `direct_value`/`total_value` as bare column
  names returns them as JavaScript `number` (e.g. `0.28`, `0.87`,
  `0.9`), not `string`. PostgREST serializes Postgres `numeric` as an
  unquoted JSON number, and `@supabase/postgrest-js`'s `JSON.parse` on
  the HTTP response body collapses `"0.280"` into the IEEE-754 double
  `0.28` — an intrinsic, irreversible property of JSON numbers, which
  carry no scale. `mapRecord()`'s `toStringOrNull()` then faithfully
  stringifies that already-collapsed number, producing `"0.28"`.
  `toStringOrNull()` itself is not buggy — its input had already lost
  scale two layers upstream.
- This directly contradicts ADR-0006's numeric policy: "no
  floating-point number ever touches a regulatory value... `number` is
  never used for these values anywhere in the codebase." At the exact
  point `toStringOrNull()` runs, the value **was** a native JS
  `number` — despite `RegulatoryEmissionValueRow`'s TypeScript type
  declaring it `string | null`, that was an unchecked, un-validated
  compile-time-only assertion (`as unknown as RegulatoryEmissionValueRow[]`)
  that did not match the runtime shape.
- This is not hypothetical: `data/processed/default-emission-values-definitive.json`
  contains the literal value `"0.280"` at 4 locations (plus many other
  trailing-zero values, e.g. `"0.870"`, `"0.900"`, `"2.730"`), and
  `tests/integration/regulatory-resolution.test.ts` already asserted
  `result.record?.total_emissions.value` as `"0.28"` (2 decimal places)
  for the exact `_Other Countries and Territorie` / TARIC `2507008080`
  record whose canonical value is `"0.280"` — in two separate test
  cases (the Bahrain and Kiribati fallback tests) — and that assertion
  was **passing**, i.e. an existing committed test had already locked
  in the truncated value as "correct" rather than catching the defect.
- `direct_raw_source_value`/`indirect_raw_source_value`/
  `total_raw_source_value` are Postgres `text` columns, populated from
  the untouched source cell string before any numeric parsing, and
  passed through the adapter verbatim (no `String()` coercion) — they
  are structurally immune to this specific mechanism and do preserve
  exact fidelity (confirmed against real pipeline output, e.g.
  `raw_source_value: "0,870"` alongside `value: "0.870"`, matching
  scale, differing only by decimal separator). However, no ADR or
  `docs/regulatory/SOURCE_REGISTER.md` designates `raw_source_value` as
  an authoritative fallback for the primary `value` field — its
  immunity is an emergent consequence of its column type, not a
  documented guarantee nothing downstream may rely on `value` directly
  without consulting it.
- `pnpm regulatory:verify`'s field-level reconciliation
  (`scripts/regulatory/verify-definitive-regulatory-data.py`) is
  string-exact comparison (not numeric-tolerant), yet passes 12540/12540
  — because it compares the canonical JSON against what `psycopg3`
  (not PostgREST/JSON) returns for the same `numeric` columns, and
  `psycopg3` adapts Postgres `numeric` to Python `Decimal`, whose
  `str()` preserves scale. The verify gate exercises a different code
  path (direct Postgres wire protocol) than the TypeScript adapter
  (PostgREST/JSON), so it could not have caught this.

## Decision

Cast the three `numeric` columns to `::text` directly in the adapter's
`.select()` (`src/infrastructure/regulatory/supabase-regulatory-repository.ts`),
making Postgres perform the numeric-to-text conversion server-side
(which preserves the stored scale exactly) instead of letting
PostgREST serialize them as JSON numbers. Verified directly (read-only
probe against the live database, deleted after use) that
`select("direct_value::text, total_value::text")` returns
`{"direct_value": "0.210", "total_value": "0.280"}` as JS strings under
the original column names — confirming both the cast syntax and the
fix's effect before committing to it.

Corrected the two masking assertions in
`tests/integration/regulatory-resolution.test.ts` from `"0.28"` to the
true canonical `"0.280"` first (confirmed RED against the unfixed
adapter — `AssertionError: expected '0.28' to be '0.280'`), then
applied the cast and confirmed GREEN. This is not "weakening an
assertion" (forbidden by `CLAUDE.md`) — the prior assertion was itself
wrong, encoding the defect as expected behavior; correcting it to the
true value is the fix being verified, not a relaxation of it.

`raw_source_value` is left as-is (already correct, no change needed).
No change to `src/domain/regulatory/resolve-default-value.ts` (verified
zero-diff) — this is purely an adapter-layer fix, consistent with the
protected-zone rule that the resolver never needs to change for
retrieval-layer defects.

## Alternatives considered

- **Do nothing, treat as a benign transport artifact** — rejected: the
  investigation found a concrete, currently-passing test encoding the
  truncated value as correct, and a direct architectural violation of
  ADR-0006's `number`-never-touches-a-regulatory-value rule. This is
  not "authoritative source fidelity preserved elsewhere and therefore
  fine" — the `value` field is the one the domain resolver and future
  calculation engine actually read; nothing today falls back to
  `raw_source_value`, and no documentation says anything should.
- **Rely on `raw_source_value` instead of fixing `value`** — rejected:
  would require every consumer to know to prefer a comma-decimal,
  undocumented fallback field over the primary value, is a workaround
  rather than a fix, and does nothing to bring the adapter back into
  compliance with ADR-0006.
- **Parse the JS number back into a scale-correct string using the
  source's known precision** — rejected: this is exactly the kind of
  fragile inference the project's regulatory-safety rules forbid
  ("never invent a regulatory value") — reconstructing a scale that has
  already been destroyed is guessing, whereas preventing the
  destruction in the first place (casting server-side, before the
  value ever becomes a JS number) is not.
- **Add a Postgres column-level cast/generated column instead of an
  adapter-level `::text` cast** — rejected as unnecessary schema
  surface for what a query-level cast already solves cleanly, and would
  require a migration (elevated review bar) for no additional benefit.

## Consequences

Any future `.select()` against a `numeric`/`decimal` Postgres column
that will be treated as a `DecimalString` must cast to `::text` in the
query, not rely on TypeScript's compile-time row type to guarantee the
runtime shape — `as unknown as RowType` assertions do not validate
runtime data, as this defect demonstrated. `raw_source_value` remains
the right field to inspect for original-source fidelity/audit review,
even though it is not itself the authoritative field the domain
resolver reads.

## Recovery note (2026-08-28)

A disk-space-driven C:->D: project move lost git history for this
branch's unpushed commits. This ADR and the adapter change it
describes were reapplied from the recovered pre-move working tree
(`D:\projects\snowkap-cbam-recovery-backup`) and re-verified from
scratch rather than trusted blindly: the canonical dataset was
regenerated from the tracked raw source XLSX
(`scripts/regulatory/parse-definitive-default-values.py`, confirmed
12,540 records, matching the verified baseline), the masking
assertions were re-confirmed to currently pass against the live
database (proving the defect was still reproducible, not stale), then
corrected to RED and the fix reapplied to GREEN following the same TDD
sequence described above.

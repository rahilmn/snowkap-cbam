# Decision memo: in-place mutation of shared regulatory reference tables on dataset reload

**Status: OWNER DECISION NEEDED. No pipeline or resolver behavior has
been changed. This memo documents the finding, the mechanism, the
affected scope, and a recommendation — it does not implement one.**

Per CLAUDE.md's protected-regulatory-subsystem rules
(`docs/adr/ADR-0005-protected-regulatory-subsystem.md`), a change here
requires an explicit, evidenced, TDD-backed justification, and this
finding's own nature — whether "keep reference data fresh on every
reload" or "reference data is append-only, corrections are new rows"
is the correct design intent — is a policy decision this session is
not positioned to make unilaterally, not a defect with one obviously
correct fix. `scripts/regulatory/*.py` is explicitly listed as
protected in CLAUDE.md; this memo treats the load script's own
behavior with the same care CLAUDE.md requires for the dataset itself.

## 1. What was found (P13 review, finding S13)

`scripts/regulatory/load-definitive-default-values.py` loads a
`default_emission_values` dataset via an **upsert-by-natural-key**
pattern against three tables that are *shared reference data*, not
part of the versioned `regulatory_datasets` model: `public.countries`,
`public.production_routes`, and `public.cbam_goods`. For each entity
encountered in the source file being loaded, the script:

1. Looks up an existing row by natural key (`countries.name`;
   `production_routes.(code, effective_from)`;
   `cbam_goods.(trade_code, trade_code_type, record_level,
   active_from)`).
2. If found, **UPDATEs that existing row in place** —
   `countries.{iso2, iso3, official_name, active, country_type}`
   (lines 1230–1247), `production_routes.{name, sector,
   source_route_indicator, source_id, effective_to}` (lines 1378–1395),
   `cbam_goods.{record_type, parent_good_id, sector, description,
   functional_unit, active_to}` (lines 1624–1641).
3. If not found, inserts a new row.

Verbatim (the `countries` case; `production_routes`/`cbam_goods`
follow the identical shape):

```python
cur.execute(
    """
    select id::text
      from public.countries
     where name = %s
     limit 1
    """,
    (name,),
)

row = cur.fetchone()

if row is not None:
    country_id = str(row[0])

    cur.execute(
        """
        update public.countries
           set iso2 = %s,
               iso3 = %s,
               official_name = %s,
               active = true,
               country_type = %s
         where id = %s::uuid
        """,
        (iso2, iso3, name, country_type, country_id),
    )
else:
    cur.execute(
        """
        insert into public.countries (...)
        ...
        """,
    )
```

## 2. Why this matters

`default_emission_values.country_id` / `.good_id` /
`.production_route_id` are foreign keys into these SAME reference
tables. Confirmed live (2026-08-30, against the local database that
mirrors the one real load this dataset has ever had):

```
countries:         122 rows, 122 distinct country_id values referenced
                    by default_emission_values (every row reused)
production_routes:  10 rows,  10 distinct production_route_id values referenced
cbam_goods:        283 rows, 283 distinct good_id values referenced
```

Because rows are looked up and reused by natural key rather than
created fresh per dataset load, **every one of these 415 reference
rows is shared across every dataset version that has ever referenced
that same country/route/good** — there is exactly one `countries` row
for "Albania," referenced by `country_id` from whichever
`default_emission_values` rows across whichever dataset versions
happen to concern Albania.

The concrete mechanism a future reload would exercise, which has never
actually happened yet (this dataset has been loaded exactly once —
see §3): if a second `default_emission_values` dataset is ever loaded
(a corrected version, a regime update, a new regulation year) and its
source file spells a country's `iso2`/`iso3`/`country_type`, a route's
`name`/`sector`/`source_route_indicator`, or a good's
`sector`/`description`/`functional_unit` even slightly differently
from how the first load recorded it — the load script overwrites the
EXISTING shared row with the new values. This happens regardless of
whether the OLDER dataset is still `ACTIVE` or has since been
`SUPERSEDED`, and regardless of whether any `shipment_lines` already
hold a frozen `RegulatoryResolutionSnapshot` referencing that dataset
version.

## 3. Scoping: what is and is not at risk

**Not at risk today, evidenced**: exactly one dataset
(`2026-definitive-corrected`) has ever been loaded into this
environment — `select count(*) from public.regulatory_datasets where
dataset_type = 'DEFAULT_EMISSION_VALUES'` returns 1. There is no
second load, past or present, for this mechanism to have actually
fired against. This finding is **latent**, not live-exploitable — the
same posture this session's audit already gave to a structurally
similar gap (the emission-determination forgery fix's finding #6,
dataset status not checked, closed in
`supabase/migrations/20260829580000`).

**Not affected regardless of the decision below**: `default_emission_values`
itself is genuinely append-only per dataset — a new load creates NEW
rows in that table (keyed by `dataset_id`, which IS fresh per load),
never mutates an existing dataset's own rows. A frozen
`RegulatoryResolutionSnapshot`'s `record_identity.origin_country_name`
is a NAME string, and the resolver's own record lookup
(`resolve-default-value.ts`) and this migration series' own DB-level
forgery check
(`app.emission_determination_matches_regulatory_record`,
`supabase/migrations/20260829580000`) both match by `countries.name`,
never by `iso2`/`iso3`/`country_type` — so a historical determination's
ability to be re-verified against its ORIGINAL dataset's own record
identity/values is not broken by this mechanism, because the columns
this pattern mutates are not part of that identity match.

**Potentially affected if the mechanism ever fires**:

- The `RegulatoryCountryMapper` (an importer's declared ISO origin
  country → the regulatory dataset's country name; master plan §15)
  depends on `countries.iso2`/`.iso3` — if a reload silently changes
  which ISO code a country name maps to (or vice versa), a FUTURE
  determination (not a past one) could resolve against a different
  regulatory country than an identical-looking determination made
  before the reload, with no audit trail explaining why.
- `production_routes.source_route_indicator` is the exact string the
  resolver matches a declared production route against (ADR-0010's
  documented resolver contract) — a reload silently changing this for
  an existing route code would change which route indicator a
  historical `code` now maps to for future resolutions.
- None of this touches already-computed, already-frozen
  `CalculationResult` rows or `shipment_lines.emission_determination`
  snapshots directly (per the previous paragraph) — the risk is
  entirely in what a *future* resolution attempt would produce, not in
  silently altering a *past* one.

## 4. Options

**A — Leave as-is (upsert-by-natural-key, update-in-place).** Argument
for: a reference table entry can be corrected (a typo in an official
name, a route's sector reclassified) without a full new-dataset-version
ceremony, and the current single-load history gives no evidence this
has ever actually produced a wrong result. Argument against: this is
exactly the "silent mutation of shared regulatory reference data"
pattern CLAUDE.md's protected-zone rules exist to prevent for the
dataset itself, applied to data one join away from it; a future
multi-dataset-version world (which the master plan's own "regime
versioning" section explicitly anticipates) would have no way to tell
whether a country/route/good's current state matches what any given
historical dataset load actually saw at load time.

**B — Make these three tables append-only too: look up by natural key,
insert-only-if-absent, and if a match is found with DIFFERENT
attribute values than the new load claims, refuse the load (or a
specific row of it) with an explicit, loud error rather than silently
overwriting.** This is the direction CLAUDE.md's own "supersession is a
new version, never mutation" philosophy (already applied to
`regulatory_datasets`/`default_emission_values`) would extend to. It
requires deciding what a legitimate CORRECTION path looks like when one
is genuinely needed (e.g. a versioned reference-table history, or an
explicit, audited, separately-reviewed one-off correction script,
mirroring how `default_emission_values` corrections already work: a
new dataset version, never an in-place edit) — this is real design
work, not a one-line change, which is part of why this memo does not
just implement it.

**C — Version these tables the same way `regulatory_datasets` is
versioned (a `regulatory_dataset_id` or effective-dated history per
country/route/good).** The most structurally complete answer, and the
most invasive — a schema change touching the protected zone's core
tables, well beyond what a P13 remediation pass should take on without
explicit scoping as its own phase of work.

## 5. Recommendation (non-binding)

Option B, scoped narrowly: change the three upsert blocks from
"update existing row" to "insert if absent; if present with different
values, raise a loud pipeline error naming the exact row and the
conflicting values, and require a human to resolve it as an explicit,
separate, reviewed change" — rather than either silently accepting the
current overwrite behavior or attempting the fuller versioning of
option C in this pass. This preserves today's one-load-only behavior
exactly (no observable difference until a second dataset is ever
loaded) while closing the latent gap before it can ever fire silently.
This is a recommendation, not a decision — implementing it changes
pipeline behavior in the protected zone and needs the sign-off this
memo exists to request.

## 6. Exact decision needed

Which of options A/B/C above should
`scripts/regulatory/load-definitive-default-values.py`'s handling of
`countries`/`production_routes`/`cbam_goods` implement — or a fourth
option not listed here? No pipeline code has been changed pending this
decision. If B or C is chosen, that work should land as its own
TDD-backed, `pnpm regulatory:verify`-gated commit, scoped to exactly
that change, per CLAUDE.md's protected-zone discipline — not bundled
with unrelated P13 remediation work.

# P11 performance verification — results

This is the evidence artifact `docs/plans/MASTER_PLAN.md` §38's P11
contract (acceptance item 27, "budgets met with evidence") and §33
("Budgets ... verified P11 with seeded realistic volumes") ask for.
The tooling in this directory existed since the P11 commit
(`8620acf`) but was never actually executed before 2026-08-29 — this
document is that run, not a design.

## Run, 2026-08-29

Seeded via `seed-p11-perf-setup.ts` + `seed-p11-perf-bulk.sql` against
local Postgres: one synthetic org, 50,000 shipments / 50,000
shipment_lines (all in one ANNUAL 2026 reporting period — §33's own
"shipments list filter/paginate < 300 ms at 50k shipments" budget
scale, deliberately the worst case for a single-period query), 44,444
calculation_results.

Measured via `measure-p11-perf.ts`, signed in as a real authenticated
user (RLS-enforced, not a service-role bypass) — 5 runs each, real
wall-clock timing of the real `src/application/**` service function:

| Function | Budget (§33) | min | median | p95 | max |
| --- | --- | --- | --- | --- | --- |
| `listShipments` | < 300 ms at 50k shipments | 29.2 ms | 30.4 ms | 50.0 ms | 50.0 ms |
| `buildPeriodSummary` | not explicitly budgeted; §33's "report export > 10k rows async" is the closest applicable rule | 19,101.7 ms | 19,896.7 ms | 20,974.6 ms | 20,974.6 ms |

**`listShipments`: budget met, with large margin** (p95 50 ms vs. a
300 ms budget).

**`buildPeriodSummary`: two real findings, one fixed, one open.**

1. **Fixed** (`7b03cd3`): the first run of this measurement returned
   `shipment_count: 0` — not slow, *wrong*. `listPeriodShipmentLines`
   (the shared fetch behind `buildPeriodSummary` and the CSV/XLSX
   report export) had no pagination on its shipments query (silently
   truncated to PostgREST's configured `max_rows` = 1000 instead of
   the real 50,000) and batched every collected shipment id into one
   oversized `.in()` filter on the follow-up queries, which fails with
   a real "URI too long" gateway error past a few hundred ids — an
   error this function's own design then silently turned into an
   all-zero result. Fixed by paging the shipments fetch and batching
   the `.in()` calls; verified to return the correct real numbers
   (`shipment_count: 50000`, `calculated_line_count: 40000`, the real
   Decimal-precision total) above. Real regression tests added
   (`list-period-shipment-lines.test.ts`).
2. **Open, not fixed here**: even correct, `buildPeriodSummary` takes
   ~19–21 seconds at this volume — §33 doesn't budget this function by
   name, but its own general rule ("report export > 10k rows async")
   plainly applies to the same "fetch and reduce every line in a
   period" shape of work, and 20 seconds synchronous is not viable for
   a real HTTP request regardless. The actual fix is an async job
   (generate the report in the background, poll/notify when ready),
   which needs a real worker-queue decision master plan §41 already
   lists as still open ("pg-boss adoption timing") — not something to
   improvise inside a performance-verification pass. Flagged here as a
   confirmed, real, currently-unaddressed scalability gap for the P13
   release-readiness report, not silently left for someone to
   rediscover.

## Cleanup

The seeded org, its shipments/lines/calculation_results, and the perf
test auth user were all deleted after this run (`cleanup-p11-perf.ts`
timed out on the cascading delete at this row count; cleanup completed
via direct SQL instead — same end state, confirmed 0 rows remaining).
No perf-seeded data remains in local Postgres.

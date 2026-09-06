import {
  describe,
  expect,
  it,
} from "vitest";

import {
  getDeclarationDetail,
} from "./get-declaration-detail";

const orgId =
  "org-1";

function declarationRow(
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "decl-1",
    org_id: orgId,
    reporting_period_kind: "ANNUAL",
    reporting_period_year: 2026,
    reporting_period_quarter: null,
    status: "FILED_RECORDED",
    member_shipment_ids: ["ship-1"],
    completeness_report: { complete: true, blockers: [] },
    filed_snapshot: { snapshot_version: 1 },
    filed_reference: "EU/CBAM/2026/1",
    filed_at: "2026-02-01T00:00:00Z",
    supersedes_declaration_id: null,
    created_by_user_id: "admin-1",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-02-01T00:00:00Z",
    ...overrides,
  };
}

const shipmentSummaryRow =
  { id: "ship-1", reference: "REF-001", status: "LOCKED" };

/**
 * Same cursor-per-table mock as generate-or-refresh-declaration-draft.test.ts's
 * own makeMockSupabase -- needed here because "declarations" is queried
 * up to three times in one call (the main fetch, the predecessor
 * lineage lookup, the successor lineage lookup).
 */
function makeMockSupabase(
  tables: Record<string, { data: unknown; error: unknown } | { data: unknown; error: unknown }[]>,
  // 2026-09-03 (P14): every `.in()` filter, in order, so the member
  // batching can be asserted rather than inferred from a row count.
  inFilters: { table: string; values: unknown }[] = [],
) {
  const cursors: Record<string, number> =
    {};

  function nextResult(
    table: string,
  ): { data: unknown; error: unknown } {
    const entry =
      tables[table];

    if (!entry) {
      return { data: null, error: null };
    }

    if (!Array.isArray(entry)) {
      return entry;
    }

    const index =
      cursors[table] ?? 0;

    cursors[table] =
      Math.min(index + 1, entry.length - 1);

    return entry[Math.min(index, entry.length - 1)]!;
  }

  function builder(
    table: string,
  ) {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      neq: () => chain,
      in: (_column: string, values: unknown) => {
        inFilters.push({ table, values });
        return chain;
      },
      maybeSingle: () =>
        Promise.resolve(
          nextResult(table),
        ),
      then: (
        resolve: (value: { data: unknown; error: unknown }) => unknown,
        reject: (reason: unknown) => unknown,
      ) =>
        Promise.resolve(
          nextResult(table),
        ).then(resolve, reject),
    };

    return chain;
  }

  return {
    from: (table: string) => builder(table),
  } as never;
}

describe(
  "getDeclarationDetail",
  () => {
    it(
      "resolves member shipments and null lineage for a fresh original with no successor",
      async () => {
        const result =
          await getDeclarationDetail(
            makeMockSupabase(
              {
                declarations: [
                  { data: declarationRow(), error: null },
                  { data: null, error: null },
                ],
                shipments: { data: [shipmentSummaryRow], error: null },
              },
            ),
            "org-1" as never,
            "decl-1" as never,
          );

        expect(result?.declaration.id).toBe(
          "decl-1",
        );

        expect(result?.member_shipments).toEqual(
          [{ id: "ship-1", reference: "REF-001", status: "LOCKED" }],
        );

        expect(result?.supersedes).toBeNull();

        expect(result?.superseded_by).toBeNull();
      },
    );

    it(
      "resolves both ends of the amendment chain when this declaration supersedes one and is itself superseded",
      async () => {
        const result =
          await getDeclarationDetail(
            makeMockSupabase(
              {
                declarations: [
                  { data: declarationRow({ supersedes_declaration_id: "decl-0" }), error: null },
                  { data: { id: "decl-0", status: "FILED_RECORDED", filed_reference: "EU/CBAM/2025/9" }, error: null },
                  { data: { id: "decl-2", status: "DRAFT", filed_reference: null }, error: null },
                ],
                shipments: { data: [shipmentSummaryRow], error: null },
              },
            ),
            "org-1" as never,
            "decl-1" as never,
          );

        expect(result?.supersedes).toEqual(
          { id: "decl-0", status: "FILED_RECORDED", filed_reference: "EU/CBAM/2025/9" },
        );

        expect(result?.superseded_by).toEqual(
          { id: "decl-2", status: "DRAFT", filed_reference: null },
        );
      },
    );

    it(
      "returns null when the declaration doesn't exist (or isn't visible via RLS)",
      async () => {
        const result =
          await getDeclarationDetail(
            makeMockSupabase(
              {
                declarations: { data: null, error: null },
              },
            ),
            "org-1" as never,
            "decl-1" as never,
          );

        expect(result).toBeNull();
      },
    );

    it(
      "returns null (not the row) when the declaration belongs to a different org -- audit-attribution guard",
      async () => {
        const result =
          await getDeclarationDetail(
            makeMockSupabase(
              {
                declarations: { data: declarationRow({ org_id: "org-2" }), error: null },
              },
            ),
            "org-1" as never,
            "decl-1" as never,
          );

        expect(result).toBeNull();
      },
    );

    it(
      "batches the member-shipment lookup instead of building one enormous filter (P14)",
      async () => {
        /**
         * PostgREST puts filters in the query string, so a single
         * unbounded `.in()` over every member id builds a URL the
         * gateway eventually refuses. This was that query, and its
         * `error` was never destructured either -- see the failure case
         * below for what that produced.
         */
        const memberIds =
          Array.from(
            { length: 250 },
            (_unused, index) => `ship-${index}`,
          );

        const inFilters: { table: string; values: unknown }[] =
          [];

        await getDeclarationDetail(
          makeMockSupabase(
            {
              declarations: [
                {
                  data: declarationRow(
                    { member_shipment_ids: memberIds },
                  ),
                  error: null,
                },
                { data: null, error: null },
                { data: null, error: null },
              ],
              shipments: {
                data: [],
                error: null,
              },
            },
            inFilters,
          ),
          orgId as never,
          "decl-1" as never,
        );

        const shipmentBatches =
          inFilters.filter(
            (filter) => filter.table === "shipments",
          );

        // 250 ids at a batch size of 200: two calls, 200 then 50 --
        // never one call with 250.
        expect(
          shipmentBatches.map(
            (batch) => (batch.values as unknown[]).length,
          ),
        ).toEqual(
          [200, 50],
        );
      },
    );

    it(
      "flags completeness_report_stale when a DRAFT declaration's cached report claims complete:true but a member shipment has since been reopened (S5 cross-phase hardening)",
      async () => {
        const result =
          await getDeclarationDetail(
            makeMockSupabase(
              {
                declarations: [
                  {
                    data: declarationRow(
                      {
                        status: "DRAFT",
                        completeness_report: { complete: true, blockers: [] },
                      },
                    ),
                    error: null,
                  },
                  { data: null, error: null },
                ],
                // The reopen trigger (app.invalidate_declaration_approval_on_reopen)
                // flips the DECLARATION back to DRAFT but this live
                // member-shipment read is what actually surfaces the
                // reopened shipment's own current status.
                shipments: { data: [{ id: "ship-1", reference: "REF-001", status: "DRAFT" }], error: null },
              },
            ),
            "org-1" as never,
            "decl-1" as never,
          );

        expect(result?.completeness_report_stale).toBe(
          true,
        );
      },
    );

    it(
      "does not flag completeness_report_stale when every current member shipment is still READY or LOCKED",
      async () => {
        const result =
          await getDeclarationDetail(
            makeMockSupabase(
              {
                declarations: [
                  {
                    data: declarationRow(
                      {
                        status: "FILED_RECORDED",
                        completeness_report: { complete: true, blockers: [] },
                      },
                    ),
                    error: null,
                  },
                  { data: null, error: null },
                ],
                shipments: { data: [shipmentSummaryRow], error: null },
              },
            ),
            "org-1" as never,
            "decl-1" as never,
          );

        expect(result?.completeness_report_stale).toBe(
          false,
        );
      },
    );

    it(
      "does not flag completeness_report_stale when the report already claims incomplete -- only a false 'complete' claim is the dangerous direction",
      async () => {
        const result =
          await getDeclarationDetail(
            makeMockSupabase(
              {
                declarations: [
                  {
                    data: declarationRow(
                      {
                        status: "DRAFT",
                        completeness_report: { complete: false, blockers: [{ reason: "SHIPMENT_NOT_LOCKABLE", shipment_id: "ship-1", shipment_reference: "REF-001" }] },
                      },
                    ),
                    error: null,
                  },
                  { data: null, error: null },
                ],
                shipments: { data: [{ id: "ship-1", reference: "REF-001", status: "DRAFT" }], error: null },
              },
            ),
            "org-1" as never,
            "decl-1" as never,
          );

        expect(result?.completeness_report_stale).toBe(
          false,
        );
      },
    );

    it(
      "2026-09-06 (S5 review remediation, findings A3/EF-B3): flags completeness_report_stale when a member shipment stays READY but its line's DEFAULT determination is resolved against a dataset that is no longer ACTIVE",
      async () => {
        const result =
          await getDeclarationDetail(
            makeMockSupabase(
              {
                declarations: [
                  {
                    data: declarationRow(
                      {
                        status: "READY",
                        completeness_report: { complete: true, blockers: [] },
                      },
                    ),
                    error: null,
                  },
                  { data: null, error: null },
                ],
                shipments: { data: [shipmentSummaryRow], error: null },
                shipment_lines: {
                  data: [
                    { emission_determination: { method: "DEFAULT", resolution: { dataset_id: "dataset-superseded-1" } } },
                  ],
                  error: null,
                },
                // dataset-superseded-1 is deliberately NOT in the ACTIVE
                // set -- a different, currently-active dataset now
                // exists for the same dataset_type.
                regulatory_datasets: { data: [{ id: "dataset-current-1" }], error: null },
              },
            ),
            "org-1" as never,
            "decl-1" as never,
          );

        expect(result?.completeness_report_stale).toBe(
          true,
        );
      },
    );

    it(
      "2026-09-06 (S5 review remediation, findings A3/EF-B3): does NOT flag completeness_report_stale when the member line's dataset is still ACTIVE",
      async () => {
        const result =
          await getDeclarationDetail(
            makeMockSupabase(
              {
                declarations: [
                  {
                    data: declarationRow(
                      {
                        status: "READY",
                        completeness_report: { complete: true, blockers: [] },
                      },
                    ),
                    error: null,
                  },
                  { data: null, error: null },
                ],
                shipments: { data: [shipmentSummaryRow], error: null },
                shipment_lines: {
                  data: [
                    { emission_determination: { method: "DEFAULT", resolution: { dataset_id: "dataset-current-1" } } },
                  ],
                  error: null,
                },
                regulatory_datasets: { data: [{ id: "dataset-current-1" }], error: null },
              },
            ),
            "org-1" as never,
            "decl-1" as never,
          );

        expect(result?.completeness_report_stale).toBe(
          false,
        );
      },
    );

    it(
      "returns null, never a short member list, when a member batch fails (P14)",
      async () => {
        /**
         * The defect this closes, and the more important half.
         *
         * The query's `error` was never destructured and its result went
         * through `?? []`. So a refused request produced an EMPTY member
         * list, and a FILED_RECORDED declaration rendered "No member
         * shipments yet." on its own provenance screen -- the one page
         * whose entire job is to show what was filed.
         *
         * A partial or empty membership list is worse than no page,
         * because it reads as complete. Failing closed is the only
         * honest option for a compliance record.
         */
        const result =
          await getDeclarationDetail(
            makeMockSupabase(
              {
                declarations: [
                  { data: declarationRow(), error: null },
                  { data: null, error: null },
                  { data: null, error: null },
                ],
                shipments: {
                  data: null,
                  error: { message: "URI too long" },
                },
              },
            ),
            orgId as never,
            "decl-1" as never,
          );

        expect(result).toBeNull();
      },
    );
  },
);

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
      // 2026-09-07 (S5 review round 7, finding S5R7-A-B1, guidance
      // dimension): computeCompletenessReportStaleness's new
      // currentPeriodShipmentIds check queries `shipments` with
      // `.is("reporting_period_quarter", null)` for an ANNUAL period,
      // matching compute-declaration-draft-facts.ts's own convention.
      is: () => chain,
      order: () => chain,
      range: () => chain,
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
    // 2026-09-07 (S5 review round 8, finding S5R8-A-B2).
    // anyMemberLineCalculationEngineOutdated calls this RPC once before
    // its own `latest_calculation_results` query -- defaulted here (not
    // per-table like `tables` above, since RPCs aren't table reads) so
    // every pre-existing test that never sets `latest_calculation_results`
    // keeps its prior "not stale on this axis" behavior without change:
    // that table defaults to {data: null, error: null} via nextResult
    // above, and the function fails open (returns false) on `!rows`
    // regardless of what version this RPC reports.
    rpc: () =>
      Promise.resolve(
        { data: "1.1.0", error: null },
      ),
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
      "2026-09-07 (S5 review round 5, finding S5R5-A): throws on a genuine header-query error, distinct from a null row with no error",
      async () => {
        await expect(
          getDeclarationDetail(
            makeMockSupabase(
              {
                declarations: { data: null, error: { message: "connection terminated unexpectedly" } },
              },
            ),
            "org-1" as never,
            "decl-1" as never,
          ),
        ).rejects.toThrow(
          "connection terminated unexpectedly",
        );
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
      "2026-09-07 (S5 review round 5, finding S5R5-GUID-B1): does not flag completeness_report_stale on a VOID declaration, even when a former member shipment has since been reopened to DRAFT -- app.invalidate_declaration_approval_on_reopen only fires for status='READY', never VOID, so this state is reachable and must not send the reader to a 'Generate / refresh draft' control that does not exist for VOID",
      async () => {
        const result =
          await getDeclarationDetail(
            makeMockSupabase(
              {
                declarations: [
                  {
                    data: declarationRow(
                      {
                        status: "VOID",
                        completeness_report: { complete: true, blockers: [] },
                      },
                    ),
                    error: null,
                  },
                  { data: null, error: null },
                ],
                // The exact state a void-then-reopen-the-shipment
                // sequence produces: the declaration's own cached
                // completeness_report is frozen (VOID is terminal), but
                // the member shipment it once referenced is completely
                // free to move through its own, unrelated lifecycle.
                shipments: { data: [{ id: "ship-1", reference: "REF-001", status: "DRAFT" }], error: null },
              },
            ),
            "org-1" as never,
            "decl-1" as never,
          );

        expect(result?.completeness_report_stale).toBe(
          false,
        );

        expect(result?.completeness_report_stale_reason).toBeNull();
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

        expect(result?.completeness_report_stale_reason).toBe(
          "DATASET_SUPERSEDED",
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

        expect(result?.completeness_report_stale_reason).toBeNull();
      },
    );

    it(
      "2026-09-07 (S5 review round 7, finding S5R7-A-B1, guidance dimension): flags completeness_report_stale as PERIOD_MEMBERSHIP_CHANGED when a new shipment has entered the period since this READY declaration's report was generated -- no member shipment's own status needs to change at all",
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
                        member_shipment_ids: ["ship-1"],
                        completeness_report: { complete: true, blockers: [] },
                      },
                    ),
                    error: null,
                  },
                  { data: null, error: null },
                ],
                shipments: [
                  // fetchMemberShipments: the one frozen member, still
                  // LOCKED -- memberStatusStale must stay false so this
                  // new check is even reached.
                  { data: [shipmentSummaryRow], error: null },
                  // currentPeriodShipmentIds: the period NOW also
                  // contains ship-2, a shipment that was never a member
                  // of this declaration at all.
                  { data: [{ id: "ship-1" }, { id: "ship-2" }], error: null },
                ],
              },
            ),
            "org-1" as never,
            "decl-1" as never,
          );

        expect(result?.completeness_report_stale).toBe(
          true,
        );

        expect(result?.completeness_report_stale_reason).toBe(
          "PERIOD_MEMBERSHIP_CHANGED",
        );
      },
    );

    it(
      "2026-09-07 (S5 review round 7, finding S5R7-A-B1, guidance dimension): does NOT flag completeness_report_stale when the period's live non-VOID shipment set still exactly equals the frozen member set",
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
                        member_shipment_ids: ["ship-1"],
                        completeness_report: { complete: true, blockers: [] },
                      },
                    ),
                    error: null,
                  },
                  { data: null, error: null },
                ],
                shipments: [
                  { data: [shipmentSummaryRow], error: null },
                  { data: [{ id: "ship-1" }], error: null },
                ],
              },
            ),
            "org-1" as never,
            "decl-1" as never,
          );

        expect(result?.completeness_report_stale).toBe(
          false,
        );

        expect(result?.completeness_report_stale_reason).toBeNull();
      },
    );

    it(
      "2026-09-07 (S5 review round 8, finding S5R8-NUM-B1, live-reproduced): a transient period-membership query error fails OPEN to 'not stale' rather than throwing and taking down the whole page -- matches the sibling dataset-currency check's own posture",
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
                        member_shipment_ids: ["ship-1"],
                        completeness_report: { complete: true, blockers: [] },
                      },
                    ),
                    error: null,
                  },
                  { data: null, error: null },
                ],
                shipments: [
                  // fetchMemberShipments: succeeds normally.
                  { data: [shipmentSummaryRow], error: null },
                  // currentPeriodShipmentIds: a genuine transient error.
                  { data: null, error: { message: "simulated transient connection reset" } },
                ],
              },
            ),
            "org-1" as never,
            "decl-1" as never,
          );

        expect(result?.completeness_report_stale).toBe(
          false,
        );

        expect(result?.completeness_report_stale_reason).toBeNull();
      },
    );

    it(
      "2026-09-07 (S5 review round 8, finding S5R8-A-B2, live-reproduced through the real record_declaration_filed() RPC): flags completeness_report_stale as CALCULATION_ENGINE_OUTDATED when a member line's latest calculation was produced by an engine version the app no longer runs",
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
                        member_shipment_ids: ["ship-1"],
                        completeness_report: { complete: true, blockers: [] },
                      },
                    ),
                    error: null,
                  },
                  { data: null, error: null },
                ],
                // memberStatusStale must stay false so this axis is even
                // reached -- LOCKED is an accepted member status.
                shipments: { data: [shipmentSummaryRow], error: null },
                latest_calculation_results: {
                  data: [{ line_id: "line-1", engine_version: "0.9.0" }],
                  error: null,
                },
              },
            ),
            "org-1" as never,
            "decl-1" as never,
          );

        expect(result?.completeness_report_stale).toBe(
          true,
        );

        expect(result?.completeness_report_stale_reason).toBe(
          "CALCULATION_ENGINE_OUTDATED",
        );
      },
    );

    it(
      "2026-09-07 (S5 review round 8, finding S5R8-A-B2): does NOT flag CALCULATION_ENGINE_OUTDATED when every member line's latest calculation matches the current engine version",
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
                        member_shipment_ids: ["ship-1"],
                        completeness_report: { complete: true, blockers: [] },
                      },
                    ),
                    error: null,
                  },
                  { data: null, error: null },
                ],
                shipments: { data: [shipmentSummaryRow], error: null },
                // makeMockSupabase's own rpc() default reports "1.1.0" --
                // matching that here keeps this axis "not stale."
                latest_calculation_results: {
                  data: [{ line_id: "line-1", engine_version: "1.1.0" }],
                  error: null,
                },
              },
            ),
            "org-1" as never,
            "decl-1" as never,
          );

        expect(result?.completeness_report_stale).toBe(
          false,
        );

        expect(result?.completeness_report_stale_reason).toBeNull();
      },
    );

    it(
      "2026-09-06 (S5 review remediation round 2, finding EF2-B1): a FILED_RECORDED declaration is NEVER reported stale by a dataset supersession -- it is an immutable historical record",
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
                // Member shipment is LOCKED (what filing itself sets) --
                // memberStatusStale is already false via the allowed
                // set, so this test isolates the datasetStale guard.
                shipments: { data: [{ id: "ship-1", reference: "REF-001", status: "LOCKED" }], error: null },
                shipment_lines: {
                  data: [
                    { emission_determination: { method: "DEFAULT", resolution: { dataset_id: "dataset-superseded-1" } } },
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

        expect(result?.completeness_report_stale_reason).toBeNull();
      },
    );

    it(
      "2026-09-06 (S5 review remediation round 2, finding EF2-B1): a VOID declaration is likewise never reported stale",
      async () => {
        const result =
          await getDeclarationDetail(
            makeMockSupabase(
              {
                declarations: [
                  {
                    data: declarationRow(
                      {
                        status: "VOID",
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
      "2026-09-06 (S5 review remediation round 2, finding EF2-B1): a DRAFT declaration IS still checked for dataset supersession -- the guard is a status allowlist, not a blanket skip",
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
                shipments: { data: [shipmentSummaryRow], error: null },
                shipment_lines: {
                  data: [
                    { emission_determination: { method: "DEFAULT", resolution: { dataset_id: "dataset-superseded-1" } } },
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
          true,
        );

        expect(result?.completeness_report_stale_reason).toBe(
          "DATASET_SUPERSEDED",
        );
      },
    );

    it(
      "2026-09-06 (S5 review remediation round 2, finding EF2-B3): completeness_report_stale_reason is MEMBER_REOPENED, not DATASET_SUPERSEDED, when a member shipment left READY/LOCKED",
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
                shipments: { data: [{ id: "ship-1", reference: "REF-001", status: "DRAFT" }], error: null },
              },
            ),
            "org-1" as never,
            "decl-1" as never,
          );

        expect(result?.completeness_report_stale).toBe(
          true,
        );

        expect(result?.completeness_report_stale_reason).toBe(
          "MEMBER_REOPENED",
        );
      },
    );

    it(
      "2026-09-06 (S5 review remediation round 2, finding EF2-B2): batches member ids at MEMBER_ID_BATCH_SIZE for the dataset-currency check, matching fetchMemberShipments' own batching",
      async () => {
        const manyShipmentIds =
          Array.from(
            { length: 250 },
            (_unused, index) => `ship-${index}`,
          );

        const manyShipmentRows =
          manyShipmentIds.map(
            (id) => ({ id, reference: id, status: "READY" }),
          );

        const inFilters: { table: string; values: unknown }[] =
          [];

        await getDeclarationDetail(
          makeMockSupabase(
            {
              declarations: [
                {
                  data: declarationRow(
                    {
                      status: "READY",
                      member_shipment_ids: manyShipmentIds,
                      completeness_report: { complete: true, blockers: [] },
                    },
                  ),
                  error: null,
                },
                { data: null, error: null },
              ],
              shipments: { data: manyShipmentRows, error: null },
              shipment_lines: { data: [], error: null },
              regulatory_datasets: { data: [{ id: "dataset-current-1" }], error: null },
            },
            inFilters,
          ),
          "org-1" as never,
          "decl-1" as never,
        );

        const shipmentLineIdFilters =
          inFilters.filter(
            (entry) => entry.table === "shipment_lines",
          );

        // 250 member ids at MEMBER_ID_BATCH_SIZE=200 must produce TWO
        // batched .in() calls (200 + 50), never one unbounded call.
        expect(shipmentLineIdFilters.length).toBe(
          2,
        );

        expect(
          (shipmentLineIdFilters[0]!.values as unknown[]).length,
        ).toBe(
          200,
        );

        expect(
          (shipmentLineIdFilters[1]!.values as unknown[]).length,
        ).toBe(
          50,
        );
      },
    );

    it(
      "2026-09-07 (S5 review round 5, finding S5R5-A): throws, never a short/empty member list, when a member batch fails",
      async () => {
        /**
         * The defect this closes, and the more important half.
         *
         * The query's `error` was originally never destructured and its
         * result went through `?? []`. So a refused request produced an
         * EMPTY member list, and a FILED_RECORDED declaration rendered
         * "No member shipments yet." on its own provenance screen -- the
         * one page whose entire job is to show what was filed.
         *
         * A partial or empty membership list is worse than no page,
         * because it reads as complete. Throwing (P14's original "return
         * null" was itself later found, round 5, to fold this into the
         * SAME null a genuinely nonexistent/invisible declaration uses --
         * silently redirecting a user away from a real compliance record)
         * is the only honest option for a genuine infrastructure failure.
         */
        await expect(
          getDeclarationDetail(
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
          ),
        ).rejects.toThrow(
          "URI too long",
        );
      },
    );
  },
);

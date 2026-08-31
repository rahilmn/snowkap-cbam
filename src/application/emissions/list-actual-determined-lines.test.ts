import {
  describe,
  expect,
  it,
} from "vitest";

import {
  listActualDeterminedLines,
} from "./list-actual-determined-lines";

const orgId =
  "org-1" as never;

const ownSnapshot =
  {
    emission_data_id: "emission-data-1",
    emission_data_version: 1,
    installation_id: "installation-1",
    resolved_at: "2026-01-01T00:00:00.000Z",

    values: {
      direct_specific: "1.5",
      indirect_specific: "0.2",
    },

    emission_unit: "tCO2e/t",
    methodology: "EU_METHOD",

    verification: {
      status: "VERIFIED" as const,
      verifier_user_id: "admin-1",
    },

    evidence_file_ids: ["evidence-1"],
    sharing_grant_id: null,
  };

const sharedSnapshot =
  {
    ...ownSnapshot,
    emission_data_id: "emission-data-2",
    installation_id: "installation-2",
    sharing_grant_id: "grant-1",
  };

function actualLineRow(
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "line-1",
    shipment_id: "shipment-1",
    org_id: "org-1",
    line_number: 1,
    cn_code: "72081000",
    cn_code_level: "CN8",
    goods_description: "Hot-rolled coil",
    origin_country: "DE",
    net_mass_tonnes: "10",
    quantity_mwh: null,
    production_route_name: null,
    production_route_indicator: null,
    emission_determination: {
      method: "ACTUAL",
      snapshot: ownSnapshot,
    },
    ...overrides,
  };
}

const shipmentRow =
  {
    id: "shipment-1",
    org_id: "org-1",
    reference: "SHIP-001",
    release_date: "2026-01-15",
    reporting_period_kind: "ANNUAL",
    reporting_period_year: 2026,
    reporting_period_quarter: null,
    customs_mrn: null,
    customs_procedure: null,
    status: "READY",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };

const currentActiveRowSameVersion =
  {
    id: "emission-data-1",
    installation_id: "installation-1",
    entered_by_org_id: "org-1",
    cn_scope: ["72081000"],
    reporting_period_kind: "ANNUAL",
    reporting_period_year: 2026,
    reporting_period_quarter: null,
    direct_specific: "1.5",
    indirect_specific: "0.2",
    emission_unit: "tCO2e/t",
    methodology: "EU_METHOD",
    verification_status: "VERIFIED",
    verifier_user_id: "admin-1",
    rejection_reason: null,
    evidence_file_ids: ["evidence-1"],
    version: 1,
    predecessor_id: null,
    status: "ACTIVE",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };

const currentActiveRowNewerVersion =
  {
    ...currentActiveRowSameVersion,
    id: "emission-data-3",
    version: 2,
    predecessor_id: "emission-data-1",
  };

interface Op {
  table: string;
  op: "select";
  filters: [string, unknown][];
}

interface Recorder {
  fromCalls: string[];
  ops: Op[];
}

/**
 * Same generic per-table chainable select-only mock shape as
 * list-available-actual-data.test.ts's / check-actual-determination-
 * staleness.test.ts's own makeMockSupabase (this codebase's established
 * pattern) -- `checkActualDeterminationStalenessByShipment` is called
 * internally by the function under test, so every table it queries
 * (`emission_data`) needs the same chain shape as its own test file
 * relies on (`.is()` included).
 */
function makeMockSupabase(
  tables: Record<string, { data: unknown; error: unknown }>,
  recorder: Recorder = { fromCalls: [], ops: [] },
) {
  function builder(
    table: string,
  ) {
    const filters: [string, unknown][] =
      [];

    const chain: Record<string, unknown> = {
      select: () => {
        recorder.ops.push({ table, op: "select", filters });
        return chain;
      },
      eq: (col: string, val: unknown) => {
        filters.push([col, val]);
        return chain;
      },
      in: (col: string, vals: unknown) => {
        filters.push([col, vals]);
        return chain;
      },
      is: (col: string, val: unknown) => {
        filters.push([col, val]);
        return chain;
      },
      order: () => chain,
      then: (
        resolve: (value: { data: unknown; error: unknown }) => unknown,
        reject: (reason: unknown) => unknown,
      ) =>
        Promise.resolve(
          tables[table] ?? { data: null, error: null },
        ).then(resolve, reject),
    };

    return chain;
  }

  return {
    from: (table: string) => {
      recorder.fromCalls.push(table);
      return builder(table);
    },

    // 2026-08-31: see the identical note in
    // list-available-actual-data.test.ts -- the grantor-org-name lookup
    // now goes through app.sharing_counterparty_org_names(), keyed on
    // "organizations" here so existing fixtures keep their meaning.
    rpc: (fnName: string) => {
      recorder.fromCalls.push(`rpc:${fnName}`);
      return Promise.resolve(
        tables.organizations ?? { data: null, error: null },
      );
    },
  } as never;
}

describe(
  "listActualDeterminedLines",
  () => {
    it(
      "returns one row per ACTUAL-determined shipment line, joined with its shipment reference, labeled OWN when there is no sharing grant",
      async () => {
        const result =
          await listActualDeterminedLines(
            makeMockSupabase(
              {
                shipment_lines: { data: [actualLineRow()], error: null },
                shipments: { data: [shipmentRow], error: null },
                emission_data: { data: [currentActiveRowSameVersion], error: null },
              },
            ),
            orgId,
          );

        expect(result).toEqual(
          [
            {
              line_id: "line-1",
              shipment_id: "shipment-1",
              shipment_reference: "SHIP-001",
              line_number: 1,
              cn_code: "72081000",
              goods_description: "Hot-rolled coil",
              origin_country: "DE",
              methodology: "EU_METHOD",
              provenance: "OWN",
              grantor_organization_name: null,
              staleness: "CURRENT",
            },
          ],
        );
      },
    );

    it(
      "labels a SHARED determination and resolves the grantor org's name via the sharing grant it was read through",
      async () => {
        const result =
          await listActualDeterminedLines(
            makeMockSupabase(
              {
                shipment_lines: {
                  data: [
                    actualLineRow({
                      id: "line-2",
                      emission_determination: { method: "ACTUAL", snapshot: sharedSnapshot },
                    }),
                  ],
                  error: null,
                },
                shipments: { data: [shipmentRow], error: null },
                emission_data: { data: [], error: null },
                sharing_grants: { data: [{ id: "grant-1", grantor_org_id: "org-producer" }], error: null },
                organizations: { data: [{ id: "org-producer", name: "Acme Steel Producer" }], error: null },
              },
            ),
            orgId,
          );

        expect(result).toEqual(
          [
            expect.objectContaining(
              {
                provenance: "SHARED",
                grantor_organization_name: "Acme Steel Producer",
              },
            ),
          ],
        );
      },
    );

    it(
      "falls back to a placeholder grantor name, rather than dropping the row, when the sharing grant id resolves to no organizations row",
      async () => {
        const result =
          await listActualDeterminedLines(
            makeMockSupabase(
              {
                shipment_lines: {
                  data: [
                    actualLineRow({
                      id: "line-2",
                      emission_determination: { method: "ACTUAL", snapshot: sharedSnapshot },
                    }),
                  ],
                  error: null,
                },
                shipments: { data: [shipmentRow], error: null },
                emission_data: { data: [], error: null },
                sharing_grants: { data: [{ id: "grant-1", grantor_org_id: "org-producer" }], error: null },
                organizations: { data: [], error: null },
              },
            ),
            orgId,
          );

        expect(result[0]?.grantor_organization_name).toBe(
          "Unknown organization",
        );
      },
    );

    it(
      "marks a line STALE when its installation now has a higher-versioned ACTIVE row than the frozen snapshot",
      async () => {
        const result =
          await listActualDeterminedLines(
            makeMockSupabase(
              {
                shipment_lines: { data: [actualLineRow()], error: null },
                shipments: { data: [shipmentRow], error: null },
                emission_data: { data: [currentActiveRowNewerVersion], error: null },
              },
            ),
            orgId,
          );

        expect(result[0]?.staleness).toBe(
          "STALE",
        );
      },
    );

    it(
      "sorts STALE lines before CURRENT lines",
      async () => {
        const staleLineRow =
          actualLineRow(
            {
              id: "line-stale",
              shipment_id: "shipment-1",
              line_number: 2,
              emission_determination: {
                method: "ACTUAL",
                snapshot: { ...ownSnapshot, emission_data_id: "emission-data-1" },
              },
            },
          );

        const currentLineRow =
          actualLineRow(
            {
              id: "line-current",
              shipment_id: "shipment-1",
              line_number: 1,
              emission_determination: {
                method: "ACTUAL",
                snapshot: { ...ownSnapshot, installation_id: "installation-9", emission_data_id: "emission-data-9" },
              },
            },
          );

        const result =
          await listActualDeterminedLines(
            makeMockSupabase(
              {
                shipment_lines: { data: [currentLineRow, staleLineRow], error: null },
                shipments: { data: [shipmentRow], error: null },
                // Only installation-1 (staleLineRow's) has a newer version
                // on offer -- installation-9 (currentLineRow's) has
                // nothing ACTIVE at all, so it stays CURRENT.
                emission_data: { data: [currentActiveRowNewerVersion], error: null },
              },
            ),
            orgId,
          );

        expect(result.map((row) => row.line_id)).toEqual(
          ["line-stale", "line-current"],
        );
      },
    );

    it(
      "returns an empty array, without querying shipments at all, when the org has no ACTUAL-determined lines",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        const result =
          await listActualDeterminedLines(
            makeMockSupabase(
              {
                shipment_lines: { data: [], error: null },
              },
              recorder,
            ),
            orgId,
          );

        expect(result).toEqual(
          [],
        );

        expect(
          recorder.fromCalls.includes("shipments"),
        ).toBe(
          false,
        );
      },
    );

    it(
      "returns an empty array on a shipment_lines fetch error",
      async () => {
        const result =
          await listActualDeterminedLines(
            makeMockSupabase(
              {
                shipment_lines: { data: null, error: { message: "denied" } },
              },
            ),
            orgId,
          );

        expect(result).toEqual(
          [],
        );
      },
    );

    it(
      "returns an empty array on a shipments fetch error",
      async () => {
        const result =
          await listActualDeterminedLines(
            makeMockSupabase(
              {
                shipment_lines: { data: [actualLineRow()], error: null },
                shipments: { data: null, error: { message: "denied" } },
              },
            ),
            orgId,
          );

        expect(result).toEqual(
          [],
        );
      },
    );

    it(
      "returns an empty array -- rather than a false 'Unknown organization' placeholder for every SHARED row -- when the sharing_grants follow-up lookup itself errors",
      async () => {
        const result =
          await listActualDeterminedLines(
            makeMockSupabase(
              {
                shipment_lines: {
                  data: [
                    actualLineRow({
                      id: "line-2",
                      emission_determination: { method: "ACTUAL", snapshot: sharedSnapshot },
                    }),
                  ],
                  error: null,
                },
                shipments: { data: [shipmentRow], error: null },
                emission_data: { data: [], error: null },
                sharing_grants: { data: null, error: { message: "denied" } },
              },
            ),
            orgId,
          );

        expect(result).toEqual(
          [],
        );
      },
    );

    it(
      "returns an empty array when the organizations follow-up lookup itself errors",
      async () => {
        const result =
          await listActualDeterminedLines(
            makeMockSupabase(
              {
                shipment_lines: {
                  data: [
                    actualLineRow({
                      id: "line-2",
                      emission_determination: { method: "ACTUAL", snapshot: sharedSnapshot },
                    }),
                  ],
                  error: null,
                },
                shipments: { data: [shipmentRow], error: null },
                emission_data: { data: [], error: null },
                sharing_grants: { data: [{ id: "grant-1", grantor_org_id: "org-producer" }], error: null },
                organizations: { data: null, error: { message: "denied" } },
              },
            ),
            orgId,
          );

        expect(result).toEqual(
          [],
        );
      },
    );

    it(
      "skips a line whose shipment row wasn't found, rather than rendering a broken row",
      async () => {
        const result =
          await listActualDeterminedLines(
            makeMockSupabase(
              {
                shipment_lines: { data: [actualLineRow()], error: null },
                shipments: { data: [], error: null },
              },
            ),
            orgId,
          );

        expect(result).toEqual(
          [],
        );
      },
    );

    it(
      "does not query sharing_grants or organizations at all when every visible ACTUAL line is OWN",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        await listActualDeterminedLines(
          makeMockSupabase(
            {
              shipment_lines: { data: [actualLineRow()], error: null },
              shipments: { data: [shipmentRow], error: null },
              emission_data: { data: [currentActiveRowSameVersion], error: null },
            },
            recorder,
          ),
          orgId,
        );

        expect(
          recorder.fromCalls.includes("sharing_grants"),
        ).toBe(
          false,
        );

        expect(
          recorder.fromCalls.includes("organizations"),
        ).toBe(
          false,
        );
      },
    );

    it(
      "filters the shipment_lines query to this org and to ACTUAL determinations only (Wall 1 defense in depth, not relying on RLS alone)",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        await listActualDeterminedLines(
          makeMockSupabase(
            {
              shipment_lines: { data: [], error: null },
            },
            recorder,
          ),
          orgId,
        );

        const shipmentLinesSelect =
          recorder.ops.find(
            (op) => op.table === "shipment_lines",
          );

        expect(shipmentLinesSelect?.filters).toContainEqual(
          ["org_id", orgId],
        );

        expect(shipmentLinesSelect?.filters).toContainEqual(
          ["determination_method", "ACTUAL"],
        );
      },
    );
  },
);

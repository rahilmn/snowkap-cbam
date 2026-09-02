import {
  describe,
  expect,
  it,
} from "vitest";

import {
  checkActualDeterminationStalenessByShipment,
} from "./check-actual-determination-staleness";

import type {
  ShipmentLine,
} from "../../domain/shipments/types";

const annualPeriod =
  { kind: "ANNUAL" as const, year: 2026 };

const actualDeterminationSnapshot =
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

function actualLine(
  overrides: Partial<ShipmentLine> = {},
): ShipmentLine {
  return {
    id: "line-1",
    shipment_id: "shipment-1",
    org_id: "org-1",
    line_number: 1,
    cn_code: "72081000",
    cn_code_level: "CN8",
    goods_description: null,
    origin_country: "DE",
    net_mass_tonnes: "10",
    quantity_mwh: null,
    production_route: null,
    emission_determination: {
      method: "ACTUAL",
      snapshot: actualDeterminationSnapshot,
    },
    ...overrides,
  } as ShipmentLine;
}

function defaultLine(
  overrides: Partial<ShipmentLine> = {},
): ShipmentLine {
  return {
    ...actualLine(overrides),
    id: "line-2",
    emission_determination: {
      method: "DEFAULT",
      resolution: {} as never,
    },
    ...overrides,
  } as ShipmentLine;
}

function undeterminedLine(
  overrides: Partial<ShipmentLine> = {},
): ShipmentLine {
  return {
    ...actualLine(overrides),
    id: "line-3",
    emission_determination: null,
    ...overrides,
  } as ShipmentLine;
}

const currentActiveRowSameVersion =
  {
    id: "emission-data-1",
    installation_id: "installation-1",
    entered_by_org_id: "org-producer",
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
    id: "emission-data-2",
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
 * list-available-actual-data.test.ts's own makeMockSupabase, with `.is()`
 * added (manage-emission-data.test.ts's own precedent for that operator)
 * since reportingPeriodColumns' ANNUAL branch filters via
 * `.is("reporting_period_quarter", null)`.
 */
/**
 * 2026-09-03 (P14). The fixtures in this file describe a SHARED
 * installation (entered_by_org_id is "org-producer", the caller is
 * "org-1"), and since the active-org pin was added a shared row only
 * produces a staleness signal when the caller currently holds a live
 * grant for it. That grant is therefore part of the scenario these tests
 * have always been describing, and is supplied by default here rather
 * than repeated in every case.
 *
 * A caller that passes its own `sharing_grants` entry -- including an
 * empty one, meaning revoked -- overrides it. See the two tests at the
 * end of this file, which is where that matters.
 */
function makeMockSupabase(
  tables: Record<string, { data: unknown; error: unknown }>,
  recorder: Recorder = { fromCalls: [], ops: [] },
) {
  const withDefaults: Record<string, { data: unknown; error: unknown }> =
    {
      sharing_grants: {
        data: [
          {
            installation_id: "installation-1",
            expires_at: null,
          },
        ],
        error: null,
      },

      ...tables,
    };

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
      then: (
        resolve: (value: { data: unknown; error: unknown }) => unknown,
        reject: (reason: unknown) => unknown,
      ) =>
        Promise.resolve(
          withDefaults[table] ?? { data: null, error: null },
        ).then(resolve, reject),
    };

    return chain;
  }

  return {
    from: (table: string) => {
      recorder.fromCalls.push(table);
      return builder(table);
    },
  } as never;
}

describe(
  "checkActualDeterminationStalenessByShipment",
  () => {
    it(
      "reports CURRENT for an ACTUAL line whose source record is still the current ACTIVE version",
      async () => {
        const result =
          await checkActualDeterminationStalenessByShipment(
            makeMockSupabase(
              {
                emission_data: { data: [currentActiveRowSameVersion], error: null },
              },
            ),
            "org-1" as never,
            [actualLine()],
            annualPeriod,
          );

        expect(result).toEqual(
          { "line-1": "CURRENT" },
        );
      },
    );

    it(
      "reports STALE for an ACTUAL line whose installation now has a higher-versioned ACTIVE row",
      async () => {
        const result =
          await checkActualDeterminationStalenessByShipment(
            makeMockSupabase(
              {
                emission_data: { data: [currentActiveRowNewerVersion], error: null },
              },
            ),
            "org-1" as never,
            [actualLine()],
            annualPeriod,
          );

        expect(result).toEqual(
          { "line-1": "STALE" },
        );
      },
    );

    it(
      "reports CURRENT when no ACTIVE row is visible at all for the installation+period",
      async () => {
        const result =
          await checkActualDeterminationStalenessByShipment(
            makeMockSupabase(
              {
                emission_data: { data: [], error: null },
              },
            ),
            "org-1" as never,
            [actualLine()],
            annualPeriod,
          );

        expect(result).toEqual(
          { "line-1": "CURRENT" },
        );
      },
    );

    it(
      "omits DEFAULT-determined and undetermined lines from the result entirely, rather than reporting a staleness status for them",
      async () => {
        const result =
          await checkActualDeterminationStalenessByShipment(
            makeMockSupabase(
              {
                emission_data: { data: [currentActiveRowSameVersion], error: null },
              },
            ),
            "org-1" as never,
            [actualLine(), defaultLine(), undeterminedLine()],
            annualPeriod,
          );

        expect(Object.keys(result)).toEqual(
          ["line-1"],
        );
      },
    );

    it(
      "returns an empty record without querying emission_data at all when the shipment has no ACTUAL-determined lines",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        const result =
          await checkActualDeterminationStalenessByShipment(
            makeMockSupabase(
              {
                emission_data: { data: [currentActiveRowSameVersion], error: null },
              },
              recorder,
            ),
            "org-1" as never,
            [defaultLine(), undeterminedLine()],
            annualPeriod,
          );

        expect(result).toEqual(
          {},
        );

        expect(
          recorder.fromCalls.includes("emission_data"),
        ).toBe(
          false,
        );
      },
    );

    it(
      "returns an empty record (fails closed, no false staleness signal) on an emission_data fetch error",
      async () => {
        const result =
          await checkActualDeterminationStalenessByShipment(
            makeMockSupabase(
              {
                emission_data: { data: null, error: { message: "denied" } },
              },
            ),
            "org-1" as never,
            [actualLine()],
            annualPeriod,
          );

        expect(result).toEqual(
          {},
        );
      },
    );

    it(
      "filters the emission_data query to status=ACTIVE and the shipment's own reporting period",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        await checkActualDeterminationStalenessByShipment(
          makeMockSupabase(
            {
              emission_data: { data: [], error: null },
            },
            recorder,
          ),
            "org-1" as never,
          [actualLine()],
          annualPeriod,
        );

        const emissionDataSelect =
          recorder.ops.find(
            (op) => op.table === "emission_data",
          );

        expect(emissionDataSelect?.filters).toContainEqual(
          ["status", "ACTIVE"],
        );

        expect(emissionDataSelect?.filters).toContainEqual(
          ["reporting_period_kind", "ANNUAL"],
        );

        expect(emissionDataSelect?.filters).toContainEqual(
          ["reporting_period_year", 2026],
        );
      },
    );

    /**
     * 2026-09-03 (P14). app.user_shared_installation_ids() resolves
     * grants for every org the USER belongs to, not the org they are
     * acting as -- so RLS alone would keep showing org A a staleness
     * signal for an installation whose grant to A was revoked, purely
     * because the same person also belongs to org B which still holds
     * one. That signal is itself a disclosure: it tells A that the
     * producer has published a newer verified version, which is exactly
     * what revoking access was supposed to stop telling them.
     */
    it(
      "reports CURRENT, not STALE, for a shared installation this org no longer holds a live grant for",
      async () => {
        const result =
          await checkActualDeterminationStalenessByShipment(
            makeMockSupabase(
              {
                emission_data: { data: [currentActiveRowNewerVersion], error: null },

                // Revoked: the grant lookup returns nothing for this org.
                sharing_grants: { data: [], error: null },
              },
            ),
            "org-1" as never,
            [actualLine()],
            annualPeriod,
          );

        expect(result).toEqual(
          { "line-1": "CURRENT" },
        );
      },
    );

    it(
      "reports CURRENT for a shared installation whose grant has lapsed, even though its status is still ACTIVE",
      async () => {
        // There is no expiry job, so a lapsed grant sits at ACTIVE with
        // expires_at in the past indefinitely. The status alone is not
        // enough to decide this.
        const result =
          await checkActualDeterminationStalenessByShipment(
            makeMockSupabase(
              {
                emission_data: { data: [currentActiveRowNewerVersion], error: null },
                sharing_grants: {
                  data: [
                    {
                      installation_id: "installation-1",
                      expires_at: "2020-01-01T00:00:00.000Z",
                    },
                  ],
                  error: null,
                },
              },
            ),
            "org-1" as never,
            [actualLine()],
            annualPeriod,
          );

        expect(result).toEqual(
          { "line-1": "CURRENT" },
        );
      },
    );

    it(
      "asks about grants only for installations whose data belongs to another org",
      async () => {
        // An org looking at its own data already knows the answer, so it
        // should issue no second query at all.
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        await checkActualDeterminationStalenessByShipment(
          makeMockSupabase(
            {
              emission_data: {
                data: [
                  {
                    ...currentActiveRowSameVersion,
                    entered_by_org_id: "org-1",
                  },
                ],
                error: null,
              },
            },
            recorder,
          ),
          "org-1" as never,
          [actualLine()],
          annualPeriod,
        );

        expect(
          recorder.fromCalls.includes("sharing_grants"),
        ).toBe(
          false,
        );
      },
    );
  },
);

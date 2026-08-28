import {
  describe,
  expect,
  it,
} from "vitest";

import {
  listAvailableActualEmissionData,
} from "./list-available-actual-data";

const orgId =
  "org-1" as never;

const ownRow =
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
    evidence_file_ids: [],
    version: 1,
    predecessor_id: null,
    status: "ACTIVE",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };

const sharedRow =
  {
    ...ownRow,
    id: "emission-data-2",
    installation_id: "installation-2",
    entered_by_org_id: "org-2",
  };

const installationRows =
  [
    { id: "installation-1", name: "Steel Works A", country: "DE" },
    { id: "installation-2", name: "Steel Works B", country: "IN" },
  ];

const activeGrantForInstallation2 =
  [
    { installation_id: "installation-2", expires_at: null },
  ];

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
 * Same generic per-table chainable mock shape as
 * manage-emission-data.test.ts's / determine-from-actual-data.test.ts's
 * own makeMockSupabase (this codebase's established pattern), with `.in()`
 * added since listAvailableActualEmissionData's second (installations)
 * query uses it.
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
  } as never;
}

describe(
  "listAvailableActualEmissionData",
  () => {
    it(
      "labels the caller's own-org row as OWN and includes the joined installation name/country",
      async () => {
        const result =
          await listAvailableActualEmissionData(
            makeMockSupabase(
              {
                emission_data: { data: [ownRow], error: null },
                installations: { data: installationRows, error: null },
              },
            ),
            orgId,
          );

        expect(result).toEqual(
          [
            {
              emission_data_id: "emission-data-1",
              installation_id: "installation-1",
              installation_name: "Steel Works A",
              installation_country: "DE",
              direct_specific: "1.5",
              indirect_specific: "0.2",
              emission_unit: "tCO2e/t",
              methodology: "EU_METHOD",
              reporting_period: { kind: "ANNUAL", year: 2026 },
              provenance: "OWN",
            },
          ],
        );
      },
    );

    it(
      "labels a row entered by a different org as SHARED, when the caller's active org genuinely holds an ACTIVE grant for it",
      async () => {
        const result =
          await listAvailableActualEmissionData(
            makeMockSupabase(
              {
                emission_data: { data: [sharedRow], error: null },
                installations: { data: installationRows, error: null },
                sharing_grants: { data: activeGrantForInstallation2, error: null },
              },
            ),
            orgId,
          );

        expect(result).toEqual(
          [
            expect.objectContaining(
              { emission_data_id: "emission-data-2", provenance: "SHARED" },
            ),
          ],
        );
      },
    );

    it(
      "excludes a row entered by a different org when the caller's ACTIVE org holds no ACTIVE grant for it -- even though RLS's own membership-based visibility (app.user_org_ids() returning ALL of a user's org memberships, not just the active one) could otherwise have returned it, e.g. when the caller happens to also be a member of the entering org itself (found in P7's mandatory cross-organization-sharing review: master plan §14 explicitly designs for a user belonging to both an importer org and a producer org, so this is a reachable, not merely theoretical, scenario)",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        const result =
          await listAvailableActualEmissionData(
            makeMockSupabase(
              {
                emission_data: { data: [sharedRow], error: null },
                installations: { data: installationRows, error: null },
                sharing_grants: { data: [], error: null },
              },
              recorder,
            ),
            orgId,
          );

        expect(result).toEqual(
          [],
        );
      },
    );

    it(
      "excludes a row shared via a grant that has already expired, even though its status column may still read ACTIVE",
      async () => {
        const result =
          await listAvailableActualEmissionData(
            makeMockSupabase(
              {
                emission_data: { data: [sharedRow], error: null },
                installations: { data: installationRows, error: null },
                sharing_grants: {
                  data: [
                    { installation_id: "installation-2", expires_at: "2020-01-01T00:00:00Z" },
                  ],
                  error: null,
                },
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
      "returns both own and shared rows together, each labeled correctly",
      async () => {
        const result =
          await listAvailableActualEmissionData(
            makeMockSupabase(
              {
                emission_data: { data: [ownRow, sharedRow], error: null },
                installations: { data: installationRows, error: null },
                sharing_grants: { data: activeGrantForInstallation2, error: null },
              },
            ),
            orgId,
          );

        expect(result.map((option) => option.provenance)).toEqual(
          ["OWN", "SHARED"],
        );
      },
    );

    it(
      "filters explicitly on status=ACTIVE and verification_status=VERIFIED (Wall 1 defense in depth, not relying on RLS alone)",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        await listAvailableActualEmissionData(
          makeMockSupabase(
            {
              emission_data: { data: [], error: null },
              installations: { data: [], error: null },
            },
            recorder,
          ),
          orgId,
        );

        const emissionDataSelect =
          recorder.ops.find(
            (op) => op.table === "emission_data",
          );

        expect(emissionDataSelect?.filters).toContainEqual(
          ["status", "ACTIVE"],
        );

        expect(emissionDataSelect?.filters).toContainEqual(
          ["verification_status", "VERIFIED"],
        );
      },
    );

    it(
      "returns an empty array on an emission_data fetch error",
      async () => {
        const result =
          await listAvailableActualEmissionData(
            makeMockSupabase(
              {
                emission_data: { data: null, error: { message: "denied" } },
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
      "returns an empty array when there are no visible ACTIVE+VERIFIED rows, without querying installations",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        const result =
          await listAvailableActualEmissionData(
            makeMockSupabase(
              {
                emission_data: { data: [], error: null },
              },
              recorder,
            ),
            orgId,
          );

        expect(result).toEqual(
          [],
        );

        expect(
          recorder.fromCalls.includes("installations"),
        ).toBe(
          false,
        );
      },
    );

    it(
      "returns an empty array on an installations fetch error",
      async () => {
        const result =
          await listAvailableActualEmissionData(
            makeMockSupabase(
              {
                emission_data: { data: [ownRow], error: null },
                installations: { data: null, error: { message: "denied" } },
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
      "skips a record whose installation row wasn't found, rather than rendering a broken option",
      async () => {
        const result =
          await listAvailableActualEmissionData(
            makeMockSupabase(
              {
                emission_data: { data: [ownRow], error: null },
                installations: { data: [], error: null },
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
      "carries a QUARTERLY reporting_period through unchanged",
      async () => {
        const quarterlyRow =
          {
            ...ownRow,
            reporting_period_kind: "QUARTERLY",
            reporting_period_year: 2025,
            reporting_period_quarter: 3,
          };

        const result =
          await listAvailableActualEmissionData(
            makeMockSupabase(
              {
                emission_data: { data: [quarterlyRow], error: null },
                installations: { data: installationRows, error: null },
              },
            ),
            orgId,
          );

        expect(result[0]?.reporting_period).toEqual(
          { kind: "QUARTERLY", year: 2025, quarter: 3 },
        );
      },
    );
  },
);

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
    {
      id: "grant-installation-2",
      installation_id: "installation-2",
      expires_at: null,
    },
  ];

const grantorOrgRows =
  [
    { id: "org-2", name: "Acme Steel Producer" },
  ];

// Matches ownRow/sharedRow's shared cn_scope (["72081000"]) exactly --
// the default line code most tests determine against, so existing
// coverage keeps exercising the OWN/SHARED/grant-visibility behavior
// without every test also having to think about CN-scope filtering.
const matchingCnCode =
  "72081000";

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

    // 2026-08-31: the grantor-org-name lookup moved from a direct
    // `organizations` read to app.sharing_counterparty_org_names(),
    // because a grantee has no membership in the grantor org and RLS
    // therefore returned no row -- see the production finding in
    // list-available-actual-data.ts. Keyed on "organizations" so every
    // pre-existing fixture in this file keeps describing the same
    // scenario it always did, with no test rewritten to match the
    // implementation.
    rpc: (fnName: string) => {
      recorder.fromCalls.push(`rpc:${fnName}`);
      return Promise.resolve(
        tables.organizations ?? { data: null, error: null },
      );
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
            matchingCnCode,
          );

        expect(result.options).toEqual(
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
              grantor_organization_name: null,
            },
          ],
        );
      },
    );

    it(
      "labels a row entered by a different org as SHARED, when the caller's active org genuinely holds an ACTIVE grant for it, and resolves the grantor org's name",
      async () => {
        const result =
          await listAvailableActualEmissionData(
            makeMockSupabase(
              {
                emission_data: { data: [sharedRow], error: null },
                installations: { data: installationRows, error: null },
                sharing_grants: { data: activeGrantForInstallation2, error: null },
                organizations: { data: grantorOrgRows, error: null },
              },
            ),
            orgId,
            matchingCnCode,
          );

        expect(result.options).toEqual(
          [
            expect.objectContaining(
              {
                emission_data_id: "emission-data-2",
                provenance: "SHARED",
                grantor_organization_name: "Acme Steel Producer",
              },
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
            matchingCnCode,
          );

        expect(result.options).toEqual(
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
            matchingCnCode,
          );

        expect(result.options).toEqual(
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
                organizations: { data: grantorOrgRows, error: null },
              },
            ),
            orgId,
            matchingCnCode,
          );

        expect(result.options.map((option) => option.provenance)).toEqual(
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
          matchingCnCode,
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
            matchingCnCode,
          );

        expect(result.options).toEqual(
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
            matchingCnCode,
          );

        expect(result.options).toEqual(
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
            matchingCnCode,
          );

        expect(result.options).toEqual(
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
            matchingCnCode,
          );

        expect(result.options).toEqual(
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
            matchingCnCode,
          );

        expect(result.options[0]?.reporting_period).toEqual(
          { kind: "QUARTERLY", year: 2025, quarter: 3 },
        );
      },
    );

    it(
      "excludes a visible ACTIVE+VERIFIED row whose cn_scope does not cover the line's declared cn_code",
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
            "25232100",
          );

        expect(result.options).toEqual(
          [],
        );
      },
    );

    it(
      "includes a row via coarser-covers-finer cn_scope matching -- a CN8 cn_scope entry covers a TARIC10 line code nested under that same heading",
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
            "7208100099",
          );

        expect(result.options).toHaveLength(
          1,
        );

        expect(result.options[0]?.emission_data_id).toBe(
          "emission-data-1",
        );
      },
    );

    it(
      "does not query installations at all when every visible row is filtered out by cn_scope",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        await listAvailableActualEmissionData(
          makeMockSupabase(
            {
              emission_data: { data: [ownRow], error: null },
              installations: { data: installationRows, error: null },
            },
            recorder,
          ),
          orgId,
          "25232100",
        );

        expect(
          recorder.fromCalls.includes("installations"),
        ).toBe(
          false,
        );
      },
    );

    it(
      "falls back to a placeholder grantor name, rather than silently dropping the row, when the organizations follow-up lookup succeeds but doesn't return a row for that grantor org id",
      async () => {
        const result =
          await listAvailableActualEmissionData(
            makeMockSupabase(
              {
                emission_data: { data: [sharedRow], error: null },
                installations: { data: installationRows, error: null },
                sharing_grants: { data: activeGrantForInstallation2, error: null },
                organizations: { data: [], error: null },
              },
            ),
            orgId,
            matchingCnCode,
          );

        expect(result.options).toEqual(
          [
            expect.objectContaining(
              { grantor_organization_name: "Unknown organization" },
            ),
          ],
        );
      },
    );

    it(
      "returns an empty array -- rather than a false 'Unknown organization' placeholder that could mask a real transport failure -- when the organizations follow-up lookup itself errors",
      async () => {
        const result =
          await listAvailableActualEmissionData(
            makeMockSupabase(
              {
                emission_data: { data: [sharedRow], error: null },
                installations: { data: installationRows, error: null },
                sharing_grants: { data: activeGrantForInstallation2, error: null },
                organizations: { data: null, error: { message: "denied" } },
              },
            ),
            orgId,
            matchingCnCode,
          );

        expect(result.options).toEqual(
          [],
        );
      },
    );

    it(
      "returns every org-visible row without CN-scope filtering when cnCode is null -- the unscoped 'browse all shared-in data' case app/(importer)/emissions/page.tsx needs",
      async () => {
        const nonMatchingCnScopeRow =
          {
            ...ownRow,
            id: "emission-data-3",
            cn_scope: ["25232100"],
          };

        const result =
          await listAvailableActualEmissionData(
            makeMockSupabase(
              {
                emission_data: { data: [ownRow, nonMatchingCnScopeRow], error: null },
                installations: { data: installationRows, error: null },
              },
            ),
            orgId,
            null,
          );

        expect(result.options.map((option) => option.emission_data_id)).toEqual(
          ["emission-data-1", "emission-data-3"],
        );
      },
    );

    it(
      "still applies org-visibility/grant scoping when cnCode is null -- unscoping CN never widens WHO can see a row, only WHICH goods it's offered for",
      async () => {
        const result =
          await listAvailableActualEmissionData(
            makeMockSupabase(
              {
                emission_data: { data: [sharedRow], error: null },
                installations: { data: installationRows, error: null },
                sharing_grants: { data: [], error: null },
              },
            ),
            orgId,
            null,
          );

        expect(result.options).toEqual(
          [],
        );
      },
    );

    it(
      "does not query organizations at all when every visible row is OWN (no grantor name ever needed)",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        await listAvailableActualEmissionData(
          makeMockSupabase(
            {
              emission_data: { data: [ownRow], error: null },
              installations: { data: installationRows, error: null },
            },
            recorder,
          ),
          orgId,
          matchingCnCode,
        );

        expect(
          recorder.fromCalls.includes("organizations"),
        ).toBe(
          false,
        );
      },
    );

    describe(
      "no-op candidates (P14)",
      () => {
        /**
         * The picker returns, alongside the options a caller may
         * render, the server-only facts needed to decide whether
         * choosing one would change anything -- see
         * AvailableActualEmissionDataListing's own doc comment for why
         * they are separate.
         */
        it(
          "carries the grant a SHARED record is read through, so a re-issued grant is not mistaken for a no-op",
          async () => {
            const result =
              await listAvailableActualEmissionData(
                makeMockSupabase(
                  {
                    emission_data: {
                      data: [
                        { ...sharedRow },
                      ],
                      error: null,
                    },
                    sharing_grants: {
                      data: [
                        {
                          id: "grant-live",
                          installation_id: "installation-2",
                          expires_at: null,
                        },
                      ],
                      error: null,
                    },
                    installations: {
                      data: [
                        {
                          id: "installation-2",
                          name: "Partner Plant",
                          country: "IN",
                        },
                      ],
                      error: null,
                    },
                    organizations: {
                      data: [
                        { id: "org-2", name: "Partner Producer" },
                      ],
                      error: null,
                    },
                  },
                ),
                orgId,
                matchingCnCode,
              );

            expect(
              result.candidatesById.get("emission-data-2")?.sharing_grant_id,
            ).toBe(
              "grant-live",
            );
          },
        );

        it(
          "carries null for an OWN record, matching what a determination would freeze",
          async () => {
            const result =
              await listAvailableActualEmissionData(
                makeMockSupabase(
                  {
                    emission_data: {
                      data: [
                        { ...ownRow },
                      ],
                      error: null,
                    },
                    sharing_grants: { data: [], error: null },
                    installations: {
                      data: [
                        {
                          id: "installation-1",
                          name: "Steel Works A",
                          country: "DE",
                        },
                      ],
                      error: null,
                    },
                  },
                ),
                orgId,
                matchingCnCode,
              );

            expect(
              result.candidatesById.get("emission-data-1")?.sharing_grant_id,
            ).toBeNull();
          },
        );

        it(
          "offers no candidate for a VERIFIED record with no recorded verifier",
          async () => {
            // determine-from-actual-data.ts treats that shape as a
            // data-integrity failure and refuses. Producing a candidate
            // for it would let the UI report a harmless no-op where the
            // server will in fact report something more serious.
            const result =
              await listAvailableActualEmissionData(
                makeMockSupabase(
                  {
                    emission_data: {
                      data: [
                        { ...ownRow, verifier_user_id: null },
                      ],
                      error: null,
                    },
                    sharing_grants: { data: [], error: null },
                    installations: {
                      data: [
                        {
                          id: "installation-1",
                          name: "Steel Works A",
                          country: "DE",
                        },
                      ],
                      error: null,
                    },
                  },
                ),
                orgId,
                matchingCnCode,
              );

            expect(result.options).toHaveLength(
              1,
            );

            expect(
              result.candidatesById.has("emission-data-1"),
            ).toBe(
              false,
            );
          },
        );
      },
    );
  },
);

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  determineLineFromActualData,
  redetermineLineFromActualData,
} from "./determine-from-actual-data";

import type {
  OrgContext,
} from "../organizations/org-context";

const orgId =
  "org-1" as never;

const actorUserId =
  "user-1" as never;

function memberContext(
  capabilities: OrgContext["capabilities"] = ["IMPORTER_DECLARANT"],
): OrgContext {
  return {
    org_id: orgId,
    user_id: actorUserId,
    role: "MEMBER",
    capabilities,
  };
}

const lineId =
  "line-1" as never;

const emissionDataId =
  "emission-data-1" as never;

const lineRow =
  {
    org_id: "org-1",
    // Matches verifiedActiveRow's cn_scope below (finding S16:
    // performDetermination now cross-checks the two).
    cn_code: "72081000",
    emission_determination: null,
  };

const verifiedActiveRow =
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

const updatedLineRow =
  {
    id: "line-1",
    shipment_id: "ship-1",
    org_id: "org-1",
    line_number: 1,
    cn_code: "25232100",
    cn_code_level: "CN8",
    goods_description: null,
    origin_country: "CN",
    net_mass_tonnes: "10.5",
    quantity_mwh: null,
    production_route_name: null,
    production_route_indicator: null,
    emission_determination: {
      method: "ACTUAL",
      snapshot: { emission_data_id: "emission-data-1" },
    },
  };

interface Op {
  table: string;
  op: "insert" | "update" | "delete";
  payload: unknown;
  filters: [string, unknown][];
}

interface Recorder {
  fromCalls: string[];
  ops: Op[];
}

/**
 * A generic chainable per-table mock, same shape/reasoning as
 * manage-emission-data.test.ts's makeMockSupabase (this codebase's
 * established pattern for a service that issues several distinct query
 * shapes against several different tables in one call --
 * shipment_lines, emission_data, sharing_grants, audit_events here).
 * Results are configured per table as either a single {data,error}
 * (returned for every call against that table) or an ordered array (one
 * entry consumed per terminal resolution -- maybeSingle/single/bare-await
 * -- in call order, clamped to the last entry once exhausted so a test
 * doesn't have to enumerate an exact call count it doesn't care about).
 * `.is()` is tracked as its own filter entry (["<col>", null]) so a test
 * can assert the CAS predicate the same way
 * resolve-line-emissions.test.ts's bespoke mock does.
 */
function makeMockSupabase(
  tables: Record<string, { data: unknown; error: unknown } | { data: unknown; error: unknown }[]>,
  recorder: Recorder = { fromCalls: [], ops: [] },
  rpcResult?: { data: unknown; error: unknown },
) {
  const cursors: Record<string, number> = {};

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
    const filters: [string, unknown][] =
      [];

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        filters.push([col, val]);
        return chain;
      },
      is: (col: string, val: unknown) => {
        filters.push([col, val]);
        return chain;
      },
      order: () => chain,
      insert: (payload: unknown) => {
        recorder.ops.push({ table, op: "insert", payload, filters });
        return chain;
      },
      update: (payload: unknown) => {
        recorder.ops.push({ table, op: "update", payload, filters });
        return chain;
      },
      maybeSingle: () =>
        Promise.resolve(
          nextResult(table),
        ),
      single: () =>
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
    from: (table: string) => {
      recorder.fromCalls.push(table);
      return builder(table);
    },

    // Only exercised by the cross-org consumption RPC call
    // (record_shared_data_consumption, 20260829310000) -- every other
    // query in this file talks to shipment_lines/emission_data/
    // sharing_grants/audit_events via plain from()/select()/insert(),
    // same shape as manage-sharing-grants.test.ts's own makeMockSupabase
    // (which needed this for accept_sharing_grant_invitation).
    rpc: (fnName: string, args: unknown) => {
      recorder.ops.push(
        { table: `rpc:${fnName}`, op: "insert", payload: args, filters: [] },
      );

      return Promise.resolve(
        rpcResult ?? { data: null, error: null },
      );
    },
  } as never;
}

describe(
  "determineLineFromActualData",
  () => {
    it(
      "persists an ACTUAL determination for an own-org emission_data row, with a null sharing_grant_id",
      async () => {
        const result =
          await determineLineFromActualData(
            makeMockSupabase(
              {
                shipment_lines: [
                  { data: lineRow, error: null },
                  { data: updatedLineRow, error: null },
                ],
                emission_data: { data: verifiedActiveRow, error: null },
              },
            ),
            memberContext(),
            lineId,
            emissionDataId,
          );

        expect(result.status).toBe(
          "DETERMINED",
        );

        if (result.status !== "DETERMINED") {
          throw new Error("expected DETERMINED");
        }

        expect(result.snapshot).toEqual(
          {
            emission_data_id: "emission-data-1",
            emission_data_version: 1,
            installation_id: "installation-1",
            resolved_at: expect.any(String),
            values: {
              direct_specific: "1.5",
              indirect_specific: "0.2",
            },
            emission_unit: "tCO2e/t",
            methodology: "EU_METHOD",
            verification: {
              status: "VERIFIED",
              verifier_user_id: "admin-1",
            },
            evidence_file_ids: ["evidence-1"],
            sharing_grant_id: null,
          },
        );
      },
    );

    it(
      "rejects EMISSION_DATA_NOT_FOUND when the chosen emission_data row's cn_scope does not cover the line's own declared cn_code (P13 review, finding S16) -- e.g. a steel installation's actuals must never silently back a cement line's determination",
      async () => {
        const result =
          await determineLineFromActualData(
            makeMockSupabase(
              {
                shipment_lines: [
                  { data: { ...lineRow, cn_code: "25232100" }, error: null },
                ],
                // verifiedActiveRow.cn_scope is ["72081000"], which
                // neither equals nor is a digit-prefix of "25232100".
                emission_data: { data: verifiedActiveRow, error: null },
              },
            ),
            memberContext(),
            lineId,
            emissionDataId,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "EMISSION_DATA_NOT_FOUND" },
        );
      },
    );

    it(
      "accepts an emission_data row whose cn_scope is a genuine digit-prefix of the line's more specific TARIC10 code",
      async () => {
        const result =
          await determineLineFromActualData(
            makeMockSupabase(
              {
                shipment_lines: [
                  { data: { ...lineRow, cn_code: "7208100010" }, error: null },
                  { data: updatedLineRow, error: null },
                ],
                // verifiedActiveRow.cn_scope is ["72081000"] -- a genuine
                // shorter prefix of "7208100010", per
                // cnScopeCoversCnCode's own documented CN8-covers-TARIC10
                // relationship.
                emission_data: { data: verifiedActiveRow, error: null },
              },
            ),
            memberContext(),
            lineId,
            emissionDataId,
          );

        expect(result.status).toBe(
          "DETERMINED",
        );
      },
    );

    it(
      "persists an ACTUAL determination for a cross-org emission_data row, populating sharing_grant_id from the matching ACTIVE grant",
      async () => {
        const crossOrgRow =
          { ...verifiedActiveRow, entered_by_org_id: "org-2" };

        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        const result =
          await determineLineFromActualData(
            makeMockSupabase(
              {
                shipment_lines: [
                  { data: lineRow, error: null },
                  { data: updatedLineRow, error: null },
                ],
                emission_data: { data: crossOrgRow, error: null },
                sharing_grants: {
                  data: { id: "grant-1", expires_at: null },
                  error: null,
                },
              },
              recorder,
            ),
            memberContext(),
            lineId,
            emissionDataId,
          );

        expect(result.status).toBe(
          "DETERMINED",
        );

        expect(
          result.status === "DETERMINED" ? result.snapshot.sharing_grant_id : null,
        ).toBe(
          "grant-1",
        );

        const grantQuery =
          recorder.fromCalls.filter(
            (t) => t === "sharing_grants",
          );

        expect(grantQuery.length).toBeGreaterThan(
          0,
        );
      },
    );

    it(
      "reports LINE_NOT_FOUND when the line doesn't exist",
      async () => {
        const result =
          await determineLineFromActualData(
            makeMockSupabase(
              {
                shipment_lines: { data: null, error: null },
              },
            ),
            memberContext(),
            lineId,
            emissionDataId,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "LINE_NOT_FOUND" },
        );
      },
    );

    it(
      "reports LINE_NOT_FOUND when the line belongs to a different org than the caller's active org",
      async () => {
        const result =
          await determineLineFromActualData(
            makeMockSupabase(
              {
                shipment_lines: { data: { ...lineRow, org_id: "org-2" }, error: null },
              },
            ),
            memberContext(),
            lineId,
            emissionDataId,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "LINE_NOT_FOUND" },
        );
      },
    );

    it(
      "rejects ALREADY_DETERMINED without touching emission_data",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        const result =
          await determineLineFromActualData(
            makeMockSupabase(
              {
                shipment_lines: {
                  data: {
                    ...lineRow,
                    emission_determination: { method: "DEFAULT", resolution: {} },
                  },
                  error: null,
                },
              },
              recorder,
            ),
            memberContext(),
            lineId,
            emissionDataId,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "ALREADY_DETERMINED" },
        );

        expect(
          recorder.fromCalls.includes("emission_data"),
        ).toBe(
          false,
        );
      },
    );

    it(
      "reports EMISSION_DATA_NOT_FOUND when the id doesn't exist / isn't visible",
      async () => {
        const result =
          await determineLineFromActualData(
            makeMockSupabase(
              {
                shipment_lines: { data: lineRow, error: null },
                emission_data: { data: null, error: null },
              },
            ),
            memberContext(),
            lineId,
            emissionDataId,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "EMISSION_DATA_NOT_FOUND" },
        );
      },
    );

    it(
      "reports EMISSION_DATA_NOT_FOUND for a row that is visible but UNVERIFIED",
      async () => {
        const result =
          await determineLineFromActualData(
            makeMockSupabase(
              {
                shipment_lines: { data: lineRow, error: null },
                emission_data: {
                  data: { ...verifiedActiveRow, verification_status: "UNVERIFIED", verifier_user_id: null },
                  error: null,
                },
              },
            ),
            memberContext(),
            lineId,
            emissionDataId,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "EMISSION_DATA_NOT_FOUND" },
        );
      },
    );

    it(
      "reports EMISSION_DATA_NOT_FOUND for a row that is visible but DRAFT (not yet ACTIVE)",
      async () => {
        const result =
          await determineLineFromActualData(
            makeMockSupabase(
              {
                shipment_lines: { data: lineRow, error: null },
                emission_data: {
                  data: { ...verifiedActiveRow, status: "DRAFT" },
                  error: null,
                },
              },
            ),
            memberContext(),
            lineId,
            emissionDataId,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "EMISSION_DATA_NOT_FOUND" },
        );
      },
    );

    it(
      "reports EMISSION_DATA_NOT_FOUND for an ACTIVE+VERIFIED row whose evidence was removed after verification -- the LIVE completeness re-check (owner's blocking-model directive: importer shipment calculations must not consume an incomplete actual record as verified ACTUAL, even though verification_status still reads VERIFIED)",
      async () => {
        const result =
          await determineLineFromActualData(
            makeMockSupabase(
              {
                shipment_lines: { data: lineRow, error: null },
                emission_data: {
                  data: { ...verifiedActiveRow, evidence_file_ids: [] },
                  error: null,
                },
              },
            ),
            memberContext(),
            lineId,
            emissionDataId,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "EMISSION_DATA_NOT_FOUND" },
        );
      },
    );

    it(
      "reports DATA_INTEGRITY_ERROR when the row is cross-org visible but no matching ACTIVE sharing grant is found",
      async () => {
        const crossOrgRow =
          { ...verifiedActiveRow, entered_by_org_id: "org-2" };

        const result =
          await determineLineFromActualData(
            makeMockSupabase(
              {
                shipment_lines: { data: lineRow, error: null },
                emission_data: { data: crossOrgRow, error: null },
                sharing_grants: { data: null, error: null },
              },
            ),
            memberContext(),
            lineId,
            emissionDataId,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "DATA_INTEGRITY_ERROR" },
        );
      },
    );

    it(
      "reports DATA_INTEGRITY_ERROR when a VERIFIED row has a null verifier_user_id",
      async () => {
        const result =
          await determineLineFromActualData(
            makeMockSupabase(
              {
                shipment_lines: { data: lineRow, error: null },
                emission_data: {
                  data: { ...verifiedActiveRow, verifier_user_id: null },
                  error: null,
                },
              },
            ),
            memberContext(),
            lineId,
            emissionDataId,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "DATA_INTEGRITY_ERROR" },
        );
      },
    );

    it(
      "sends the CAS predicate (.is emission_determination null) only for first-time determination",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        await determineLineFromActualData(
          makeMockSupabase(
            {
              shipment_lines: [
                { data: lineRow, error: null },
                { data: updatedLineRow, error: null },
              ],
              emission_data: { data: verifiedActiveRow, error: null },
            },
            recorder,
          ),
          memberContext(),
          lineId,
          emissionDataId,
        );

        const updateOp =
          recorder.ops.find(
            (op) => op.table === "shipment_lines" && op.op === "update",
          );

        expect(
          updateOp?.filters,
        ).toContainEqual(
          ["emission_determination", null],
        );
      },
    );

    it(
      "records an audit event with the ACTUAL determination method and grant reference on success",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        await determineLineFromActualData(
          makeMockSupabase(
            {
              shipment_lines: [
                { data: lineRow, error: null },
                { data: updatedLineRow, error: null },
              ],
              emission_data: { data: verifiedActiveRow, error: null },
              audit_events: { data: null, error: null },
            },
            recorder,
          ),
          memberContext(),
          lineId,
          emissionDataId,
        );

        const auditOp =
          recorder.ops.find(
            (op) => op.table === "audit_events" && op.op === "insert",
          );

        expect(auditOp).toBeTruthy();

        const payload =
          auditOp?.payload as { event_type: string; payload: Record<string, unknown> };

        expect(payload.event_type).toBe(
          "emission_determination.set",
        );

        expect(payload.payload).toEqual(
          expect.objectContaining(
            {
              shipment_id: "ship-1",
              line_number: 1,
              emission_data_id: "emission-data-1",
              emission_data_version: 1,
              sharing_grant_id: null,
              determination_method: "ACTUAL",
            },
          ),
        );
      },
    );

    describe(
      "capability gate",
      () => {
        it(
          "rejects an org without IMPORTER_DECLARANT with CAPABILITY_NOT_HELD, before touching the database",
          async () => {
            const supabase =
              {
                from: () => {
                  throw new Error(
                    "determineLineFromActualData must not read the database before the capability check runs",
                  );
                },
              } as never;

            const result =
              await determineLineFromActualData(
                supabase,
                memberContext(["PRODUCER_OPERATOR"]),
                lineId,
                emissionDataId,
              );

            expect(result).toEqual(
              { status: "REJECTED", reason: "CAPABILITY_NOT_HELD" },
            );
          },
        );

        it(
          "allows an org holding IMPORTER_DECLARANT",
          async () => {
            const result =
              await determineLineFromActualData(
                makeMockSupabase(
                  {
                    shipment_lines: [
                      { data: lineRow, error: null },
                      { data: updatedLineRow, error: null },
                    ],
                    emission_data: { data: verifiedActiveRow, error: null },
                  },
                ),
                memberContext(["IMPORTER_DECLARANT"]),
                lineId,
                emissionDataId,
              );

            expect(result.status).toBe(
              "DETERMINED",
            );
          },
        );
      },
    );
  },
);

describe(
  "determineLineFromActualData -- cross-org consumption RPC (record_shared_data_consumption, 20260829310000)",
  () => {
    // S8 (previously-deferred gap, master plan §9): a cross-org
    // determination must also record a sharing_grant.data_consumed
    // audit event into the GRANTOR org's own stream, via the
    // SECURITY DEFINER record_shared_data_consumption RPC -- see
    // supabase/migrations/20260829310000_p7d3_shared_data_consumption_audit.sql.
    // An own-org determination (sharing_grant_id null) has nothing to
    // report and must never call this RPC at all.

    const crossOrgRow =
      { ...verifiedActiveRow, entered_by_org_id: "org-2" };

    function crossOrgTables() {
      return {
        shipment_lines: [
          { data: lineRow, error: null },
          { data: updatedLineRow, error: null },
        ],
        emission_data: { data: crossOrgRow, error: null },
        sharing_grants: {
          data: { id: "grant-1", expires_at: null },
          error: null,
        },
      };
    }

    const okRpcResult =
      {
        data: [{ result_status: "OK", result_audit_event_id: "audit-event-1" }],
        error: null,
      };

    it(
      "calls record_shared_data_consumption with the grant/installation/emission-data/line/kind identifiers, only for a cross-org determination",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        await determineLineFromActualData(
          makeMockSupabase(
            crossOrgTables(),
            recorder,
            okRpcResult,
          ),
          memberContext(),
          lineId,
          emissionDataId,
        );

        const rpcOp =
          recorder.ops.find(
            (op) => op.table === "rpc:record_shared_data_consumption",
          );

        expect(rpcOp).toBeTruthy();

        expect(rpcOp?.payload).toEqual(
          {
            p_sharing_grant_id: "grant-1",
            p_installation_id: "installation-1",
            p_emission_data_id: "emission-data-1",
            p_emission_data_version: 1,
            p_shipment_line_id: "line-1",
            p_determination_kind: "DETERMINED",
          },
        );
      },
    );

    it(
      "does NOT call record_shared_data_consumption for an own-org determination (sharing_grant_id null), and reports crossOrgConsumptionRecorded: true (nothing to record)",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        const result =
          await determineLineFromActualData(
            makeMockSupabase(
              {
                shipment_lines: [
                  { data: lineRow, error: null },
                  { data: updatedLineRow, error: null },
                ],
                emission_data: { data: verifiedActiveRow, error: null },
              },
              recorder,
            ),
            memberContext(),
            lineId,
            emissionDataId,
          );

        expect(
          recorder.ops.some(
            (op) => op.table === "rpc:record_shared_data_consumption",
          ),
        ).toBe(
          false,
        );

        expect(
          result.status === "DETERMINED" ? result.crossOrgConsumptionRecorded : null,
        ).toBe(
          true,
        );
      },
    );

    it(
      "reports crossOrgConsumptionRecorded: true when the RPC reports OK",
      async () => {
        const result =
          await determineLineFromActualData(
            makeMockSupabase(
              crossOrgTables(),
              undefined,
              okRpcResult,
            ),
            memberContext(),
            lineId,
            emissionDataId,
          );

        expect(result.status).toBe(
          "DETERMINED",
        );

        expect(
          result.status === "DETERMINED" ? result.crossOrgConsumptionRecorded : null,
        ).toBe(
          true,
        );
      },
    );

    it(
      "reports crossOrgConsumptionRecorded: false, WITHOUT rejecting the (already-persisted) determination, when the RPC reports a non-OK status",
      async () => {
        const result =
          await determineLineFromActualData(
            makeMockSupabase(
              crossOrgTables(),
              undefined,
              {
                data: [{ result_status: "GRANT_NOT_ACTIVE", result_audit_event_id: null }],
                error: null,
              },
            ),
            memberContext(),
            lineId,
            emissionDataId,
          );

        expect(result.status).toBe(
          "DETERMINED",
        );

        expect(
          result.status === "DETERMINED" ? result.crossOrgConsumptionRecorded : null,
        ).toBe(
          false,
        );
      },
    );

    it(
      "reports crossOrgConsumptionRecorded: false, WITHOUT rejecting the (already-persisted) determination, when the RPC call itself errors",
      async () => {
        const result =
          await determineLineFromActualData(
            makeMockSupabase(
              crossOrgTables(),
              undefined,
              { data: null, error: { message: "transport failure" } },
            ),
            memberContext(),
            lineId,
            emissionDataId,
          );

        expect(result.status).toBe(
          "DETERMINED",
        );

        expect(
          result.status === "DETERMINED" ? result.crossOrgConsumptionRecorded : null,
        ).toBe(
          false,
        );
      },
    );
  },
);

describe(
  "redetermineLineFromActualData",
  () => {
    it(
      "overwrites an existing DEFAULT determination with a new ACTUAL one (DEFAULT -> ACTUAL)",
      async () => {
        const result =
          await redetermineLineFromActualData(
            makeMockSupabase(
              {
                shipment_lines: [
                  {
                    data: {
                      ...lineRow,
                      emission_determination: { method: "DEFAULT", resolution: {} },
                    },
                    error: null,
                  },
                  { data: updatedLineRow, error: null },
                ],
                emission_data: { data: verifiedActiveRow, error: null },
              },
            ),
            memberContext(),
            lineId,
            emissionDataId,
          );

        expect(result.status).toBe(
          "DETERMINED",
        );
      },
    );

    it(
      "overwrites an existing ACTUAL determination with another ACTUAL one (ACTUAL -> ACTUAL)",
      async () => {
        const result =
          await redetermineLineFromActualData(
            makeMockSupabase(
              {
                shipment_lines: [
                  {
                    data: {
                      ...lineRow,
                      emission_determination: {
                        method: "ACTUAL",
                        snapshot: { emission_data_id: "emission-data-old" },
                      },
                    },
                    error: null,
                  },
                  { data: updatedLineRow, error: null },
                ],
                emission_data: { data: verifiedActiveRow, error: null },
              },
            ),
            memberContext(),
            lineId,
            emissionDataId,
          );

        expect(result.status).toBe(
          "DETERMINED",
        );
      },
    );

    it(
      "sends no CAS predicate -- an explicit override is allowed to overwrite",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        await redetermineLineFromActualData(
          makeMockSupabase(
            {
              shipment_lines: [
                {
                  data: {
                    ...lineRow,
                    emission_determination: { method: "DEFAULT", resolution: {} },
                  },
                  error: null,
                },
                { data: updatedLineRow, error: null },
              ],
              emission_data: { data: verifiedActiveRow, error: null },
            },
            recorder,
          ),
          memberContext(),
          lineId,
          emissionDataId,
        );

        const updateOp =
          recorder.ops.find(
            (op) => op.table === "shipment_lines" && op.op === "update",
          );

        expect(
          updateOp?.filters.some(([col]) => col === "emission_determination"),
        ).toBe(
          false,
        );
      },
    );

    it(
      "records a distinct redetermined audit event type",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        await redetermineLineFromActualData(
          makeMockSupabase(
            {
              shipment_lines: [
                {
                  data: {
                    ...lineRow,
                    emission_determination: { method: "DEFAULT", resolution: {} },
                  },
                  error: null,
                },
                { data: updatedLineRow, error: null },
              ],
              emission_data: { data: verifiedActiveRow, error: null },
              audit_events: { data: null, error: null },
            },
            recorder,
          ),
          memberContext(),
          lineId,
          emissionDataId,
        );

        const auditOp =
          recorder.ops.find(
            (op) => op.table === "audit_events" && op.op === "insert",
          );

        const payload =
          auditOp?.payload as { event_type: string };

        expect(payload.event_type).toBe(
          "emission_determination.redetermined",
        );
      },
    );

    it(
      "records the prior determination on the audit payload, not just the new one",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        const priorDetermination =
          {
            method: "DEFAULT",
            resolution: { reason: "EXACT_CN8_MATCH", dataset_version: "2026-definitive-corrected" },
          };

        await redetermineLineFromActualData(
          makeMockSupabase(
            {
              shipment_lines: [
                { data: { ...lineRow, emission_determination: priorDetermination }, error: null },
                { data: updatedLineRow, error: null },
              ],
              emission_data: { data: verifiedActiveRow, error: null },
              audit_events: { data: null, error: null },
            },
            recorder,
          ),
          memberContext(),
          lineId,
          emissionDataId,
        );

        const auditOp =
          recorder.ops.find(
            (op) => op.table === "audit_events" && op.op === "insert",
          );

        const payload =
          auditOp?.payload as { payload: { previous_determination: unknown } };

        expect(payload.payload.previous_determination).toEqual(
          {
            method: "DEFAULT",
            reason: "EXACT_CN8_MATCH",
            dataset_version: "2026-definitive-corrected",
          },
        );
      },
    );

    it(
      "calls record_shared_data_consumption with p_determination_kind: REDETERMINED for a cross-org redetermination",
      async () => {
        const crossOrgRow =
          { ...verifiedActiveRow, entered_by_org_id: "org-2" };

        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        await redetermineLineFromActualData(
          makeMockSupabase(
            {
              shipment_lines: [
                {
                  data: {
                    ...lineRow,
                    emission_determination: { method: "DEFAULT", resolution: {} },
                  },
                  error: null,
                },
                { data: updatedLineRow, error: null },
              ],
              emission_data: { data: crossOrgRow, error: null },
              sharing_grants: {
                data: { id: "grant-1", expires_at: null },
                error: null,
              },
            },
            recorder,
            {
              data: [{ result_status: "OK", result_audit_event_id: "audit-event-1" }],
              error: null,
            },
          ),
          memberContext(),
          lineId,
          emissionDataId,
        );

        const rpcOp =
          recorder.ops.find(
            (op) => op.table === "rpc:record_shared_data_consumption",
          );

        expect(rpcOp?.payload).toEqual(
          expect.objectContaining(
            { p_determination_kind: "REDETERMINED" },
          ),
        );
      },
    );

    describe(
      "capability gate",
      () => {
        it(
          "rejects an org without IMPORTER_DECLARANT with CAPABILITY_NOT_HELD, before touching the database",
          async () => {
            const supabase =
              {
                from: () => {
                  throw new Error(
                    "redetermineLineFromActualData must not read the database before the capability check runs",
                  );
                },
              } as never;

            const result =
              await redetermineLineFromActualData(
                supabase,
                memberContext(["PRODUCER_OPERATOR"]),
                lineId,
                emissionDataId,
              );

            expect(result).toEqual(
              { status: "REJECTED", reason: "CAPABILITY_NOT_HELD" },
            );
          },
        );

        it(
          "allows an org holding IMPORTER_DECLARANT",
          async () => {
            const result =
              await redetermineLineFromActualData(
                makeMockSupabase(
                  {
                    shipment_lines: [
                      {
                        data: {
                          ...lineRow,
                          emission_determination: { method: "DEFAULT", resolution: {} },
                        },
                        error: null,
                      },
                      { data: updatedLineRow, error: null },
                    ],
                    emission_data: { data: verifiedActiveRow, error: null },
                  },
                ),
                memberContext(["IMPORTER_DECLARANT"]),
                lineId,
                emissionDataId,
              );

            expect(result.status).toBe(
              "DETERMINED",
            );
          },
        );
      },
    );
  },
);

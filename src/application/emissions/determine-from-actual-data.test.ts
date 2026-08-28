import {
  describe,
  expect,
  it,
} from "vitest";

import {
  determineLineFromActualData,
  redetermineLineFromActualData,
} from "./determine-from-actual-data";

const orgId =
  "org-1" as never;

const actorUserId =
  "user-1" as never;

const lineId =
  "line-1" as never;

const emissionDataId =
  "emission-data-1" as never;

const lineRow =
  {
    org_id: "org-1",
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
            orgId,
            actorUserId,
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
            orgId,
            actorUserId,
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
            orgId,
            actorUserId,
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
            orgId,
            actorUserId,
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
            orgId,
            actorUserId,
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
            orgId,
            actorUserId,
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
            orgId,
            actorUserId,
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
            orgId,
            actorUserId,
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
            orgId,
            actorUserId,
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
            orgId,
            actorUserId,
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
          orgId,
          actorUserId,
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
          orgId,
          actorUserId,
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
            orgId,
            actorUserId,
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
            orgId,
            actorUserId,
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
          orgId,
          actorUserId,
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
          orgId,
          actorUserId,
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
  },
);

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  activateEmissionData,
  discardEmissionData,
  listEmissionData,
  recordEmissionData,
  rejectEmissionData,
  submitForVerification,
  verifyEmissionData,
} from "./manage-emission-data";

const orgId =
  "org-1" as never;

const actorUserId =
  "user-1" as never;

const adminContext =
  {
    org_id: "org-1",
    user_id: "admin-1",
    role: "ADMIN",
    capabilities: ["PRODUCER_OPERATOR"],
  } as never;

const memberContext =
  {
    org_id: "org-1",
    user_id: "member-1",
    role: "MEMBER",
    capabilities: ["PRODUCER_OPERATOR"],
  } as never;

const baseRow =
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
    verification_status: "UNVERIFIED",
    verifier_user_id: null,
    rejection_reason: null,
    evidence_file_ids: [],
    version: 1,
    predecessor_id: null,
    status: "DRAFT",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
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
 * A generic chainable mock, not a bespoke per-call one (contrast
 * manage-installations.test.ts's mockSupabase) -- manage-emission-data.ts
 * issues enough distinct query shapes against the SAME table (fetch,
 * find-prior-active, insert, update, sometimes twice) that hand-shaping
 * every chain would mean re-deriving the exact call sequence in both
 * files independently. Instead, results are configured per table as
 * either a single {data,error} (returned for every call against that
 * table) or an ordered array (one entry consumed per terminal
 * resolution -- maybeSingle/single/bare-await -- in call order),
 * verified against the real implementation below by actually running
 * red-then-green, not assumed correct from shape alone.
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
      neq: (col: string, val: unknown) => {
        filters.push([col, `neq:${String(val)}`]);
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
      limit: () => chain,
      insert: (payload: unknown) => {
        recorder.ops.push({ table, op: "insert", payload, filters });
        return chain;
      },
      update: (payload: unknown) => {
        recorder.ops.push({ table, op: "update", payload, filters });
        return chain;
      },
      delete: () => {
        recorder.ops.push({ table, op: "delete", payload: undefined, filters });
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
  "listEmissionData",
  () => {
    it(
      "maps rows to EmissionData objects",
      async () => {
        const result =
          await listEmissionData(
            makeMockSupabase(
              { emission_data: { data: [baseRow], error: null } },
            ),
            orgId,
          );

        expect(result).toEqual(
          [
            expect.objectContaining(
              { id: "emission-data-1", version: 1, status: "DRAFT" },
            ),
          ],
        );
      },
    );

    it(
      "returns an empty array on a fetch error",
      async () => {
        const result =
          await listEmissionData(
            makeMockSupabase(
              { emission_data: { data: null, error: { message: "denied" } } },
            ),
            orgId,
          );

        expect(result).toEqual(
          [],
        );
      },
    );
  },
);

describe(
  "recordEmissionData",
  () => {
    const validInput =
      {
        installationId: "installation-1" as never,
        cnScope: ["72081000"],
        period: { kind: "ANNUAL", year: 2026 } as never,
        directSpecific: "1.5",
        indirectSpecific: "0.2",
        emissionUnit: "tCO2e/t",
        methodology: "EU_METHOD" as never,
      };

    it(
      "creates a DRAFT record at version 1 when no prior ACTIVE record exists for the installation+period",
      async () => {
        const result =
          await recordEmissionData(
            makeMockSupabase(
              {
                installations: { data: { org_id: "org-1" }, error: null },
                emission_data: [
                  { data: null, error: null },
                  { data: baseRow, error: null },
                ],
              },
            ),
            orgId,
            actorUserId,
            validInput,
          );

        expect(result).toEqual(
          { status: "OK", record: expect.objectContaining({ version: 1, predecessor_id: null }) },
        );
      },
    );

    it(
      "computes version = predecessor.version + 1 and sets predecessor_id when an ACTIVE record already exists for the installation+period",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        await recordEmissionData(
          makeMockSupabase(
            {
              installations: { data: { org_id: "org-1" }, error: null },
              emission_data: [
                { data: { id: "emission-data-prior", version: 3 }, error: null },
                { data: { ...baseRow, version: 4, predecessor_id: "emission-data-prior" }, error: null },
              ],
            },
            recorder,
          ),
          orgId,
          actorUserId,
          validInput,
        );

        const insertOp =
          recorder.ops.find(
            (op) => op.table === "emission_data" && op.op === "insert",
          );

        expect(
          (insertOp?.payload as { version: number; predecessor_id: string }).version,
        ).toBe(
          4,
        );

        expect(
          (insertOp?.payload as { version: number; predecessor_id: string }).predecessor_id,
        ).toBe(
          "emission-data-prior",
        );
      },
    );

    it(
      "computes version from the latest row in the lineage regardless of status -- not just the currently-ACTIVE one, so two DRAFT corrections recorded before either is activated don't collide on the same version number",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        // No row is ACTIVE here -- the latest row in the lineage is a
        // DRAFT correction at version 2. Before the fix, the old
        // status='ACTIVE'-only lookup would have found nothing (since
        // nothing is ACTIVE yet) and computed version=1 / predecessor=null
        // again, colliding with the version-1 row that already exists.
        await recordEmissionData(
          makeMockSupabase(
            {
              installations: { data: { org_id: "org-1" }, error: null },
              emission_data: [
                { data: { id: "emission-data-draft-2", version: 2 }, error: null },
                { data: { ...baseRow, version: 3, predecessor_id: "emission-data-draft-2" }, error: null },
              ],
            },
            recorder,
          ),
          orgId,
          actorUserId,
          validInput,
        );

        const insertOp =
          recorder.ops.find(
            (op) => op.table === "emission_data" && op.op === "insert",
          );

        expect(
          (insertOp?.payload as { version: number; predecessor_id: string }).version,
        ).toBe(
          3,
        );

        expect(
          (insertOp?.payload as { version: number; predecessor_id: string }).predecessor_id,
        ).toBe(
          "emission-data-draft-2",
        );
      },
    );

    it(
      "rejects EMPTY_CN_SCOPE without touching the database",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        const result =
          await recordEmissionData(
            makeMockSupabase(
              {},
              recorder,
            ),
            orgId,
            actorUserId,
            { ...validInput, cnScope: [] },
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "EMPTY_CN_SCOPE" },
        );

        expect(recorder.fromCalls).toEqual(
          [],
        );
      },
    );

    it(
      "rejects INVALID_DIRECT_SPECIFIC for a non-numeric value",
      async () => {
        const result =
          await recordEmissionData(
            makeMockSupabase(
              {},
            ),
            orgId,
            actorUserId,
            { ...validInput, directSpecific: "not-a-number" },
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "INVALID_DIRECT_SPECIFIC" },
        );
      },
    );

    it(
      "rejects INVALID_INDIRECT_SPECIFIC for a non-numeric value",
      async () => {
        const result =
          await recordEmissionData(
            makeMockSupabase(
              {},
            ),
            orgId,
            actorUserId,
            { ...validInput, indirectSpecific: "not-a-number" },
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "INVALID_INDIRECT_SPECIFIC" },
        );
      },
    );

    it(
      "rejects INSTALLATION_NOT_FOUND when the installation belongs to a different org than the caller's active org",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        const result =
          await recordEmissionData(
            makeMockSupabase(
              {
                installations: { data: { org_id: "org-2" }, error: null },
              },
              recorder,
            ),
            orgId,
            actorUserId,
            validInput,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "INSTALLATION_NOT_FOUND" },
        );

        expect(
          recorder.ops.some((op) => op.table === "emission_data"),
        ).toBe(
          false,
        );
      },
    );

    it(
      "reports PERSIST_FAILED when the insert fails",
      async () => {
        const result =
          await recordEmissionData(
            makeMockSupabase(
              {
                installations: { data: { org_id: "org-1" }, error: null },
                emission_data: [
                  { data: null, error: null },
                  { data: null, error: { message: "denied" } },
                ],
              },
            ),
            orgId,
            actorUserId,
            validInput,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "PERSIST_FAILED" },
        );
      },
    );

    it(
      "records an audit event on success",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        await recordEmissionData(
          makeMockSupabase(
            {
              installations: { data: { org_id: "org-1" }, error: null },
              emission_data: [
                { data: null, error: null },
                { data: baseRow, error: null },
              ],
              audit_events: { data: null, error: null },
            },
            recorder,
          ),
          orgId,
          actorUserId,
          validInput,
        );

        expect(
          recorder.ops.some((op) => op.table === "audit_events" && op.op === "insert"),
        ).toBe(
          true,
        );
      },
    );
  },
);

describe(
  "submitForVerification",
  () => {
    it(
      "transitions an UNVERIFIED DRAFT record to VERIFICATION_PENDING",
      async () => {
        const result =
          await submitForVerification(
            makeMockSupabase(
              {
                emission_data: { data: baseRow, error: null },
              },
            ),
            orgId,
            actorUserId,
            "emission-data-1" as never,
          );

        expect(result).toEqual(
          {
            status: "OK",
            record: expect.objectContaining({ verification_status: "VERIFICATION_PENDING" }),
          },
        );
      },
    );

    it(
      "rejects RECORD_NOT_DRAFT when the record is not DRAFT",
      async () => {
        const result =
          await submitForVerification(
            makeMockSupabase(
              {
                emission_data: { data: { ...baseRow, status: "ACTIVE" }, error: null },
              },
            ),
            orgId,
            actorUserId,
            "emission-data-1" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "RECORD_NOT_DRAFT" },
        );
      },
    );

    it(
      "rejects NOT_FOUND when the record belongs to a different org than the caller's active org",
      async () => {
        const result =
          await submitForVerification(
            makeMockSupabase(
              {
                emission_data: { data: { ...baseRow, entered_by_org_id: "org-2" }, error: null },
              },
            ),
            orgId,
            actorUserId,
            "emission-data-1" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "NOT_FOUND" },
        );
      },
    );

    it(
      "records an audit event on success",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        await submitForVerification(
          makeMockSupabase(
            {
              emission_data: { data: baseRow, error: null },
              audit_events: { data: null, error: null },
            },
            recorder,
          ),
          orgId,
          actorUserId,
          "emission-data-1" as never,
        );

        expect(
          recorder.ops.some((op) => op.table === "audit_events" && op.op === "insert"),
        ).toBe(
          true,
        );
      },
    );
  },
);

describe(
  "verifyEmissionData",
  () => {
    const pendingRow =
      { ...baseRow, verification_status: "VERIFICATION_PENDING" };

    it(
      "verifies a VERIFICATION_PENDING record when the caller is ADMIN",
      async () => {
        const result =
          await verifyEmissionData(
            makeMockSupabase(
              {
                emission_data: { data: pendingRow, error: null },
              },
            ),
            adminContext,
            "emission-data-1" as never,
          );

        expect(result).toEqual(
          {
            status: "OK",
            record: expect.objectContaining({ verification_status: "VERIFIED", verifier_user_id: "admin-1" }),
          },
        );
      },
    );

    it(
      "rejects PERMISSION_DENIED for a plain MEMBER, without touching the database",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        const result =
          await verifyEmissionData(
            makeMockSupabase(
              {},
              recorder,
            ),
            memberContext,
            "emission-data-1" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "PERMISSION_DENIED" },
        );

        expect(recorder.fromCalls).toEqual(
          [],
        );
      },
    );

    it(
      "rejects VERIFICATION_NOT_PENDING when the record isn't pending verification",
      async () => {
        const result =
          await verifyEmissionData(
            makeMockSupabase(
              {
                emission_data: { data: baseRow, error: null },
              },
            ),
            adminContext,
            "emission-data-1" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "VERIFICATION_NOT_PENDING" },
        );
      },
    );

    it(
      "records an audit event on success",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        await verifyEmissionData(
          makeMockSupabase(
            {
              emission_data: { data: pendingRow, error: null },
              audit_events: { data: null, error: null },
            },
            recorder,
          ),
          adminContext,
          "emission-data-1" as never,
        );

        expect(
          recorder.ops.some((op) => op.table === "audit_events" && op.op === "insert"),
        ).toBe(
          true,
        );
      },
    );
  },
);

describe(
  "rejectEmissionData",
  () => {
    const pendingRow =
      { ...baseRow, verification_status: "VERIFICATION_PENDING" };

    it(
      "rejects a VERIFICATION_PENDING record with a reason, as ADMIN",
      async () => {
        const result =
          await rejectEmissionData(
            makeMockSupabase(
              {
                emission_data: { data: pendingRow, error: null },
              },
            ),
            adminContext,
            "emission-data-1" as never,
            "Evidence does not support the declared value.",
          );

        expect(result).toEqual(
          {
            status: "OK",
            record: expect.objectContaining({
              verification_status: "REJECTED",
              rejection_reason: "Evidence does not support the declared value.",
            }),
          },
        );
      },
    );

    it(
      "rejects PERMISSION_DENIED for a plain MEMBER, without touching the database",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        const result =
          await rejectEmissionData(
            makeMockSupabase(
              {},
              recorder,
            ),
            memberContext,
            "emission-data-1" as never,
            "Some reason",
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "PERMISSION_DENIED" },
        );

        expect(recorder.fromCalls).toEqual(
          [],
        );
      },
    );

    it(
      "rejects REJECTION_REASON_REQUIRED for an empty reason, as ADMIN",
      async () => {
        const result =
          await rejectEmissionData(
            makeMockSupabase(
              {
                emission_data: { data: pendingRow, error: null },
              },
            ),
            adminContext,
            "emission-data-1" as never,
            "   ",
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "REJECTION_REASON_REQUIRED" },
        );
      },
    );
  },
);

describe(
  "activateEmissionData",
  () => {
    const verifiedDraftRow =
      { ...baseRow, verification_status: "VERIFIED" };

    it(
      "activates a DRAFT+VERIFIED record when no prior ACTIVE record exists for the installation+period",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        const result =
          await activateEmissionData(
            makeMockSupabase(
              {
                emission_data: [
                  { data: verifiedDraftRow, error: null },
                  { data: null, error: null },
                  { data: null, error: null },
                ],
              },
              recorder,
            ),
            orgId,
            actorUserId,
            "emission-data-1" as never,
          );

        expect(result).toEqual(
          { status: "OK", record: expect.objectContaining({ status: "ACTIVE" }) },
        );

        const supersedeOp =
          recorder.ops.find(
            (op) => op.table === "emission_data" && op.op === "update" && (op.payload as { status?: string }).status === "SUPERSEDED",
          );

        expect(supersedeOp).toBeUndefined();
      },
    );

    it(
      "supersedes the prior ACTIVE record for the same installation+period, then activates the new one",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        const result =
          await activateEmissionData(
            makeMockSupabase(
              {
                emission_data: [
                  { data: verifiedDraftRow, error: null },
                  { data: { id: "emission-data-prior" }, error: null },
                  { data: null, error: null },
                  { data: null, error: null },
                ],
              },
              recorder,
            ),
            orgId,
            actorUserId,
            "emission-data-1" as never,
          );

        expect(result.status).toBe(
          "OK",
        );

        const supersedeOp =
          recorder.ops.find(
            (op) => op.table === "emission_data" && op.op === "update" && (op.payload as { status?: string }).status === "SUPERSEDED",
          );

        expect(
          supersedeOp?.filters,
        ).toContainEqual(
          ["id", "emission-data-prior"],
        );

        const activateOp =
          recorder.ops.find(
            (op) => op.table === "emission_data" && op.op === "update" && (op.payload as { status?: string }).status === "ACTIVE",
          );

        expect(
          activateOp?.filters,
        ).toContainEqual(
          ["id", "emission-data-1"],
        );
      },
    );

    it(
      "records a distinct emission_data.superseded audit event on the PRIOR row's own aggregate, in addition to emission_data.activated on the new row",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        await activateEmissionData(
          makeMockSupabase(
            {
              emission_data: [
                { data: verifiedDraftRow, error: null },
                { data: { id: "emission-data-prior" }, error: null },
                { data: null, error: null },
                { data: null, error: null },
              ],
              audit_events: { data: null, error: null },
            },
            recorder,
          ),
          orgId,
          actorUserId,
          "emission-data-1" as never,
        );

        const auditOps =
          recorder.ops.filter(
            (op) => op.table === "audit_events" && op.op === "insert",
          );

        expect(auditOps).toHaveLength(
          2,
        );

        const supersededEvent =
          auditOps[0]?.payload as {
            event_type: string;
            aggregate_id: string;
            payload: { from_status: string; to_status: string; superseded_by_id: string };
          };

        expect(supersededEvent.event_type).toBe(
          "emission_data.superseded",
        );

        expect(supersededEvent.aggregate_id).toBe(
          "emission-data-prior",
        );

        expect(supersededEvent.payload).toEqual(
          {
            from_status: "ACTIVE",
            to_status: "SUPERSEDED",
            superseded_by_id: "emission-data-1",
          },
        );

        const activatedEvent =
          auditOps[1]?.payload as {
            event_type: string;
            aggregate_id: string;
            payload: { from_status: string; to_status: string; superseded_id: string };
          };

        expect(activatedEvent.event_type).toBe(
          "emission_data.activated",
        );

        expect(activatedEvent.aggregate_id).toBe(
          "emission-data-1",
        );

        expect(activatedEvent.payload).toEqual(
          {
            from_status: "DRAFT",
            to_status: "ACTIVE",
            superseded_id: "emission-data-prior",
          },
        );
      },
    );

    it(
      "rejects NOT_VERIFIED when the record hasn't been verified yet",
      async () => {
        const result =
          await activateEmissionData(
            makeMockSupabase(
              {
                emission_data: { data: baseRow, error: null },
              },
            ),
            orgId,
            actorUserId,
            "emission-data-1" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "NOT_VERIFIED" },
        );
      },
    );
  },
);

describe(
  "discardEmissionData",
  () => {
    it(
      "discards a DRAFT record",
      async () => {
        const result =
          await discardEmissionData(
            makeMockSupabase(
              {
                emission_data: { data: baseRow, error: null },
              },
            ),
            orgId,
            actorUserId,
            "emission-data-1" as never,
          );

        expect(result).toEqual(
          { status: "OK", record: expect.objectContaining({ status: "DISCARDED" }) },
        );
      },
    );

    it(
      "rejects RECORD_NOT_DRAFT when the record is already ACTIVE",
      async () => {
        const result =
          await discardEmissionData(
            makeMockSupabase(
              {
                emission_data: { data: { ...baseRow, status: "ACTIVE" }, error: null },
              },
            ),
            orgId,
            actorUserId,
            "emission-data-1" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "RECORD_NOT_DRAFT" },
        );
      },
    );
  },
);

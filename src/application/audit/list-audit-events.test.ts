import {
  describe,
  expect,
  it,
} from "vitest";

import {
  listAuditEvents,
} from "./list-audit-events";

const orgId =
  "org-1" as never;

const userEventRow =
  {
    id: "event-1",
    org_id: "org-1",
    occurred_at: "2026-02-01T00:00:00Z",
    actor_type: "USER",
    actor_user_id: "user-1",
    event_type: "shipment.created",
    aggregate_type: "SHIPMENT",
    aggregate_id: "ship-1",
    payload: { reference: "REF-001" },
    correlation_id: null,
  };

const systemEventRow =
  {
    id: "event-2",
    org_id: null,
    occurred_at: "2026-02-02T00:00:00Z",
    actor_type: "SYSTEM",
    actor_user_id: null,
    event_type: "regulatory_dataset.activated",
    aggregate_type: "CALCULATION_RESULT",
    aggregate_id: "dataset-1",
    payload: {},
    correlation_id: "corr-1",
  };

interface Op {
  table: string;
  filters: [string, unknown][];
  orders: [string, boolean][];
  limitValue: number | null;
}

interface Recorder {
  fromCalls: string[];
  ops: Op[];
}

/**
 * Same generic per-table chainable select-only mock shape as
 * list-actual-determined-lines.test.ts's / list-shared-data-status.test.ts's
 * own makeMockSupabase (this codebase's established pattern for a
 * read-only list service) -- extended with `ilike`/`gte`/`lte` (which
 * neither of those two files needed) and an `orders`/`limitValue`
 * capture on the recorded op, since this module's own filters and
 * ordering/cap are exactly what its tests below need to assert on,
 * per this task's "assert the query builder was called with the right
 * order/filter chain" instruction.
 */
function makeMockSupabase(
  tables: Record<string, { data: unknown; error: unknown }>,
  recorder: Recorder = { fromCalls: [], ops: [] },
) {
  function builder(
    table: string,
  ) {
    const op: Op = {
      table,
      filters: [],
      orders: [],
      limitValue: null,
    };

    const chain: Record<string, unknown> = {
      select: () => {
        recorder.ops.push(op);
        return chain;
      },
      eq: (col: string, val: unknown) => {
        op.filters.push([col, val]);
        return chain;
      },
      ilike: (col: string, val: unknown) => {
        op.filters.push([col, `ilike:${String(val)}`]);
        return chain;
      },
      gte: (col: string, val: unknown) => {
        op.filters.push([col, `gte:${String(val)}`]);
        return chain;
      },
      lte: (col: string, val: unknown) => {
        op.filters.push([col, `lte:${String(val)}`]);
        return chain;
      },
      order: (col: string, opts: { ascending: boolean }) => {
        op.orders.push([col, opts.ascending]);
        return chain;
      },
      limit: (n: number) => {
        op.limitValue = n;
        return chain;
      },
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
  "listAuditEvents",
  () => {
    it(
      "returns mapped AuditEvent[] for a simple call, with a USER actor resolved to its user_id",
      async () => {
        const result =
          await listAuditEvents(
            makeMockSupabase(
              {
                audit_events: { data: [userEventRow], error: null },
              },
            ),
            orgId,
          );

        expect(result).toEqual(
          [
            {
              id: "event-1",
              org_id: "org-1",
              occurred_at: "2026-02-01T00:00:00Z",
              actor: { type: "USER", user_id: "user-1" },
              event_type: "shipment.created",
              aggregate: { type: "SHIPMENT", id: "ship-1" },
              payload: { reference: "REF-001" },
              correlation_id: null,
            },
          ],
        );
      },
    );

    it(
      "maps a SYSTEM-actor row without a user_id, and a null org_id, and a populated correlation_id, correctly",
      async () => {
        const result =
          await listAuditEvents(
            makeMockSupabase(
              {
                audit_events: { data: [systemEventRow], error: null },
              },
            ),
            orgId,
          );

        expect(result[0]).toEqual(
          {
            id: "event-2",
            org_id: null,
            occurred_at: "2026-02-02T00:00:00Z",
            actor: { type: "SYSTEM" },
            event_type: "regulatory_dataset.activated",
            aggregate: { type: "CALCULATION_RESULT", id: "dataset-1" },
            payload: {},
            correlation_id: "corr-1",
          },
        );
      },
    );

    it(
      "applies the explicit org_id filter (Wall 1 defense in depth, not relying on RLS alone)",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        await listAuditEvents(
          makeMockSupabase(
            {
              audit_events: { data: [], error: null },
            },
            recorder,
          ),
          orgId,
        );

        expect(recorder.ops[0]?.filters).toContainEqual(
          ["org_id", orgId],
        );
      },
    );

    it(
      "applies eventTypePrefix as an ilike prefix match, appending the SQL wildcard itself and escaping the literal underscore already in this catalog namespace (sharing_grant.) so it matches a literal '_', not ilike's any-single-character wildcard -- updated alongside finding #2's escapeLikePattern fix, which corrected this test's own previously-unescaped expectation",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        await listAuditEvents(
          makeMockSupabase(
            {
              audit_events: { data: [], error: null },
            },
            recorder,
          ),
          orgId,
          { eventTypePrefix: "sharing_grant." },
        );

        expect(recorder.ops[0]?.filters).toContainEqual(
          ["event_type", "ilike:sharing\\_grant.%"],
        );
      },
    );

    it(
      "escapes LIKE metacharacters (% _ \\) in a user-supplied eventTypePrefix before appending the wildcard, so they're matched as literal text rather than as live SQL wildcards (P8 security review, finding #2)",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        await listAuditEvents(
          makeMockSupabase(
            {
              audit_events: { data: [], error: null },
            },
            recorder,
          ),
          orgId,
          { eventTypePrefix: "a%b_c\\d" },
        );

        expect(recorder.ops[0]?.filters).toContainEqual(
          ["event_type", "ilike:a\\%b\\_c\\\\d%"],
        );
      },
    );

    it(
      "applies aggregateType as an equality filter",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        await listAuditEvents(
          makeMockSupabase(
            {
              audit_events: { data: [], error: null },
            },
            recorder,
          ),
          orgId,
          { aggregateType: "SHARING_GRANT" },
        );

        expect(recorder.ops[0]?.filters).toContainEqual(
          ["aggregate_type", "SHARING_GRANT"],
        );
      },
    );

    it(
      "applies occurredFrom/occurredTo as an inclusive occurred_at range",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        await listAuditEvents(
          makeMockSupabase(
            {
              audit_events: { data: [], error: null },
            },
            recorder,
          ),
          orgId,
          {
            occurredFrom: "2026-01-01T00:00:00Z" as never,
            occurredTo: "2026-01-31T23:59:59Z" as never,
          },
        );

        expect(recorder.ops[0]?.filters).toContainEqual(
          ["occurred_at", "gte:2026-01-01T00:00:00Z"],
        );

        expect(recorder.ops[0]?.filters).toContainEqual(
          ["occurred_at", "lte:2026-01-31T23:59:59Z"],
        );
      },
    );

    it(
      "omits a filter entirely when its option is not provided",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        await listAuditEvents(
          makeMockSupabase(
            {
              audit_events: { data: [], error: null },
            },
            recorder,
          ),
          orgId,
        );

        const filterColumns =
          recorder.ops[0]?.filters.map(([col]) => col);

        expect(filterColumns).toEqual(
          ["org_id"],
        );
      },
    );

    it(
      "orders by occurred_at desc with id desc as a stable tiebreak",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        await listAuditEvents(
          makeMockSupabase(
            {
              audit_events: { data: [], error: null },
            },
            recorder,
          ),
          orgId,
        );

        expect(recorder.ops[0]?.orders).toEqual(
          [
            ["occurred_at", false],
            ["id", false],
          ],
        );
      },
    );

    it(
      "caps the query at the default limit of 200 when none is passed",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        await listAuditEvents(
          makeMockSupabase(
            {
              audit_events: { data: [], error: null },
            },
            recorder,
          ),
          orgId,
        );

        expect(recorder.ops[0]?.limitValue).toBe(
          200,
        );
      },
    );

    it(
      "caps the query at a caller-supplied limit when one is passed",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        await listAuditEvents(
          makeMockSupabase(
            {
              audit_events: { data: [], error: null },
            },
            recorder,
          ),
          orgId,
          undefined,
          50,
        );

        expect(recorder.ops[0]?.limitValue).toBe(
          50,
        );
      },
    );

    it(
      "returns an empty array on a query error, without throwing",
      async () => {
        const result =
          await listAuditEvents(
            makeMockSupabase(
              {
                audit_events: { data: null, error: { message: "denied" } },
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
      "returns an empty array when the org has no audit events at all",
      async () => {
        const result =
          await listAuditEvents(
            makeMockSupabase(
              {
                audit_events: { data: [], error: null },
              },
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

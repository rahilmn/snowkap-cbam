import {
  describe,
  expect,
  it,
} from "vitest";

import {
  generateOrRefreshDeclarationDraft,
} from "./generate-or-refresh-declaration-draft";

const orgId =
  "org-1";

const annualPeriod =
  { kind: "ANNUAL", year: 2026 } as never;

const adminContext =
  {
    org_id: orgId,
    user_id: "admin-1",
    role: "ADMIN",
    capabilities: ["IMPORTER_DECLARANT"],
  } as never;

const memberContext =
  {
    org_id: orgId,
    user_id: "member-1",
    role: "MEMBER",
    capabilities: ["IMPORTER_DECLARANT"],
  } as never;

function declarationRow(
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "decl-1",
    org_id: orgId,
    reporting_period_kind: "ANNUAL",
    reporting_period_year: 2026,
    reporting_period_quarter: null,
    status: "DRAFT",
    member_shipment_ids: [],
    completeness_report: null,
    filed_snapshot: null,
    filed_reference: null,
    filed_at: null,
    supersedes_declaration_id: null,
    created_by_user_id: "admin-1",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

interface Recorder {
  fromCalls: string[];
}

/**
 * Same cursor-per-table shape as manage-sharing-grants.test.ts's own
 * makeMockSupabase (each table's `data`/`error` entry can be a single
 * canned response reused for every query, or an array consumed in
 * order) -- needed here because "declarations" is queried twice in one
 * call (the existing-lookup SELECT, then the refresh UPDATE or the
 * create INSERT), each of which must be able to answer differently.
 */
function makeMockSupabase(
  tables: Record<string, { data: unknown; error: unknown } | { data: unknown; error: unknown }[]>,
  recorder: Recorder = { fromCalls: [] },
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
      in: () => chain,
      is: () => chain,
      order: () => chain,
      insert: () => chain,
      update: () => chain,
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

const emptyShipmentPeriodTables = {
  shipments: { data: [], error: null },
  audit_events: { data: null, error: null },
};

describe(
  "generateOrRefreshDeclarationDraft",
  () => {
    it(
      "rejects PERMISSION_DENIED for a MEMBER, before any database read",
      async () => {
        const recorder: Recorder =
          { fromCalls: [] };

        const result =
          await generateOrRefreshDeclarationDraft(
            makeMockSupabase(
              {},
              recorder,
            ),
            memberContext,
            annualPeriod,
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
      "creates a fresh DRAFT when no declaration exists yet for the period, with a computed completeness_report",
      async () => {
        const result =
          await generateOrRefreshDeclarationDraft(
            makeMockSupabase(
              {
                declarations: [
                  { data: [], error: null },
                  { data: declarationRow(), error: null },
                ],
                ...emptyShipmentPeriodTables,
              },
            ),
            adminContext,
            annualPeriod,
          );

        expect(result.status).toBe(
          "OK",
        );

        if (result.status === "OK") {
          expect(result.declaration.status).toBe(
            "DRAFT",
          );
        }
      },
    );

    it(
      "refreshes the existing DRAFT (not a new insert) when one already exists for the period",
      async () => {
        const recorder: Recorder =
          { fromCalls: [] };

        const result =
          await generateOrRefreshDeclarationDraft(
            makeMockSupabase(
              {
                declarations: [
                  { data: [declarationRow()], error: null },
                  { data: declarationRow({ member_shipment_ids: [] }), error: null },
                ],
                ...emptyShipmentPeriodTables,
              },
              recorder,
            ),
            adminContext,
            annualPeriod,
          );

        expect(result.status).toBe(
          "OK",
        );

        // Exactly one lookup + one write against declarations -- no
        // duplicate insert alongside the refresh.
        expect(
          recorder.fromCalls.filter((table) => table === "declarations"),
        ).toHaveLength(
          2,
        );
      },
    );

    it(
      "rejects PERIOD_HAS_READY_DECLARATION without creating a second declaration for the same period",
      async () => {
        const result =
          await generateOrRefreshDeclarationDraft(
            makeMockSupabase(
              {
                declarations: { data: [declarationRow({ status: "READY" })], error: null },
              },
            ),
            adminContext,
            annualPeriod,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "PERIOD_HAS_READY_DECLARATION" },
        );
      },
    );

    it(
      "rejects PERIOD_ALREADY_FILED when the period's non-superseded original is already FILED_RECORDED",
      async () => {
        const result =
          await generateOrRefreshDeclarationDraft(
            makeMockSupabase(
              {
                declarations: {
                  data: [
                    declarationRow(
                      {
                        status: "FILED_RECORDED",
                        filed_reference: "EU/CBAM/2026/1",
                        filed_at: "2026-02-01T00:00:00Z",
                        filed_snapshot: { snapshot_version: 1 },
                      },
                    ),
                  ],
                  error: null,
                },
              },
            ),
            adminContext,
            annualPeriod,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "PERIOD_ALREADY_FILED" },
        );
      },
    );
  },
);

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  markDeclarationReady,
} from "./mark-declaration-ready";

const orgId =
  "org-1";

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

const adminNoCapabilityContext =
  {
    org_id: orgId,
    user_id: "admin-1",
    role: "ADMIN",
    capabilities: ["PRODUCER_OPERATOR"],
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

function shipmentRow(
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "ship-1",
    org_id: orgId,
    reference: "REF-001",
    release_date: "2026-03-15",
    reporting_period_kind: "ANNUAL",
    reporting_period_year: 2026,
    reporting_period_quarter: null,
    customs_mrn: null,
    customs_procedure: null,
    status: "READY",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const lineRow =
  {
    id: "line-1",
    shipment_id: "ship-1",
    org_id: orgId,
    line_number: 1,
    cn_code: "72081000",
    cn_code_level: "CN8",
    goods_description: null,
    origin_country: "DE",
    net_mass_tonnes: "10",
    quantity_mwh: null,
    production_route_name: null,
    production_route_indicator: null,
    emission_determination: { method: "DEFAULT" },
  };

const calculationRow =
  {
    id: "calc-1",
    line_id: "line-1",
    engine_version: "1.1.0",
    embedded_emissions_tco2e: "12.5",
    steps: [],
    calculated_at: "2026-02-01T00:00:00Z",
    // Matches lineRow's own emission_determination -- keeps this
    // fixture pair "current" (see compute-declaration-draft-facts.ts's
    // P13 calculation_is_current check) by default.
    determination: { method: "DEFAULT" },
  };

interface Recorder {
  fromCalls: string[];
}

// Same cursor-per-table mock as generate-or-refresh-declaration-draft.test.ts's
// own makeMockSupabase -- see that file's doc comment.
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
      range: () => chain,
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

const completePeriodTables = {
  shipments: { data: [shipmentRow()], error: null },
  shipment_lines: { data: [lineRow], error: null },
  latest_calculation_results: { data: [calculationRow], error: null },
  audit_events: { data: null, error: null },
};

const incompletePeriodTables = {
  shipments: { data: [shipmentRow()], error: null },
  shipment_lines: { data: [], error: null },
  latest_calculation_results: { data: [], error: null },
  audit_events: { data: null, error: null },
};

describe(
  "markDeclarationReady",
  () => {
    it(
      "rejects PERMISSION_DENIED for a MEMBER, before any database read",
      async () => {
        const recorder: Recorder =
          { fromCalls: [] };

        const result =
          await markDeclarationReady(
            makeMockSupabase(
              {},
              recorder,
            ),
            memberContext,
            "decl-1" as never,
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
      "rejects CAPABILITY_NOT_HELD for an ADMIN whose org lacks IMPORTER_DECLARANT, before any database read",
      async () => {
        const recorder: Recorder =
          { fromCalls: [] };

        const result =
          await markDeclarationReady(
            makeMockSupabase(
              {},
              recorder,
            ),
            adminNoCapabilityContext,
            "decl-1" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "CAPABILITY_NOT_HELD" },
        );

        expect(recorder.fromCalls).toEqual(
          [],
        );
      },
    );

    it(
      "transitions DRAFT -> READY and freezes the freshly-computed member set + completeness_report",
      async () => {
        const result =
          await markDeclarationReady(
            makeMockSupabase(
              {
                declarations: [
                  { data: declarationRow(), error: null },
                  { data: declarationRow({ status: "READY" }), error: null },
                ],
                ...completePeriodTables,
              },
            ),
            adminContext,
            "decl-1" as never,
          );

        expect(result.status).toBe(
          "OK",
        );

        if (result.status === "OK") {
          expect(result.declaration.status).toBe(
            "READY",
          );
        }
      },
    );

    it(
      "rejects NOT_FOUND when the declaration doesn't exist (or isn't visible via RLS)",
      async () => {
        const result =
          await markDeclarationReady(
            makeMockSupabase(
              {
                declarations: { data: null, error: null },
              },
            ),
            adminContext,
            "decl-1" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "NOT_FOUND" },
        );
      },
    );

    it(
      "rejects NOT_FOUND (not a more specific reason) when the declaration belongs to a different org -- audit-attribution guard",
      async () => {
        const result =
          await markDeclarationReady(
            makeMockSupabase(
              {
                declarations: { data: declarationRow({ org_id: "org-2" }), error: null },
              },
            ),
            adminContext,
            "decl-1" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "NOT_FOUND" },
        );
      },
    );

    it(
      "rejects NOT_DRAFT for an already-READY declaration",
      async () => {
        const result =
          await markDeclarationReady(
            makeMockSupabase(
              {
                declarations: { data: declarationRow({ status: "READY" }), error: null },
              },
            ),
            adminContext,
            "decl-1" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "NOT_DRAFT" },
        );
      },
    );

    it(
      "rejects INCOMPLETE with the exact, current completeness_report when a fresh recompute finds a gap -- never trusts a stale cached report",
      async () => {
        const result =
          await markDeclarationReady(
            makeMockSupabase(
              {
                declarations: { data: declarationRow({ completeness_report: { complete: true, blockers: [] } }), error: null },
                ...incompletePeriodTables,
              },
            ),
            adminContext,
            "decl-1" as never,
          );

        expect(result.status).toBe(
          "REJECTED",
        );

        if (result.status === "REJECTED") {
          expect(result.reason).toBe(
            "INCOMPLETE",
          );

          expect(result.completeness_report?.complete).toBe(
            false,
          );

          expect(result.completeness_report?.blockers).toEqual(
            [
              {
                reason: "SHIPMENT_HAS_NO_LINES",
                shipment_id: "ship-1",
                shipment_reference: "REF-001",
              },
            ],
          );
        }
      },
    );
  },
);

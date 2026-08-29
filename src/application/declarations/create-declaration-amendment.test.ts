import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createDeclarationAmendment,
} from "./create-declaration-amendment";

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

function filedDeclarationRow(
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "decl-1",
    org_id: orgId,
    reporting_period_kind: "ANNUAL",
    reporting_period_year: 2026,
    reporting_period_quarter: null,
    status: "FILED_RECORDED",
    member_shipment_ids: ["ship-1"],
    completeness_report: { complete: true, blockers: [] },
    filed_snapshot: { snapshot_version: 1 },
    filed_reference: "EU/CBAM/2026/1",
    filed_at: "2026-02-01T00:00:00Z",
    supersedes_declaration_id: null,
    created_by_user_id: "admin-1",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-02-01T00:00:00Z",
    ...overrides,
  };
}

interface Recorder {
  fromCalls: string[];
}

// Same cursor-per-table mock as generate-or-refresh-declaration-draft.test.ts's
// own makeMockSupabase.
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

describe(
  "createDeclarationAmendment",
  () => {
    it(
      "rejects PERMISSION_DENIED for a MEMBER, before any database read",
      async () => {
        const recorder: Recorder =
          { fromCalls: [] };

        const result =
          await createDeclarationAmendment(
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
      "creates a bare DRAFT chained via supersedes_declaration_id from a FILED_RECORDED original",
      async () => {
        const result =
          await createDeclarationAmendment(
            makeMockSupabase(
              {
                declarations: [
                  { data: filedDeclarationRow(), error: null },
                  { data: [], error: null },
                  {
                    data: filedDeclarationRow(
                      {
                        id: "decl-2",
                        status: "DRAFT",
                        member_shipment_ids: [],
                        completeness_report: null,
                        filed_snapshot: null,
                        filed_reference: null,
                        filed_at: null,
                        supersedes_declaration_id: "decl-1",
                      },
                    ),
                    error: null,
                  },
                ],
                audit_events: { data: null, error: null },
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
            "DRAFT",
          );

          expect(result.declaration.supersedes_declaration_id).toBe(
            "decl-1",
          );
        }
      },
    );

    it(
      "rejects NOT_FOUND when the original belongs to a different org",
      async () => {
        const result =
          await createDeclarationAmendment(
            makeMockSupabase(
              {
                declarations: { data: filedDeclarationRow({ org_id: "org-2" }), error: null },
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
      "rejects ORIGINAL_NOT_FILED for a DRAFT/READY original",
      async () => {
        const result =
          await createDeclarationAmendment(
            makeMockSupabase(
              {
                declarations: { data: filedDeclarationRow({ status: "READY" }), error: null },
              },
            ),
            adminContext,
            "decl-1" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "ORIGINAL_NOT_FILED" },
        );
      },
    );

    it(
      "rejects ALREADY_AMENDED when a non-VOID successor already supersedes this original",
      async () => {
        const result =
          await createDeclarationAmendment(
            makeMockSupabase(
              {
                declarations: [
                  { data: filedDeclarationRow(), error: null },
                  { data: [{ id: "decl-2" }], error: null },
                ],
              },
            ),
            adminContext,
            "decl-1" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "ALREADY_AMENDED" },
        );
      },
    );
  },
);

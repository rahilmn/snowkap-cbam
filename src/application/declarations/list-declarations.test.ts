import {
  describe,
  expect,
  it,
} from "vitest";

import {
  listDeclarations,
} from "./list-declarations";

const declarationRow =
  {
    id: "decl-1",
    org_id: "org-1",
    reporting_period_kind: "ANNUAL",
    reporting_period_year: 2026,
    reporting_period_quarter: null,
    status: "DRAFT",
    member_shipment_ids: ["ship-1"],
    completeness_report: null,
    filed_snapshot: null,
    filed_reference: null,
    filed_at: null,
    supersedes_declaration_id: null,
    created_by_user_id: "admin-1",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };

function mockSupabase(
  result: { data: unknown; error: unknown },
) {
  return {
    from: () => (
      {
        select: () => (
          {
            eq: () => (
              {
                order: () =>
                  Promise.resolve(
                    result,
                  ),
              }
            ),
          }
        ),
      }
    ),
  } as never;
}

describe(
  "listDeclarations",
  () => {
    it(
      "maps rows to Declaration objects",
      async () => {
        const result =
          await listDeclarations(
            mockSupabase(
              { data: [declarationRow], error: null },
            ),
            "org-1" as never,
          );

        expect(result).toEqual(
          [
            {
              id: "decl-1",
              org_id: "org-1",
              reporting_period: { kind: "ANNUAL", year: 2026 },
              status: "DRAFT",
              member_shipment_ids: ["ship-1"],
              completeness_report: null,
              filed_snapshot: null,
              filed_reference: null,
              filed_at: null,
              supersedes_declaration_id: null,
              created_by_user_id: "admin-1",
              created_at: "2026-01-01T00:00:00Z",
              updated_at: "2026-01-01T00:00:00Z",
            },
          ],
        );
      },
    );

    it(
      "returns an empty array on error, never a partial or fabricated list",
      async () => {
        const result =
          await listDeclarations(
            mockSupabase(
              { data: null, error: { message: "boom" } },
            ),
            "org-1" as never,
          );

        expect(result).toEqual(
          [],
        );
      },
    );
  },
);

import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  DeclarationId,
  OrganizationId,
  ShipmentId,
  UserId,
} from "../../domain/shared/ids";

import type {
  IsoTimestamp,
} from "../../domain/shared/reporting-period";

import type {
  DeclarationRow,
} from "./declaration-mapper";

import {
  periodColumns,
  toDeclaration,
} from "./declaration-mapper";

function baseRow(
  overrides: Partial<DeclarationRow> = {},
): DeclarationRow {
  return {
    id: "declaration-1",
    org_id: "org-1",
    reporting_period_kind: "ANNUAL",
    reporting_period_year: 2026,
    reporting_period_quarter: null,
    status: "DRAFT",
    member_shipment_ids: ["shipment-1", "shipment-2"],
    completeness_report: null,
    filed_snapshot: null,
    filed_reference: null,
    filed_at: null,
    supersedes_declaration_id: null,
    created_by_user_id: "user-1",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    ...overrides,
  };
}

describe(
  "toDeclaration",
  () => {
    it(
      "maps a full ANNUAL row to a Declaration, round-tripping every field including type-branded IDs",
      () => {
        const row =
          baseRow(
            {
              status: "FILED_RECORDED",
              completeness_report: {
                generated_at: "2026-01-01T00:00:00Z" as IsoTimestamp,
                shipment_count: 2,
                line_count: 4,
                complete: true,
                blockers: [],
              },
              filed_snapshot: { note: "snapshot" },
              filed_reference: "REF-123",
              filed_at: "2026-02-01T00:00:00Z",
              supersedes_declaration_id: "declaration-0",
            },
          );

        const result =
          toDeclaration(
            row,
          );

        expect(
          result,
        ).toEqual(
          {
            id: "declaration-1" as DeclarationId,
            org_id: "org-1" as OrganizationId,
            reporting_period: {
              kind: "ANNUAL",
              year: 2026,
            },
            status: "FILED_RECORDED",
            member_shipment_ids: ["shipment-1", "shipment-2"] as ShipmentId[],
            completeness_report: row.completeness_report,
            filed_snapshot: { note: "snapshot" },
            filed_reference: "REF-123",
            filed_at: "2026-02-01T00:00:00Z" as IsoTimestamp,
            supersedes_declaration_id: "declaration-0" as DeclarationId,
            created_by_user_id: "user-1" as UserId,
            created_at: "2026-01-01T00:00:00Z" as IsoTimestamp,
            updated_at: "2026-01-02T00:00:00Z" as IsoTimestamp,
          },
        );
      },
    );

    it(
      "builds a QUARTERLY reporting_period from the row's kind/year/quarter columns",
      () => {
        const row =
          baseRow(
            {
              reporting_period_kind: "QUARTERLY",
              reporting_period_year: 2025,
              reporting_period_quarter: 3,
            },
          );

        const result =
          toDeclaration(
            row,
          );

        expect(
          result.reporting_period,
        ).toEqual(
          {
            kind: "QUARTERLY",
            year: 2025,
            quarter: 3,
          },
        );
      },
    );

    it(
      "builds an ANNUAL reporting_period from the row's kind/year columns, ignoring any quarter value",
      () => {
        const row =
          baseRow(
            {
              reporting_period_kind: "ANNUAL",
              reporting_period_year: 2026,
              reporting_period_quarter: null,
            },
          );

        const result =
          toDeclaration(
            row,
          );

        expect(
          result.reporting_period,
        ).toEqual(
          {
            kind: "ANNUAL",
            year: 2026,
          },
        );
      },
    );

    it(
      "defaults member_shipment_ids to an empty array when the row's value is null",
      () => {
        const row =
          baseRow(
            {
              member_shipment_ids: null,
            },
          );

        const result =
          toDeclaration(
            row,
          );

        expect(
          result.member_shipment_ids,
        ).toEqual(
          [],
        );
      },
    );

    it(
      "preserves a non-null member_shipment_ids array as-is",
      () => {
        const row =
          baseRow(
            {
              member_shipment_ids: ["shipment-9"],
            },
          );

        const result =
          toDeclaration(
            row,
          );

        expect(
          result.member_shipment_ids,
        ).toEqual(
          ["shipment-9"],
        );
      },
    );
  },
);

describe(
  "periodColumns",
  () => {
    it(
      "maps an ANNUAL period to reporting_period_kind ANNUAL with a null quarter column",
      () => {
        expect(
          periodColumns(
            {
              kind: "ANNUAL",
              year: 2026,
            },
          ),
        ).toEqual(
          {
            reporting_period_kind: "ANNUAL",
            reporting_period_year: 2026,
            reporting_period_quarter: null,
          },
        );
      },
    );

    it(
      "maps a QUARTERLY period to reporting_period_kind QUARTERLY with the quarter column set",
      () => {
        expect(
          periodColumns(
            {
              kind: "QUARTERLY",
              year: 2025,
              quarter: 4,
            },
          ),
        ).toEqual(
          {
            reporting_period_kind: "QUARTERLY",
            reporting_period_year: 2025,
            reporting_period_quarter: 4,
          },
        );
      },
    );
  },
);

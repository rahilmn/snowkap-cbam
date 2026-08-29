import {
  describe,
  expect,
  it,
} from "vitest";

import {
  reportingPeriodColumns,
  toEmissionData,
} from "./emission-data-mapper";

import type {
  EmissionDataRow,
} from "./emission-data-mapper";

function emissionDataRow(
  overrides: Partial<EmissionDataRow> = {},
): EmissionDataRow {
  return {
    id: "emission-1",
    installation_id: "inst-1",
    entered_by_org_id: "org-producer",
    cn_scope: ["7208 10 00"],
    reporting_period_kind: "ANNUAL",
    reporting_period_year: 2026,
    reporting_period_quarter: null,
    direct_specific: "1.5",
    indirect_specific: "0.25",
    emission_unit: "tCO2e/t",
    methodology: "EU_METHOD",
    verification_status: "VERIFIED",
    verifier_user_id: "user-1",
    rejection_reason: null,
    evidence_file_ids: ["evidence-1"],
    version: 1,
    predecessor_id: null,
    status: "ACTIVE",
    created_at: "2026-08-28T00:00:00.000Z",
    updated_at: "2026-08-29T00:00:00.000Z",
    ...overrides,
  };
}

describe(
  "reportingPeriodColumns",
  () => {
    it(
      "returns the flat ANNUAL columns with a null quarter",
      () => {
        const columns =
          reportingPeriodColumns(
            {
              kind: "ANNUAL",
              year: 2026,
            },
          );

        expect(
          columns,
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
      "returns the flat QUARTERLY columns with the quarter carried through",
      () => {
        const columns =
          reportingPeriodColumns(
            {
              kind: "QUARTERLY",
              year: 2025,
              quarter: 2,
            },
          );

        expect(
          columns,
        ).toEqual(
          {
            reporting_period_kind: "QUARTERLY",
            reporting_period_year: 2025,
            reporting_period_quarter: 2,
          },
        );
      },
    );
  },
);

describe(
  "toEmissionData",
  () => {
    it(
      "maps a full ANNUAL-period row onto every EmissionData field",
      () => {
        const row =
          emissionDataRow();

        const result =
          toEmissionData(
            row,
          );

        expect(
          result,
        ).toEqual(
          {
            id: "emission-1",
            installation_id: "inst-1",
            entered_by_org_id: "org-producer",
            cn_scope: ["7208 10 00"],
            period: {
              kind: "ANNUAL",
              year: 2026,
            },
            direct_specific: "1.5",
            indirect_specific: "0.25",
            emission_unit: "tCO2e/t",
            methodology: "EU_METHOD",
            verification_status: "VERIFIED",
            verifier_user_id: "user-1",
            rejection_reason: null,
            evidence_file_ids: ["evidence-1"],
            version: 1,
            predecessor_id: null,
            status: "ACTIVE",
            created_at: "2026-08-28T00:00:00.000Z",
            updated_at: "2026-08-29T00:00:00.000Z",
          },
        );
      },
    );

    it(
      "reconstructs a QUARTERLY period, carrying the quarter through",
      () => {
        const row =
          emissionDataRow(
            {
              reporting_period_kind: "QUARTERLY",
              reporting_period_year: 2025,
              reporting_period_quarter: 3,
            },
          );

        const result =
          toEmissionData(
            row,
          );

        expect(
          result.period,
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
      "passes a null verifier_user_id and predecessor_id through unchanged, and carries a rejection_reason",
      () => {
        const row =
          emissionDataRow(
            {
              verification_status: "REJECTED",
              verifier_user_id: null,
              rejection_reason: "insufficient supporting evidence",
              predecessor_id: null,
            },
          );

        const result =
          toEmissionData(
            row,
          );

        expect(
          result.verifier_user_id,
        ).toBeNull();

        expect(
          result.rejection_reason,
        ).toBe(
          "insufficient supporting evidence",
        );

        expect(
          result.predecessor_id,
        ).toBeNull();
      },
    );

    it(
      "carries a non-null predecessor_id through for a superseding version",
      () => {
        const row =
          emissionDataRow(
            {
              version: 2,
              predecessor_id: "emission-0",
              status: "DRAFT",
            },
          );

        const result =
          toEmissionData(
            row,
          );

        expect(
          result.version,
        ).toBe(
          2,
        );

        expect(
          result.predecessor_id,
        ).toBe(
          "emission-0",
        );

        expect(
          result.status,
        ).toBe(
          "DRAFT",
        );
      },
    );
  },
);

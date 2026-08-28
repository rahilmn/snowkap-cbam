import {
  describe,
  expect,
  it,
} from "vitest";

import {
  summarizeDeterminationForAudit,
} from "./summarize-determination-for-audit";

import type {
  EmissionDetermination,
} from "./types";

describe(
  "summarizeDeterminationForAudit",
  () => {
    it(
      "returns null for a null determination (nothing to record as 'previous')",
      () => {
        expect(
          summarizeDeterminationForAudit(
            null,
          ),
        ).toBeNull();
      },
    );

    it(
      "summarizes a DEFAULT determination's method, reason, and dataset_version -- not its full trace",
      () => {
        const determination: EmissionDetermination =
          {
            method: "DEFAULT",
            resolution: {
              dataset_id: "dataset-1" as never,
              dataset_version: "2026-definitive-corrected",
              resolved_at: "2026-01-01T00:00:00Z" as never,
              reason: "EXACT_CN8_MATCH" as never,
              country_mapping: { status: "MAPPED", regulatory_country_name: "China" },
              record_identity: {
                source_sheet: "sheet",
                source_row: 1,
                source_trade_code: "72081000",
                origin_country_name: "China",
                source_production_route_code: null,
              },
              values: {
                direct: { status: "AVAILABLE", value: "1.0" } as never,
                indirect: { status: "AVAILABLE", value: "0.1" } as never,
                total: { status: "AVAILABLE", value: "1.1" } as never,
              },
              emission_unit: "tCO2e/t",
              trace: [
                { step: "1", outcome: "matched" },
              ] as never,
            },
          };

        expect(
          summarizeDeterminationForAudit(
            determination,
          ),
        ).toEqual(
          {
            method: "DEFAULT",
            reason: "EXACT_CN8_MATCH",
            dataset_version: "2026-definitive-corrected",
          },
        );
      },
    );

    it(
      "summarizes an ACTUAL determination's emission_data_id, version, and sharing_grant_id",
      () => {
        const determination: EmissionDetermination =
          {
            method: "ACTUAL",
            snapshot: {
              emission_data_id: "emission-data-1" as never,
              emission_data_version: 2,
              installation_id: "installation-1" as never,
              resolved_at: "2026-01-01T00:00:00Z" as never,
              values: { direct_specific: "1.0" as never, indirect_specific: "0.1" as never },
              emission_unit: "tCO2e/t",
              methodology: "EU_METHOD",
              verification: { status: "VERIFIED", verifier_user_id: "user-1" as never },
              evidence_file_ids: [],
              sharing_grant_id: "grant-1" as never,
            },
          };

        expect(
          summarizeDeterminationForAudit(
            determination,
          ),
        ).toEqual(
          {
            method: "ACTUAL",
            emission_data_id: "emission-data-1",
            emission_data_version: 2,
            sharing_grant_id: "grant-1",
          },
        );
      },
    );

    it(
      "an ACTUAL determination with a null sharing_grant_id (own-org data) carries that through as null, not omitted",
      () => {
        const determination: EmissionDetermination =
          {
            method: "ACTUAL",
            snapshot: {
              emission_data_id: "emission-data-2" as never,
              emission_data_version: 1,
              installation_id: "installation-1" as never,
              resolved_at: "2026-01-01T00:00:00Z" as never,
              values: { direct_specific: "1.0" as never, indirect_specific: "0.1" as never },
              emission_unit: "tCO2e/t",
              methodology: "OTHER",
              verification: { status: "VERIFIED", verifier_user_id: "user-1" as never },
              evidence_file_ids: [],
              sharing_grant_id: null,
            },
          };

        expect(
          summarizeDeterminationForAudit(
            determination,
          ),
        ).toEqual(
          {
            method: "ACTUAL",
            emission_data_id: "emission-data-2",
            emission_data_version: 1,
            sharing_grant_id: null,
          },
        );
      },
    );
  },
);

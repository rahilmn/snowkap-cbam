import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  ActualEmissionSnapshot,
  EmissionData,
  RegulatoryResolutionSnapshot,
} from "./types";

import {
  checkActualEmissionSnapshotCompleteness,
  checkEmissionDataEvidenceCompleteness,
  checkRegulatoryResolutionSnapshotCompleteness,
} from "./snapshot-completeness";

function completeRegulatoryResolutionSnapshot(): RegulatoryResolutionSnapshot {
  return {
    dataset_id: "dataset-1",
    dataset_version: "2026-definitive-corrected",
    resolved_at: "2026-01-01T00:00:00.000Z" as RegulatoryResolutionSnapshot["resolved_at"],
    reason: "EXACT_CN8_MATCH",

    country_mapping: { status: "MAPPED", regulatory_country_name: "India" },

    record_identity: {
      source_sheet: "Iron and steel",
      source_row: 42,
      source_trade_code: "72061000",
      origin_country_name: "India",
      source_production_route_code: "(C)",
    },

    values: {
      direct: {
        value: "1.5",
        status: "AVAILABLE",
        raw_source_value: "1.5",
      },

      indirect: {
        value: "0.2",
        status: "AVAILABLE",
        raw_source_value: "0.2",
      },

      total: {
        value: "1.7",
        status: "AVAILABLE",
        raw_source_value: "1.7",
      },
    },

    emission_unit: "tCO2e/t",

    trace: [
      {
        step: "EXACT_MATCH",
        outcome: "MATCHED",
      },
    ],
  };
}

function completeActualEmissionSnapshot(): ActualEmissionSnapshot {
  return {
    emission_data_id: "emission-data-1" as ActualEmissionSnapshot["emission_data_id"],
    emission_data_version: 1,
    installation_id: "installation-1" as ActualEmissionSnapshot["installation_id"],
    resolved_at: "2026-01-01T00:00:00.000Z" as ActualEmissionSnapshot["resolved_at"],

    values: {
      direct_specific: "1.5" as ActualEmissionSnapshot["values"]["direct_specific"],
      indirect_specific: "0.2" as ActualEmissionSnapshot["values"]["indirect_specific"],
    },

    emission_unit: "tCO2e/t",
    methodology: "EU_METHOD",

    verification: {
      status: "VERIFIED",
      verifier_user_id: "user-1" as ActualEmissionSnapshot["verification"]["verifier_user_id"],
    },

    evidence_file_ids: ["evidence-1"],
    sharing_grant_id: null,
  };
}

describe(
  "checkRegulatoryResolutionSnapshotCompleteness",
  () => {
    it(
      "reports COMPLETE for a fully-populated snapshot",
      () => {
        expect(
          checkRegulatoryResolutionSnapshotCompleteness(
            completeRegulatoryResolutionSnapshot(),
          ),
        ).toEqual(
          {
            status: "COMPLETE",
          },
        );
      },
    );

    it(
      "reports the missing field when dataset_version is empty",
      () => {
        const snapshot =
          completeRegulatoryResolutionSnapshot();

        snapshot.dataset_version =
          "";

        const result =
          checkRegulatoryResolutionSnapshotCompleteness(
            snapshot,
          );

        expect(
          result.status,
        ).toBe(
          "INCOMPLETE",
        );

        if (result.status === "INCOMPLETE") {
          expect(
            result.missingFields,
          ).toContain(
            "dataset_version",
          );
        }
      },
    );

    it(
      "reports missing when the trace is empty",
      () => {
        const snapshot =
          completeRegulatoryResolutionSnapshot();

        snapshot.trace =
          [];

        const result =
          checkRegulatoryResolutionSnapshotCompleteness(
            snapshot,
          );

        expect(
          result.status,
        ).toBe(
          "INCOMPLETE",
        );

        if (result.status === "INCOMPLETE") {
          expect(
            result.missingFields,
          ).toContain(
            "trace",
          );
        }
      },
    );

    it(
      "reports missing when record_identity.source_sheet is empty",
      () => {
        const snapshot =
          completeRegulatoryResolutionSnapshot();

        snapshot.record_identity.source_sheet =
          "";

        const result =
          checkRegulatoryResolutionSnapshotCompleteness(
            snapshot,
          );

        expect(
          result.status,
        ).toBe(
          "INCOMPLETE",
        );

        if (result.status === "INCOMPLETE") {
          expect(
            result.missingFields,
          ).toContain(
            "record_identity.source_sheet",
          );
        }
      },
    );

    it(
      "reports every missing field at once, not just the first",
      () => {
        const snapshot =
          completeRegulatoryResolutionSnapshot();

        snapshot.dataset_version =
          "";

        snapshot.trace =
          [];

        const result =
          checkRegulatoryResolutionSnapshotCompleteness(
            snapshot,
          );

        expect(
          result.status,
        ).toBe(
          "INCOMPLETE",
        );

        if (result.status === "INCOMPLETE") {
          expect(
            result.missingFields,
          ).toEqual(
            expect.arrayContaining(
              ["dataset_version", "trace"],
            ),
          );
        }
      },
    );
  },
);

describe(
  "checkActualEmissionSnapshotCompleteness",
  () => {
    it(
      "reports COMPLETE for a fully-populated snapshot",
      () => {
        expect(
          checkActualEmissionSnapshotCompleteness(
            completeActualEmissionSnapshot(),
          ),
        ).toEqual(
          {
            status: "COMPLETE",
          },
        );
      },
    );

    it(
      "reports missing when there is no evidence attached",
      () => {
        const snapshot =
          completeActualEmissionSnapshot();

        snapshot.evidence_file_ids =
          [];

        const result =
          checkActualEmissionSnapshotCompleteness(
            snapshot,
          );

        expect(
          result.status,
        ).toBe(
          "INCOMPLETE",
        );

        if (result.status === "INCOMPLETE") {
          expect(
            result.missingFields,
          ).toContain(
            "evidence_file_ids",
          );
        }
      },
    );

    it(
      "reports missing when the verifier is an empty string",
      () => {
        const snapshot =
          completeActualEmissionSnapshot();

        snapshot.verification.verifier_user_id =
          "" as ActualEmissionSnapshot["verification"]["verifier_user_id"];

        const result =
          checkActualEmissionSnapshotCompleteness(
            snapshot,
          );

        expect(
          result.status,
        ).toBe(
          "INCOMPLETE",
        );

        if (result.status === "INCOMPLETE") {
          expect(
            result.missingFields,
          ).toContain(
            "verification.verifier_user_id",
          );
        }
      },
    );
  },
);

describe(
  "checkEmissionDataEvidenceCompleteness",
  () => {
    it(
      "reports COMPLETE when at least one evidence file is attached",
      () => {
        expect(
          checkEmissionDataEvidenceCompleteness(
            { evidence_file_ids: ["evidence-1"] } as Pick<EmissionData, "evidence_file_ids">,
          ),
        ).toEqual(
          {
            status: "COMPLETE",
          },
        );
      },
    );

    it(
      "reports INCOMPLETE with evidence_file_ids as the missing field when no evidence is attached",
      () => {
        const result =
          checkEmissionDataEvidenceCompleteness(
            { evidence_file_ids: [] } as Pick<EmissionData, "evidence_file_ids">,
          );

        expect(
          result,
        ).toEqual(
          {
            status: "INCOMPLETE",
            missingFields: ["evidence_file_ids"],
          },
        );
      },
    );

    it(
      "is a LIVE check re-derived from whatever evidence_file_ids currently holds -- not a one-time flag -- so calling it again after evidence is removed reports INCOMPLETE even though it previously reported COMPLETE",
      () => {
        const record: Pick<EmissionData, "evidence_file_ids"> =
          { evidence_file_ids: ["evidence-1"] };

        expect(
          checkEmissionDataEvidenceCompleteness(
            record,
          ).status,
        ).toBe(
          "COMPLETE",
        );

        record.evidence_file_ids =
          [];

        expect(
          checkEmissionDataEvidenceCompleteness(
            record,
          ).status,
        ).toBe(
          "INCOMPLETE",
        );
      },
    );
  },
);

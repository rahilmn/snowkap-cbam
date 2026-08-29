import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  ActualEmissionSnapshot,
  EmissionData,
} from "./types";

import {
  checkActualSnapshotStaleness,
} from "./check-actual-snapshot-staleness";

function snapshot(
  overrides: Partial<ActualEmissionSnapshot> = {},
): ActualEmissionSnapshot {
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
      verifier_user_id: "admin-1" as ActualEmissionSnapshot["verification"]["verifier_user_id"],
    },

    evidence_file_ids: ["evidence-1"],
    sharing_grant_id: null,

    ...overrides,
  };
}

function activeEmissionData(
  overrides: Partial<EmissionData> = {},
): EmissionData {
  return {
    id: "emission-data-1" as EmissionData["id"],
    installation_id: "installation-1" as EmissionData["installation_id"],
    entered_by_org_id: "org-1" as EmissionData["entered_by_org_id"],
    cn_scope: ["72081000"],
    period: { kind: "ANNUAL", year: 2026 },
    direct_specific: "1.5" as EmissionData["direct_specific"],
    indirect_specific: "0.2" as EmissionData["indirect_specific"],
    emission_unit: "tCO2e/t",
    methodology: "EU_METHOD",
    verification_status: "VERIFIED",
    verifier_user_id: "admin-1" as EmissionData["verifier_user_id"],
    rejection_reason: null,
    evidence_file_ids: ["evidence-1"],
    version: 1,
    predecessor_id: null,
    status: "ACTIVE",
    created_at: "2026-01-01T00:00:00.000Z" as EmissionData["created_at"],
    updated_at: "2026-01-01T00:00:00.000Z" as EmissionData["updated_at"],

    ...overrides,
  };
}

describe(
  "checkActualSnapshotStaleness",
  () => {
    it(
      "is CURRENT when the current ACTIVE row is the exact same id and version the snapshot froze",
      () => {
        expect(
          checkActualSnapshotStaleness(
            snapshot(),
            activeEmissionData(),
          ),
        ).toBe(
          "CURRENT",
        );
      },
    );

    it(
      "is STALE when the current ACTIVE row for the same installation has a higher version than the snapshot froze",
      () => {
        expect(
          checkActualSnapshotStaleness(
            snapshot({ emission_data_version: 1 }),
            activeEmissionData({ id: "emission-data-2" as EmissionData["id"], version: 2, predecessor_id: "emission-data-1" as EmissionData["predecessor_id"] }),
          ),
        ).toBe(
          "STALE",
        );
      },
    );

    it(
      "is CURRENT when no ACTIVE emission_data row exists at all for the snapshot's installation+period -- nothing newer to point to",
      () => {
        expect(
          checkActualSnapshotStaleness(
            snapshot(),
            null,
          ),
        ).toBe(
          "CURRENT",
        );
      },
    );

    it(
      "is CURRENT (defensively) when the current row's installation_id somehow doesn't match the snapshot's -- not a comparable successor",
      () => {
        expect(
          checkActualSnapshotStaleness(
            snapshot({ installation_id: "installation-1" as ActualEmissionSnapshot["installation_id"] }),
            activeEmissionData({ installation_id: "installation-2" as EmissionData["installation_id"] }),
          ),
        ).toBe(
          "CURRENT",
        );
      },
    );

    it(
      "is CURRENT when the current row's version is lower than the snapshot's (defensive -- versions are monotonic per installation+period lineage so this should not happen in practice)",
      () => {
        expect(
          checkActualSnapshotStaleness(
            snapshot({ emission_data_version: 3 }),
            activeEmissionData({ version: 2 }),
          ),
        ).toBe(
          "CURRENT",
        );
      },
    );
  },
);

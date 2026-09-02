import {
  describe,
  expect,
  it,
} from "vitest";

import {
  actualDeterminationIsUnchanged,
  type CandidateActualDetermination,
} from "./actual-determination-is-unchanged";

import type {
  ActualEmissionSnapshot,
  EmissionDetermination,
} from "./types";

const CANDIDATE: CandidateActualDetermination =
  {
    emission_data_id: "ed-1" as never,
    emission_data_version: 2,
    installation_id: "inst-1" as never,
    direct_specific: "0.155" as never,
    indirect_specific: "0.045" as never,
    emission_unit: "tCO2e/t",
    methodology: "EU_METHOD",
    verifier_user_id: "user-verifier" as never,
    evidence_file_ids: ["file-a", "file-b"],
    sharing_grant_id: "grant-1" as never,
  };

function snapshotFrom(
  overrides: Partial<ActualEmissionSnapshot> = {},
): ActualEmissionSnapshot {
  return {
    emission_data_id: CANDIDATE.emission_data_id,
    emission_data_version: CANDIDATE.emission_data_version,
    installation_id: CANDIDATE.installation_id,
    resolved_at: "2026-09-01T10:00:00.000Z" as never,

    values: {
      direct_specific: CANDIDATE.direct_specific,
      indirect_specific: CANDIDATE.indirect_specific,
    },

    emission_unit: CANDIDATE.emission_unit,
    methodology: CANDIDATE.methodology,

    verification: {
      status: "VERIFIED",
      verifier_user_id: CANDIDATE.verifier_user_id,
    },

    evidence_file_ids: [...CANDIDATE.evidence_file_ids],
    sharing_grant_id: CANDIDATE.sharing_grant_id,

    ...overrides,
  };
}

function actual(
  overrides: Partial<ActualEmissionSnapshot> = {},
): EmissionDetermination {
  return {
    method: "ACTUAL",
    snapshot: snapshotFrom(overrides),
  };
}

describe(
  "actualDeterminationIsUnchanged",
  () => {
    it(
      "is true when every frozen fact matches, differing only in resolved_at",
      () => {
        expect(
          actualDeterminationIsUnchanged(
            actual(
              { resolved_at: "2020-01-01T00:00:00.000Z" as never },
            ),
            CANDIDATE,
          ),
        ).toBe(true);
      },
    );

    it(
      "is true when the evidence sets hold the same ids in a different order",
      () => {
        // The v10 validator compares evidence with
        // array_agg(x order by x), so order carries no meaning. If this
        // predicate disagreed, a reordered array would trigger a
        // pointless redetermination that changes nothing.
        expect(
          actualDeterminationIsUnchanged(
            actual(
              { evidence_file_ids: ["file-b", "file-a"] },
            ),
            CANDIDATE,
          ),
        ).toBe(true);
      },
    );

    it(
      "is false when the line has no determination yet",
      () => {
        expect(
          actualDeterminationIsUnchanged(
            null,
            CANDIDATE,
          ),
        ).toBe(false);
      },
    );

    it(
      "is false when the line currently carries a DEFAULT determination",
      () => {
        expect(
          actualDeterminationIsUnchanged(
            {
              method: "DEFAULT",
              resolution: {} as never,
            },
            CANDIDATE,
          ),
        ).toBe(false);
      },
    );

    it(
      "is false when a different dataset is being offered",
      () => {
        expect(
          actualDeterminationIsUnchanged(
            actual(
              { emission_data_id: "ed-2" as never },
            ),
            CANDIDATE,
          ),
        ).toBe(false);
      },
    );

    it(
      "is false when evidence has been attached since the snapshot was frozen",
      () => {
        // The load-bearing case. uploadEvidenceFile never checks
        // verification status and the fact-immutability trigger omits
        // evidence_file_ids, so an ACTIVE + VERIFIED record can gain a
        // file after a determination froze its list -- while the v10
        // validator compares the frozen set byte-for-byte against the
        // live one. The snapshot has drifted into a state the database
        // would now reject, and redetermination is the only repair. A
        // guard keyed on id + version would refuse to perform it.
        expect(
          actualDeterminationIsUnchanged(
            actual(
              { evidence_file_ids: ["file-a"] },
            ),
            CANDIDATE,
          ),
        ).toBe(false);
      },
    );

    it(
      "is false when evidence has been removed since the snapshot was frozen",
      () => {
        expect(
          actualDeterminationIsUnchanged(
            actual(
              {
                evidence_file_ids: ["file-a", "file-b", "file-c"],
              },
            ),
            CANDIDATE,
          ),
        ).toBe(false);
      },
    );

    it(
      "is false when the same record is now read through a different sharing grant",
      () => {
        // Grant A revoked, grant B issued for the same installation.
        // The values are identical but the PROVENANCE of the read is
        // not, and record_shared_data_consumption must fire under grant
        // B so the grantor's own audit stream records the read.
        // Suppressing this redetermination would suppress that event on
        // the party with the least visibility.
        expect(
          actualDeterminationIsUnchanged(
            actual(
              { sharing_grant_id: "grant-0" as never },
            ),
            CANDIDATE,
          ),
        ).toBe(false);
      },
    );

    it(
      "is false when a previously shared record is now read as the org's own data",
      () => {
        expect(
          actualDeterminationIsUnchanged(
            actual(
              { sharing_grant_id: "grant-1" as never },
            ),
            {
              ...CANDIDATE,
              sharing_grant_id: null,
            },
          ),
        ).toBe(false);
      },
    );

    it(
      "is false when the verifier differs, even with identical values",
      () => {
        expect(
          actualDeterminationIsUnchanged(
            actual(
              {
                verification: {
                  status: "VERIFIED",
                  verifier_user_id: "user-someone-else" as never,
                },
              },
            ),
            CANDIDATE,
          ),
        ).toBe(false);
      },
    );

    it.each(
      [
        [
          "direct_specific",
          { values: { direct_specific: "0.156" as never, indirect_specific: "0.045" as never } },
        ],
        [
          "indirect_specific",
          { values: { direct_specific: "0.155" as never, indirect_specific: "0.046" as never } },
        ],
        [
          "emission_unit",
          { emission_unit: "TCO2E_PER_TONNE" },
        ],
        [
          "methodology",
          { methodology: "OTHER" as never },
        ],
        [
          "installation_id",
          { installation_id: "inst-2" as never },
        ],
        [
          "emission_data_version",
          { emission_data_version: 3 },
        ],
      ] as const,
    )(
      "is false when %s differs",
      (_field, overrides) => {
        expect(
          actualDeterminationIsUnchanged(
            actual(
              overrides as Partial<ActualEmissionSnapshot>,
            ),
            CANDIDATE,
          ),
        ).toBe(false);
      },
    );

    it(
      "does not treat a value that merely compares equal numerically as unchanged",
      () => {
        // DecimalStrings are compared as strings, byte-for-byte, the
        // same contract reproduceCalculationResult uses (===, not a
        // Decimal comparison). "0.1550" and "0.155" are the same number
        // and different frozen facts.
        expect(
          actualDeterminationIsUnchanged(
            actual(
              {
                values: {
                  direct_specific: "0.1550" as never,
                  indirect_specific: "0.045" as never,
                },
              },
            ),
            CANDIDATE,
          ),
        ).toBe(false);
      },
    );
  },
);

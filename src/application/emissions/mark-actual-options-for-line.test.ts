import {
  describe,
  expect,
  it,
} from "vitest";

import {
  markActualOptionsForLine,
} from "./mark-actual-options-for-line";

import type {
  AvailableActualEmissionDataListing,
  AvailableActualEmissionDataOption,
} from "./list-available-actual-data";

import type {
  CandidateActualDetermination,
} from "../../domain/emissions/actual-determination-is-unchanged";

import type {
  EmissionDetermination,
} from "../../domain/emissions/types";

const OPTION: AvailableActualEmissionDataOption =
  {
    emission_data_id: "ed-1" as never,
    installation_id: "inst-1" as never,
    installation_name: "Steel Works A",
    installation_country: "DE" as never,
    direct_specific: "1.5" as never,
    indirect_specific: "0.2" as never,
    emission_unit: "tCO2e/t",
    methodology: "EU_METHOD",
    reporting_period: { kind: "ANNUAL", year: 2026 } as never,
    provenance: "SHARED",
    grantor_organization_name: "Producer Ltd",
    record_provenance: "OPERATOR_PROVIDED",
  };

const CANDIDATE: CandidateActualDetermination =
  {
    emission_data_id: "ed-1" as never,
    emission_data_version: 1,
    installation_id: "inst-1" as never,
    direct_specific: "1.5" as never,
    indirect_specific: "0.2" as never,
    emission_unit: "tCO2e/t",
    methodology: "EU_METHOD",
    verifier_user_id: "verifier-1" as never,
    evidence_file_ids: ["evidence-1"],
    sharing_grant_id: "grant-1" as never,
  };

const MATCHING_DETERMINATION: EmissionDetermination =
  {
    method: "ACTUAL",
    snapshot: {
      emission_data_id: "ed-1" as never,
      emission_data_version: 1,
      installation_id: "inst-1" as never,
      resolved_at: "2026-02-01T00:00:00.000Z" as never,
      values: {
        direct_specific: "1.5" as never,
        indirect_specific: "0.2" as never,
      },
      emission_unit: "tCO2e/t",
      methodology: "EU_METHOD",
      verification: {
        status: "VERIFIED",
        verifier_user_id: "verifier-1" as never,
      },
      evidence_file_ids: ["evidence-1"],
      sharing_grant_id: "grant-1" as never,
    },
  };

function listing(
  candidate: CandidateActualDetermination | null = CANDIDATE,
): AvailableActualEmissionDataListing {
  return {
    options: [OPTION],
    candidatesById:
      candidate === null
        ? new Map()
        : new Map([[OPTION.emission_data_id as string, candidate]]),
  };
}

describe(
  "markActualOptionsForLine",
  () => {
    it(
      "marks the option the line is already determined from",
      () => {
        const marked =
          markActualOptionsForLine(
            listing(),
            MATCHING_DETERMINATION,
          );

        expect(marked[0]?.matches_current_determination).toBe(
          true,
        );
      },
    );

    it(
      "leaves every public field of the option untouched",
      () => {
        // The flag is additive. Nothing about what the dataset IS may
        // change because of which line is looking at it.
        const [marked] =
          markActualOptionsForLine(
            listing(),
            MATCHING_DETERMINATION,
          );

        const {
          matches_current_determination: _flag,
          ...rest
        } = marked!;

        expect(rest).toEqual(
          OPTION,
        );
      },
    );

    it(
      "never carries the verifier's user id to the caller",
      () => {
        // For a SHARED row the verifier is a member of ANOTHER
        // organization. The comparison needs their id; the client must
        // not receive it.
        const [marked] =
          markActualOptionsForLine(
            listing(),
            MATCHING_DETERMINATION,
          );

        expect(
          JSON.stringify(marked),
        ).not.toContain(
          "verifier-1",
        );
      },
    );

    it(
      "does not mark an option when the line carries no determination",
      () => {
        const marked =
          markActualOptionsForLine(
            listing(),
            null,
          );

        expect(marked[0]?.matches_current_determination).toBe(
          false,
        );
      },
    );

    it(
      "does not mark an option whose evidence set has changed since the snapshot",
      () => {
        const marked =
          markActualOptionsForLine(
            listing(
              {
                ...CANDIDATE,
                evidence_file_ids: ["evidence-1", "evidence-2"],
              },
            ),
            MATCHING_DETERMINATION,
          );

        expect(marked[0]?.matches_current_determination).toBe(
          false,
        );
      },
    );

    it(
      "does not mark an option now read through a re-issued grant",
      () => {
        const marked =
          markActualOptionsForLine(
            listing(
              {
                ...CANDIDATE,
                sharing_grant_id: "grant-2" as never,
              },
            ),
            MATCHING_DETERMINATION,
          );

        expect(marked[0]?.matches_current_determination).toBe(
          false,
        );
      },
    );

    it(
      "does not mark an option with no candidate at all",
      () => {
        // No candidate means the record is VERIFIED with no recorded
        // verifier -- which the write path refuses as a data-integrity
        // failure. Reporting that as a harmless no-op would tell the
        // user the wrong thing about a more serious problem.
        const marked =
          markActualOptionsForLine(
            listing(null),
            MATCHING_DETERMINATION,
          );

        expect(marked[0]?.matches_current_determination).toBe(
          false,
        );
      },
    );
  },
);

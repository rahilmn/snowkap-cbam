import {
  actualDeterminationIsUnchanged,
} from "../../domain/emissions/actual-determination-is-unchanged";

import type {
  EmissionDetermination,
} from "../../domain/emissions/types";

import type {
  AvailableActualEmissionDataListing,
  AvailableActualEmissionDataOption,
} from "./list-available-actual-data";

/**
 * One selectable dataset, as it relates to ONE line.
 *
 * The underlying option list is fetched per distinct CN code and fanned
 * out to every line declaring that code, so it is not line-relative and
 * cannot carry a line-relative fact. This type is the fanned-out form:
 * the same option, plus the one thing that depends on which line is
 * asking.
 */
export interface ActualEmissionDataOptionForLine
  extends AvailableActualEmissionDataOption {
  /**
   * True when determining this line from this dataset would freeze a
   * snapshot materially identical to the one it already carries -- so
   * the write would produce a new audit event, a new cross-org
   * consumption record on the producer's stream, and a recalculation
   * obligation, for no change at all.
   *
   * The UI uses it to disable the action and say so. The server refuses
   * independently (ALREADY_DETERMINED_FROM_THIS_DATASET); this flag
   * exists so the two cannot disagree, which is exactly what a
   * client-side comparison over the public option fields would do -- it
   * can see neither the evidence set, nor the verifier, nor the grant.
   */
  matches_current_determination: boolean;
}

/**
 * Fans a CN-code-scoped listing out to one line, marking the option (if
 * any) that would change nothing.
 *
 * Runs on the server, from the listing's private candidate facts, so
 * the verifier's user id -- which for a SHARED row belongs to a member
 * of another organization -- is never sent to the client. Only the
 * boolean crosses.
 *
 * An option with no candidate is never marked. That happens when the
 * source record is VERIFIED but carries no verifier, which the write
 * path treats as a data-integrity failure and refuses outright;
 * reporting it as a harmless no-op would be the wrong message about a
 * more serious problem.
 */
export function markActualOptionsForLine(
  listing: AvailableActualEmissionDataListing,
  currentDetermination: EmissionDetermination | null,
): ActualEmissionDataOptionForLine[] {
  return listing.options.map(
    (option) => {
      const candidate =
        listing.candidatesById.get(
          option.emission_data_id,
        );

      return {
        ...option,
        matches_current_determination:
          candidate === undefined
            ? false
            : actualDeterminationIsUnchanged(
                currentDetermination,
                candidate,
              ),
      };
    },
  );
}

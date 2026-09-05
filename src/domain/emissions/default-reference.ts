import {
  ANNEX_II_SECTORS,
} from "../calculations/calculate-line-emissions";

import type {
  RegulatoryRecord,
  RegulatoryValue,
} from "../regulatory/types";

/**
 * S3 (importer experience), v2.1.1 "default reference display" (§9).
 *
 * DISPLAY ONLY. This is never an arithmetic comparator and never a
 * second calculation engine -- it does not sum, subtract, or otherwise
 * derive a new number from the resolver's own values; it only decides
 * WHETHER those values are internally consistent enough with the
 * sector's own treatment rule to be worth showing at all, and returns
 * them completely verbatim (never recomputed) when they are.
 *
 * Two treatment shapes, per the spec:
 *   - Annex-II proxy sector (the SAME ANNEX_II_SECTORS the calculation
 *     engine itself gates on -- reused, not redefined, so this display
 *     can never disagree with what RULE-EE-004 actually did): direct-
 *     only. AVAILABLE requires total AVAILABLE, direct AVAILABLE,
 *     total.value === direct.value (the total IS the direct figure --
 *     nothing else was added), and indirect UNAVAILABLE or
 *     NOT_APPLICABLE (never itself a real value, which would
 *     contradict "direct-only").
 *   - Non-proxy: direct, indirect, and total must all be AVAILABLE.
 *
 * Any other shape -- a status that doesn't match, or a proxy record
 * whose total doesn't equal its own direct figure -- fails treatment
 * consistency, and the spec is explicit about the failure direction:
 * show the reference as unavailable, never a partial or
 * best-effort figure.
 */
export type DefaultReferenceDisplay =
  | {
      status: "AVAILABLE";
      direct: RegulatoryValue;
      indirect: RegulatoryValue;
      total: RegulatoryValue;
    }
  | { status: "UNAVAILABLE" };

export function describeDefaultReference(
  record: RegulatoryRecord,
  sector: string,
): DefaultReferenceDisplay {
  const {
    direct_emissions: direct,
    indirect_emissions: indirect,
    total_emissions: total,
  } = record;

  const isAnnexIiProxy =
    ANNEX_II_SECTORS.has(
      sector,
    );

  if (isAnnexIiProxy) {
    const consistent =
      direct.status === "AVAILABLE" &&
      total.status === "AVAILABLE" &&
      total.value === direct.value &&
      (indirect.status === "UNAVAILABLE" || indirect.status === "NOT_APPLICABLE");

    if (!consistent) {
      return {
        status: "UNAVAILABLE",
      };
    }

    return {
      status: "AVAILABLE",
      direct,
      indirect,
      total,
    };
  }

  const consistent =
    direct.status === "AVAILABLE" &&
    indirect.status === "AVAILABLE" &&
    total.status === "AVAILABLE";

  if (!consistent) {
    return {
      status: "UNAVAILABLE",
    };
  }

  return {
    status: "AVAILABLE",
    direct,
    indirect,
    total,
  };
}

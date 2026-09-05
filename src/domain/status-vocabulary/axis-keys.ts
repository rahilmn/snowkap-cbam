import type {
  ShipmentStatus,
} from "../shipments/types";

import type {
  DeclarationStatus,
  CompletenessBlockerReason,
} from "../declarations/types";

import type {
  EmissionDataRecordStatus,
  EmissionDataMethodology,
} from "../emissions/types";

import type {
  CalculationStatus,
} from "../calculations/types";

import type {
  SharingGrantStatus,
} from "../sharing/types";

import type {
  MembershipRole,
} from "../organizations/types";

import type {
  ResolutionReason,
  ValueStatus,
} from "../regulatory/types";

import type {
  ShipmentStatusKey,
  DeclarationStatusKey,
  EmissionRecordStatusKey,
  SharingGrantStatusKey,
  ResolutionReasonKey,
  ValueStatusKey,
  CalculationStatusKey,
  BlockerReasonKey,
  MethodologyKey,
  RoleKey,
  IncompleteLineReasonKey,
} from "./types";

/**
 * One tiny, named function per axis (matching reviewBadgeFor's own
 * shape in review-badges.ts) rather than a bare `as` cast at every
 * call site -- each is trivial today (axis-prefix the raw value), but
 * having one place per axis is what let this module fix
 * `incompleteLineReasonKey` to hand-map explicitly (see its own
 * comment) without every call site needing to know that axis is
 * different from the other nine.
 */
export function shipmentStatusKey(
  status: ShipmentStatus,
): ShipmentStatusKey {
  return `shipment.${status}`;
}

export function declarationStatusKey(
  status: DeclarationStatus,
): DeclarationStatusKey {
  return `declaration.${status}`;
}

export function emissionRecordStatusKey(
  status: EmissionDataRecordStatus,
): EmissionRecordStatusKey {
  return `emission_record.${status}`;
}

export function sharingGrantStatusKey(
  status: SharingGrantStatus,
): SharingGrantStatusKey {
  return `sharing_grant.${status}`;
}

export function resolutionReasonKey(
  reason: ResolutionReason,
): ResolutionReasonKey {
  return `resolution.${reason}`;
}

export function valueStatusKey(
  status: ValueStatus,
): ValueStatusKey {
  return `value.${status}`;
}

export function calculationStatusKey(
  status: CalculationStatus,
): CalculationStatusKey {
  return `calculation.${status}`;
}

export function blockerReasonKey(
  reason: CompletenessBlockerReason,
): BlockerReasonKey {
  return `blocker.${reason}`;
}

export function methodologyKey(
  methodology: EmissionDataMethodology,
): MethodologyKey {
  return `methodology.${methodology}`;
}

export function roleKey(
  role: MembershipRole,
): RoleKey {
  return `role.${role}`;
}

/**
 * The one axis handled by explicit mapping rather than axis-prefixing
 * (see types.ts's own comment on IncompleteLineReasonKey for why: the
 * source type lives in the application layer, outside what this
 * domain module may import). Written as an exhaustive switch, not a
 * template-literal cast, so a new IncompleteLineReason member fails
 * this function's own type-check (`never` in the default case) rather
 * than silently compiling into a stringly-typed key nothing verifies.
 */
export function incompleteLineReasonKey(
  reason: "NO_DETERMINATION" | "NOT_CALCULATED" | "CALCULATION_STALE",
): IncompleteLineReasonKey {
  switch (reason) {
    case "NO_DETERMINATION":
      return "incomplete_line.NO_DETERMINATION";

    case "NOT_CALCULATED":
      return "incomplete_line.NOT_CALCULATED";

    case "CALCULATION_STALE":
      return "incomplete_line.CALCULATION_STALE";

    default: {
      const exhaustive: never =
        reason;

      throw new Error(
        `Unhandled IncompleteLineReason: ${exhaustive}`,
      );
    }
  }
}

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

// Protected regulatory zone (ADR-0005) -- read-only TYPE import only,
// exactly the same thing components/ui/regulatory-status-badge.tsx
// already did. Nothing in src/domain/regulatory/** is written to or
// re-exported from here.
import type {
  ResolutionReason,
  ValueStatus,
} from "../regulatory/types";

/**
 * The product's status/provenance vocabulary -- the discriminated set
 * of short keys every StatusBadge and review label renders through,
 * instead of a raw domain enum value or ad hoc prose (Snowkap CBAM SME
 * Experience v2.1.1 §3 Correction B; v2 §9.2/§9.6).
 *
 * Every axis below (except IncompleteLineReasonKey, see its own
 * comment) is a TEMPLATE LITERAL TYPE built directly from the real
 * domain union it labels -- `shipment.${ShipmentStatus}`, not a
 * separately hand-maintained list of the same four strings. This is
 * deliberate: STATUS_LABEL/STATUS_TONE (labels.ts) are typed
 * `Record<StatusKey, string>`, so TypeScript itself refuses to compile
 * this module if a domain union gains a member and the label map
 * isn't updated to match -- exhaustiveness enforced by the type
 * system, not by a test remembering to check. This is exactly the
 * kind of drift that produced two real bugs found while building this
 * (declaration-actions.tsx's BLOCKER_LABEL missing
 * LINE_CALCULATION_STALE, and reports/page.tsx silently mislabeling
 * CALCULATION_STALE as "Not calculated") -- both fixed alongside this
 * module for exactly that reason.
 */
export type ReviewStatusKey =
  | "review.UNREVIEWED"
  | "review.PENDING"
  | "review.OPERATOR_INTERNAL"
  | "review.IMPORTER_TRANSCRIPTION"
  | "review.REJECTED";

export type ShipmentStatusKey =
  `shipment.${ShipmentStatus}`;

export type DeclarationStatusKey =
  `declaration.${DeclarationStatus}`;

export type EmissionRecordStatusKey =
  `emission_record.${EmissionDataRecordStatus}`;

export type SharingGrantStatusKey =
  `sharing_grant.${SharingGrantStatus}`;

export type ResolutionReasonKey =
  `resolution.${ResolutionReason}`;

export type ValueStatusKey =
  `value.${ValueStatus}`;

export type CalculationStatusKey =
  `calculation.${CalculationStatus}`;

export type BlockerReasonKey =
  `blocker.${CompletenessBlockerReason}`;

export type MethodologyKey =
  `methodology.${EmissionDataMethodology}`;

export type RoleKey =
  `role.${MembershipRole}`;

/**
 * The one axis NOT built as a template literal type off its own
 * domain union: IncompleteLineReason lives in
 * src/application/reporting/build-period-summary.ts (application
 * layer), and src/domain/** may depend on nothing outside itself
 * (CLAUDE.md's layering rule; this module lives in src/domain/ and
 * the layering test enforces this for real). The three literal values
 * are therefore restated here directly, matching the application
 * type's own three members exactly -- there is no template-literal
 * shortcut available across that layer boundary, so this axis is the
 * one place a future new IncompleteLineReason member would NOT be
 * caught automatically by the type system; a review of that type is
 * the fallback for keeping the two in sync.
 */
export type IncompleteLineReasonKey =
  | "incomplete_line.NO_DETERMINATION"
  | "incomplete_line.NOT_CALCULATED"
  | "incomplete_line.CALCULATION_STALE";

export type StatusKey =
  | ReviewStatusKey
  | ShipmentStatusKey
  | DeclarationStatusKey
  | EmissionRecordStatusKey
  | SharingGrantStatusKey
  | ResolutionReasonKey
  | ValueStatusKey
  | CalculationStatusKey
  | BlockerReasonKey
  | MethodologyKey
  | RoleKey
  | IncompleteLineReasonKey;

import type {
  DeclarationContextId,
  EmissionDataId,
  PrecursorId,
} from "../shared/ids";

import type {
  DecimalString,
} from "../shared/decimal";

import type {
  IsoTimestamp,
} from "../shared/reporting-period";

/**
 * S4 (producer/trust/sharing), v2.1.1 §12. Kept distinct from
 * ACTUAL_NO_DECLARED_REPORT and UNKNOWN so an absent figure is never
 * confused with a declared-and-reported one -- see
 * emission_data_precursors' own migration comment
 * (20260906180000_s4_declaration_context_and_precursors.sql).
 *
 * ACTUAL_WITH_DECLARED_REPORT: the operator provides this precursor's
 * own direct/indirect_specific figures AND declares a verifier report
 * exists for them -- a DECLARATION, never a claim Snowkap validated
 * anything (see verifier_report_description and
 * src/domain/status-vocabulary/verification-phrases.ts for the exact
 * allowed UI wording).
 *
 * ACTUAL_NO_DECLARED_REPORT: figures provided, no report claimed.
 *
 * UNKNOWN: the operator does not have this precursor's own figures.
 * Never invented -- see this file's own header comment on why this is
 * a complete, honest answer.
 */
export type PrecursorProvenance =
  | "ACTUAL_WITH_DECLARED_REPORT"
  | "ACTUAL_NO_DECLARED_REPORT"
  | "UNKNOWN";

/**
 * One CBAM-covered precursor material an operator identifies for one
 * emission_data record -- v2.1.1 §12's "Do you use CBAM-covered
 * material purchased from another producer?" question, answered per
 * material rather than as a single yes/no (the gate itself lives on
 * EmissionDataDeclarationContext.uses_purchased_precursors).
 */
export interface EmissionDataPrecursor {
  id: PrecursorId;
  emission_data_id: EmissionDataId;

  material_description: string;
  cn_code: string | null;
  source_description: string | null;

  direct_specific: DecimalString | null;
  indirect_specific: DecimalString | null;
  emission_unit: string | null;

  provenance: PrecursorProvenance;

  // Only meaningful (and only ever non-null) when
  // provenance === "ACTUAL_WITH_DECLARED_REPORT" -- enforced in the
  // database by emission_data_precursors_check.
  verifier_report_description: string | null;

  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/**
 * A frozen copy of one precursor row, for embedding inside
 * ActualEmissionSnapshot -- deliberately without `id`/`emission_data_id`/
 * timestamps (those identify the LIVE row this was copied from, which
 * the snapshot already identifies via its own emission_data_id/
 * emission_data_version) or `created_at`/`updated_at` (the snapshot has
 * its own `resolved_at`). Same shape as EmissionDataPrecursor minus
 * those four fields.
 */
export interface FrozenPrecursor {
  material_description: string;
  cn_code: string | null;
  source_description: string | null;
  direct_specific: DecimalString | null;
  indirect_specific: DecimalString | null;
  emission_unit: string | null;
  provenance: PrecursorProvenance;
  verifier_report_description: string | null;
}

/**
 * A frozen copy of a declaration context, for embedding inside
 * ActualEmissionSnapshot -- same reasoning as FrozenPrecursor above.
 */
export interface FrozenDeclarationContext {
  production_process_description: string | null;
  uses_purchased_precursors: boolean;
  verifier_report_declared: boolean;
  verifier_report_description: string | null;
}

/**
 * The producer's declared context for one emission_data record --
 * v2.1.1 §9's "dossier" experience. 1:1 with emission_data (a unique
 * constraint on emission_data_id enforces this at the database layer).
 *
 * verifier_report_declared/verifier_report_description are the
 * operator's own DECLARATION that a verifier report exists for this
 * emission_data row's own direct/indirect_specific figures -- never a
 * claim that Snowkap performed, validated, or independently confirmed
 * any verification. See
 * src/domain/status-vocabulary/verification-phrases.ts for the exact
 * allowed UI wording this backs.
 */
export interface EmissionDataDeclarationContext {
  id: DeclarationContextId;
  emission_data_id: EmissionDataId;

  production_process_description: string | null;
  uses_purchased_precursors: boolean;

  verifier_report_declared: boolean;

  // Only meaningful (and only ever non-null) when
  // verifier_report_declared === true -- enforced in the database by
  // emission_data_declaration_context_check.
  verifier_report_description: string | null;

  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

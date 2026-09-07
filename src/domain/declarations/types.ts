import type {
  DeclarationId,
  OrganizationId,
  ShipmentId,
  ShipmentLineId,
  UserId,
} from "../shared/ids";

import type {
  IsoTimestamp,
  ReportingPeriod,
} from "../shared/reporting-period";

import type {
  ShipmentStatus,
} from "../shipments/types";

export type DeclarationStatus =
  | "DRAFT"
  | "READY"
  | "FILED_RECORDED"
  | "VOID";

/**
 * The TypeScript-side view of one `public.declarations` row
 * (20260829330000_p9_declarations_schema.sql) -- master plan §6's
 * CBAMDeclaration: "annual reporting_period, member shipments,
 * completeness report, DRAFT -> READY -> FILED_RECORDED, filed
 * snapshot, amendments as versions." No `src/domain/declarations`
 * module existed before this file (that migration's own header comment
 * records why the schema landed first); this is that module's first
 * shape, deliberately thin -- everything the schema itself already
 * enforces (period uniqueness, the filed-facts pairing, the
 * DRAFT-only-mutable freeze) is not re-modeled here as a second source
 * of truth.
 */
export interface Declaration {
  id: DeclarationId;
  org_id: OrganizationId;
  reporting_period: ReportingPeriod;
  status: DeclarationStatus;

  // Frozen once the row leaves DRAFT (app.prevent_declaration_fact_change(),
  // same migration) -- a READY/FILED_RECORDED/VOID declaration's
  // member_shipment_ids is exactly what it was judged complete against,
  // never a live-recomputed set.
  member_shipment_ids: ShipmentId[];
  completeness_report: CompletenessReport | null;

  // Opaque from this module's own perspective: the ENTIRE filed_snapshot
  // payload is built inside public.record_declaration_filed() (same
  // migration, section 4) in one SQL statement, from a FRESH aggregation
  // at filing time -- never constructed, recomputed, or validated by
  // TypeScript. Declared as a loose record rather than a typed
  // FiledSnapshot interface deliberately: re-typing SQL-authored jsonb
  // here would invite this module to start trusting a shape it never
  // produces, and the one actual reader of it (the declaration detail
  // screen) reads specific keys defensively rather than assuming the
  // whole shape round-trips.
  filed_snapshot: Record<string, unknown> | null;

  // Verbatim declarant-typed filing reference -- never generated,
  // parsed, reformatted, or defaulted by this codebase (see the
  // migration's own REGULATORY HONESTY header block and master plan
  // §22: Snowkap records a filing it did not perform).
  filed_reference: string | null;
  filed_at: IsoTimestamp | null;

  // Null for an original; the immediately-preceding version for an
  // amendment ("amendments as versions", §6).
  supersedes_declaration_id: DeclarationId | null;

  created_by_user_id: UserId;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/**
 * Every named reason a shipment or line keeps a declaration's period
 * from being complete. Deliberately reuses the same vocabulary as
 * public.record_declaration_filed()'s own result_status values
 * (NO_MEMBER_SHIPMENTS, SHIPMENTS_NOT_LOCKABLE, INCOMPLETE --
 * 20260829330000, section 4) wherever the two overlap: this report is
 * the DRAFT-time preview of exactly what that RPC will refuse at filing
 * time if ignored, so a reader who has seen one should recognize the
 * other, not learn two names for the same fact. See
 * src/domain/declarations/completeness.ts for the pure function that
 * builds this.
 */
export type CompletenessBlockerReason =
  | "NO_SHIPMENTS_IN_PERIOD"
  | "SHIPMENT_NOT_LOCKABLE"
  | "SHIPMENT_HAS_NO_LINES"
  | "LINE_NOT_DETERMINED"
  | "LINE_NOT_CALCULATED"
  // 2026-08-29 (P13 adversarial audit, live-reproduced): a line can have
  // has_calculation_result: true and STILL not be genuinely ready --
  // shipment_lines stays fully writable while its parent is READY, so
  // "Re-determine emissions" (the exact workflow emissions-cell.tsx's
  // own "Stale -- newer data available" badge prompts an importer into)
  // can update the line's emission_determination without ever touching
  // the earlier calculation_results row calculated against the OLD one.
  // record_declaration_filed() (see the P13 migration fixing it) now
  // refuses this at filing time by folding it into the same INCOMPLETE
  // path a missing calculation already uses; this reason is the same
  // fact surfaced HERE, at DRAFT/READY completeness-check time, so a
  // user sees it before attempting to file rather than only as a
  // filing-time rejection. Named distinctly from LINE_NOT_CALCULATED
  // (never merged into it) because the two point to different fixes: a
  // line missing this reason needs its FIRST calculation, one carrying
  // this reason needs a RECALCULATION of a determination that already
  // changed. A line whose emission_determination itself is now null
  // (manage-lines.ts's updateShipmentLine clearing it on a quantity/
  // cn_code edit) is already caught by LINE_NOT_DETERMINED above --
  // this reason exists for the case that blocker cannot see: a
  // determination that is still present, but no longer the one the
  // line's latest calculation was computed against.
  | "LINE_CALCULATION_STALE"
  // 2026-09-07 (S5 review round 8, finding S5R8-A-B2, live-reproduced):
  // a line can be determined, calculated, AND current against its own
  // determination (calculation_is_current: true) while its latest
  // calculation_results row's frozen engine_version still names an
  // engine version the app no longer runs. record_declaration_filed()
  // has refused exactly this (CALCULATION_ENGINE_OUTDATED,
  // 20260904100000/P14 owner decision 2) since before this S5 phase
  // began -- but nothing in this completeness report previewed it: a
  // declaration reached "Complete -- approved for filing" and was only
  // refused, out of nowhere, at the "Record filed" click. Distinct from
  // LINE_CALCULATION_STALE (that reason is "the calc doesn't match the
  // CURRENT determination"; this one is "the calc matches the current
  // determination, but was produced by a SUPERSEDED engine version") --
  // same "different fix" reasoning that separates every other reason in
  // this union. Checked after LINE_CALCULATION_STALE and before
  // LINE_DATASET_SUPERSEDED, mirroring record_declaration_filed()'s own
  // check order (CALCULATION_ENGINE_OUTDATED, then DATASET_SUPERSEDED,
  // both only reached once the line is otherwise complete/current).
  | "LINE_CALCULATION_ENGINE_OUTDATED"
  // 2026-09-06 (S5 cross-phase hardening, live-reproduced): a
  // DEFAULT-determined line freezes resolution.dataset_id/dataset_
  // version at resolve/redetermine time (owner decision, RULE-EE-xxx
  // provenance) and is never automatically re-touched afterward --
  // redetermination is an explicit, manual, audited action. If the
  // regulatory_datasets row that determination was resolved against is
  // later SUPERSEDED (the sanctioned way a regulatory correction is
  // published -- a new dataset version activated, CLAUDE.md's own
  // "facts-as-datasets" rule), neither checkCalculationCurrency
  // (compares the determination against itself, never against live
  // regulatory state) nor LINE_CALCULATION_STALE (a different fact --
  // whether the calculation matches the CURRENT determination, not
  // whether the determination matches the CURRENT dataset) ever
  // notices. Live-reproduced: a declaration filed clean through
  // record_declaration_filed() while its own frozen determination
  // named an already-superseded dataset version, with zero signal
  // anywhere in the product. Distinct from LINE_CALCULATION_STALE for
  // the same reason that reason is distinct from LINE_NOT_CALCULATED:
  // different fix (redetermine against the corrected dataset, not
  // merely recalculate). Never applies to an ACTUAL determination (no
  // regulatory dataset is resolved for one) or to a line with no
  // determination yet (LINE_NOT_DETERMINED already covers that).
  | "LINE_DATASET_SUPERSEDED";

/**
 * One named blocker. `shipment_id`/`shipment_reference`/`shipment_status`
 * are null only for the period-level NO_SHIPMENTS_IN_PERIOD reason --
 * every other reason names the exact shipment (and, for the two
 * line-level reasons, the exact line) it blocks on. Never a bare
 * boolean: per this codebase's "never treat no value as value is zero"
 * posture (CLAUDE.md), a caller must always be able to say WHY a period
 * isn't ready, not just THAT it isn't.
 *
 * 2026-09-07 (S5 review round 13 remediation, findings S5R13-A-1/
 * S5R13-B-1/S5R13-D-1). `shipment_status` and `calculation_engine_is_
 * current` were added so every UI surface rendering a blocker (this
 * declaration's own completeness card, MarkReadyForm's inline blockers
 * list) can consult the ONE shared recovery-availability.ts helper
 * (recalculateAvailability/redetermineAvailability) directly off the
 * blocker itself, instead of independently re-deriving (and, per that
 * round's findings, getting wrong) a per-surface hedge from a coarse
 * aggregate like "is ANY member shipment LOCKED." Matches the pattern
 * build-period-summary.ts's own DatasetSupersededPeriodLine/
 * EngineOutdatedPeriodLine already established for the Reports page.
 * `calculation_engine_is_current` is populated only for
 * LINE_CALCULATION_STALE (the one reason recalculateAvailability needs
 * it for -- see that function's own doc comment on why READY-recalculate
 * availability depends on this, not on which blocker reason fired) and
 * is `undefined` for every other reason, where it has no meaning.
 */
export interface CompletenessBlocker {
  reason: CompletenessBlockerReason;
  shipment_id: ShipmentId | null;
  shipment_reference: string | null;
  shipment_status: ShipmentStatus | null;
  line_id?: ShipmentLineId;
  line_number?: number;
  calculation_engine_is_current?: boolean;
}

export interface CompletenessReport {
  generated_at: IsoTimestamp;
  shipment_count: number;
  line_count: number;
  complete: boolean;
  blockers: CompletenessBlocker[];
}

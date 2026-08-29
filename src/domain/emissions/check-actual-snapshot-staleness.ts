import type {
  ActualEmissionSnapshot,
  EmissionData,
} from "./types";

export type ActualSnapshotStaleness =
  | "STALE"
  | "CURRENT";

/**
 * Does a shipment line's frozen ACTUAL determination
 * (ActualEmissionSnapshot) still reflect the installation's current
 * published data, or has the producer since activated a newer version
 * for the same installation+period that supersedes the row the snapshot
 * was originally taken from?
 *
 * `currentEmissionData` is the emission_data row the CALLER already
 * looked up as the current ACTIVE row for the snapshot's own
 * (installation_id, reporting_period) -- emission_data_one_active_per_
 * installation_period_uq (20260829230000) guarantees at most one such
 * row exists globally, regardless of which org entered it or what its
 * cn_scope is (cn_scope is deliberately NOT part of that uniqueness key
 * -- see that migration's own header comment -- so there is nothing
 * further to disambiguate by scope once installation+period is fixed);
 * `null` means no row is currently ACTIVE at all for that installation
 * +period (e.g. superseded with nothing yet re-activated, or -- for a
 * cross-org SHARED snapshot -- the caller's org can no longer see any
 * row there because the sharing grant was revoked since the snapshot was
 * taken). This function never queries anything itself (src/domain/**
 * depends on nothing outside itself, per CLAUDE.md's layering rules) --
 * the lookup belongs to the application layer that calls it.
 *
 * STALE means "a genuinely newer ACTIVE version now exists" -- version
 * numbers are monotonically increasing per (installation_id,
 * reporting_period) lineage (recordEmissionData's own doc comment,
 * manage-emission-data.ts), so a strictly higher version on the current
 * row than the snapshot froze is unambiguous evidence a supersession
 * happened after this determination was made. Every other case --
 * nothing currently ACTIVE, the current row IS the exact one the
 * snapshot points to, or (defensively; should not happen given
 * monotonic versioning) a same-or-lower version -- reports CURRENT: this
 * function only ever surfaces a fact for the UI to display (per master
 * plan §18, re-determination itself is always an explicit, audited
 * importer action, never automatic), so it fails toward the quieter
 * result rather than raising a false alarm when the evidence is merely
 * absent or ambiguous.
 */
export function checkActualSnapshotStaleness(
  snapshot: ActualEmissionSnapshot,
  currentEmissionData: EmissionData | null,
): ActualSnapshotStaleness {
  if (currentEmissionData === null) {
    return "CURRENT";
  }

  if (currentEmissionData.installation_id !== snapshot.installation_id) {
    return "CURRENT";
  }

  return currentEmissionData.version > snapshot.emission_data_version
    ? "STALE"
    : "CURRENT";
}

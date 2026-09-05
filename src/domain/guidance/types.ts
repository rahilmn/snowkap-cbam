import type {
  OrganizationId,
} from "../shared/ids";

/**
 * The SME guidance engine's own vocabulary (Snowkap CBAM SME Experience
 * v2.1.1, S2). A GuidanceItem is derived fresh from authoritative
 * domain state on every read -- never persisted itself (only a
 * dismissal FINGERPRINT is persisted, see guidance_dismissals). "Do not
 * read audit events to determine guidance" and "do not persist
 * unresolved-reason state" (v2.1.1) both follow from this: everything a
 * GuidanceItem says is re-derivable at any moment from the real rows
 * (shipments, declarations, ...) it was computed from.
 */

export type GuidancePriority =
  | "REQUIRED"
  | "RECOMMENDED"
  | "OPTIONAL";

export type GuidanceImpact =
  | "FILING"
  | "INTEGRITY"
  | "APPROVAL"
  | "DATA_ENTRY"
  | "SETUP"
  | "INFO";

export type GuidanceActionability =
  | "NAVIGATE"
  | "HANDOFF"
  | "BLOCKED";

/**
 * The parent an item aggregates under (v2.1.1's aggregation rule:
 * "group by (rule, parent) ... line-level importer rules group by
 * parent shipment, producer record-level rules group by installation,
 * org-level and period-level items never aggregate"). `null` means
 * this item's own rule has no specified parent grouping -- it never
 * aggregates with sibling items of the same rule, regardless of how
 * many there are. I19 (the one concrete rule this phase implements) is
 * shipment-level, not line-level or record-level, and v2.1.1 does not
 * name a parent for that case -- so I19 items are always emitted with
 * `parent: null` (see i19.ts's own comment).
 */
export interface GuidanceParent {
  type: string;
  id: string;
  label: string;
}

/**
 * One guidance item, either a single-source item derived directly from
 * domain state, or an AGGREGATE collapsing 4+ same-(rule,parent)
 * members into one row (see aggregate.ts). `id` is the STABLE identity
 * used both for React keys and as the dismissal fingerprint
 * (guidance_dismissals.item_key) -- it must be deterministic across
 * re-derivations of the exact same underlying condition, and it must
 * change if the underlying condition materially changes (e.g. an
 * aggregate's `id` changes when its membership changes, so a stale
 * dismissal naturally stops matching rather than silently continuing
 * to suppress a now-different set of items).
 */
export interface GuidanceItem {
  id: string;
  rule: string;
  parent: GuidanceParent | null;

  // "Every guidance item must have ... exclusive family" (v2.1.1): the
  // dedup group this item belongs to (dedup.ts) -- when two or more
  // items share the same family, only the highest-priority (then
  // highest-impact, then sortKey) survives. Deliberately a plain string
  // field on the item itself, not something dedup derives externally,
  // so a rule's author states its own item's exclusivity group
  // explicitly rather than dedup guessing it from other fields.
  family: string;

  priority: GuidancePriority;
  impact: GuidanceImpact;
  actionability: GuidanceActionability;

  title: string;
  reason: string;
  href?: string;

  // Present only on an AGGREGATE item (aggregate.ts) -- the collapsed
  // member ids and their count. Absent on an ordinary, single-source
  // item.
  aggregateCount?: number;
  derivedFrom?: string[];

  // Stable, deterministic tiebreak within the same priority tier
  // (rank.ts). Not itself part of the v2.1.1 contract -- only the
  // REQUIRED > RECOMMENDED > OPTIONAL ordering is specified; this
  // exists so ranking is fully deterministic (see rank.ts's own
  // comment on what governs the secondary sort).
  sortKey: string;
}

export interface GuidanceContext {
  org_id: OrganizationId;
}

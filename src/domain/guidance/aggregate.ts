import {
  compareGuidanceItems,
} from "./rank";

import type {
  GuidanceImpact,
  GuidanceItem,
  GuidancePriority,
} from "./types";

/**
 * v2.1.1's aggregation rule, exactly: "group by (rule, parent) --
 * line-level importer rules group by parent shipment, producer
 * record-level rules group by installation, org-level and period-level
 * items never aggregate ... 1-3 members remain individual; >=4 members
 * collapse into ONE aggregate item ... aggregate_count = member count,
 * derived_from = union of members, priority/impact = most severe
 * member, aggregate position = best member's sort position."
 *
 * "Org-level and period-level items never aggregate" is generalized
 * here to: any item whose `parent` is `null` never aggregates,
 * regardless of count -- this also covers a rule like I19 that v2.1.1
 * does not name a parent for at all (I19 is shipment-level, neither of
 * the two named cases), which this implementation therefore treats the
 * same way rather than inventing a grouping it was not given (see
 * i19.ts).
 */
const AGGREGATE_THRESHOLD = 4;

function groupKey(
  item: GuidanceItem,
): string | null {
  if (!item.parent) {
    return null;
  }

  return `${item.rule}::${item.parent.type}::${item.parent.id}`;
}

const PRIORITY_SEVERITY: Record<GuidancePriority, number> =
  {
    REQUIRED: 0,
    RECOMMENDED: 1,
    OPTIONAL: 2,
  };

const IMPACT_SEVERITY: Record<GuidanceImpact, number> =
  {
    FILING: 0,
    INTEGRITY: 1,
    APPROVAL: 2,
    DATA_ENTRY: 3,
    SETUP: 4,
    INFO: 5,
  };

function mostSevere<T extends string>(
  values: T[],
  severity: Record<T, number>,
): T {
  return values.reduce(
    (best, current) =>
      severity[current] < severity[best] ? current : best,
  );
}

function toAggregate(
  members: GuidanceItem[],
): GuidanceItem {
  const sortedByPosition =
    [...members].sort(
      compareGuidanceItems,
    );

  const best =
    sortedByPosition[0] as GuidanceItem;

  const id =
    `aggregate:${best.rule}:${best.parent?.type}:${best.parent?.id}`;

  return {
    id,
    rule: best.rule,
    parent: best.parent,
    // An aggregate's family is unique to itself -- it already IS the
    // collapsed representative of its (rule, parent) group, so it has
    // nothing left to deduplicate against.
    family: id,
    priority: mostSevere(
      members.map((m) => m.priority),
      PRIORITY_SEVERITY,
    ),
    impact: mostSevere(
      members.map((m) => m.impact),
      IMPACT_SEVERITY,
    ),
    actionability: best.actionability,
    title: `${members.length} items need attention -- ${best.parent?.label ?? ""}`,
    reason: `${members.length} items across ${best.parent?.label ?? "this group"}`,
    href: best.href,
    aggregateCount: members.length,
    derivedFrom: members.map((m) => m.id),
    sortKey: best.sortKey,
  };
}

/**
 * Pure. Does not rank or dismiss -- callers run this BEFORE
 * rankGuidanceItems, since an aggregate's own priority/impact must
 * already be resolved (most-severe-member) before the result is
 * ranked as a normal GuidanceItem alongside everything else.
 */
export function aggregateGuidanceItems(
  items: GuidanceItem[],
): GuidanceItem[] {
  const groups =
    new Map<string, GuidanceItem[]>();

  const ungrouped: GuidanceItem[] =
    [];

  for (
    const item of items
  ) {
    const key =
      groupKey(item);

    if (key === null) {
      ungrouped.push(
        item,
      );

      continue;
    }

    const existing =
      groups.get(key);

    if (existing) {
      existing.push(
        item,
      );
    } else {
      groups.set(
        key,
        [item],
      );
    }
  }

  const result: GuidanceItem[] =
    [...ungrouped];

  for (
    const members of groups.values()
  ) {
    if (members.length >= AGGREGATE_THRESHOLD) {
      result.push(
        toAggregate(
          members,
        ),
      );
    } else {
      result.push(
        ...members,
      );
    }
  }

  return result;
}

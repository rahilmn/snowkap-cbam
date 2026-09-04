import {
  Badge,
} from "./badge";

import {
  STATUS_LABEL,
  STATUS_TONE,
} from "../../src/domain/status-vocabulary/labels";

import type {
  StatusKey,
} from "../../src/domain/status-vocabulary/types";

/**
 * Renders one entry of the product's status/provenance vocabulary
 * (src/domain/status-vocabulary) -- never a raw domain enum value or
 * ad hoc prose. `data-status-key` carries the machine-readable key for
 * E2E assertions to target instead of matching on the rendered label
 * text (v2.1 §9.6 layer 3).
 */
export interface StatusBadgeProps {
  statusKey: StatusKey;
  className?: string;
}

export function StatusBadge(
  {
    statusKey,
    className,
  }: StatusBadgeProps,
) {
  return (
    <Badge
      tone={STATUS_TONE[statusKey]}
      className={className}
      data-status-key={statusKey}
    >
      {STATUS_LABEL[statusKey]}
    </Badge>
  );
}

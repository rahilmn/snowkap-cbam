import type {
  ResolutionReason,
} from "../../src/domain/regulatory/types";

/**
 * The "status honesty" element the design direction calls for
 * (docs/plans/MASTER_PLAN.md §25): every regulatory resolution reason
 * gets its own distinct, named badge -- a fallback is visibly a
 * fallback, an unresolved value is visibly unresolved. Nothing here is
 * ever rendered as a generic "success" green merely because a value
 * happened to come back non-null; REFERENCE_REQUIRED, UNAVAILABLE,
 * AMBIGUOUS, and NO_MATCH are deliberately never dressed up as good
 * news. See app/globals.css for the --status-* token definitions this
 * reads from.
 */
const REASON_LABEL: Record<ResolutionReason, string> = {
  EXACT_TARIC_MATCH:
    "Resolved (TARIC)",

  EXACT_CN8_MATCH:
    "Resolved (CN8)",

  EXACT_HS6_MATCH:
    "Resolved (HS6)",

  EXACT_HS4_MATCH:
    "Resolved (HS4)",

  OTHER_COUNTRIES_FALLBACK:
    "Fallback territory",

  REFERENCE_REQUIRED:
    "Reference required",

  UNAVAILABLE:
    "Unavailable",

  NOT_APPLICABLE:
    "Not applicable",

  AMBIGUOUS:
    "Ambiguous",

  NO_MATCH:
    "No match",
};

type StatusTone =
  | "resolved"
  | "fallback"
  | "reference-required"
  | "unavailable"
  | "ambiguous";

const REASON_TONE: Record<ResolutionReason, StatusTone> = {
  EXACT_TARIC_MATCH:
    "resolved",

  EXACT_CN8_MATCH:
    "resolved",

  EXACT_HS6_MATCH:
    "resolved",

  EXACT_HS4_MATCH:
    "resolved",

  OTHER_COUNTRIES_FALLBACK:
    "fallback",

  REFERENCE_REQUIRED:
    "reference-required",

  UNAVAILABLE:
    "unavailable",

  NOT_APPLICABLE:
    "unavailable",

  AMBIGUOUS:
    "ambiguous",

  NO_MATCH:
    "ambiguous",
};

const TONE_VARS: Record<
  StatusTone,
  { color: string; surface: string }
> = {
  resolved: {
    color:
      "var(--status-resolved)",

    surface:
      "var(--status-resolved-surface)",
  },

  fallback: {
    color:
      "var(--status-fallback)",

    surface:
      "var(--status-fallback-surface)",
  },

  "reference-required": {
    color:
      "var(--status-reference-required)",

    surface:
      "var(--status-reference-required-surface)",
  },

  unavailable: {
    color:
      "var(--status-unavailable)",

    surface:
      "var(--status-unavailable-surface)",
  },

  ambiguous: {
    color:
      "var(--status-ambiguous)",

    surface:
      "var(--status-ambiguous-surface)",
  },
};

export interface RegulatoryStatusBadgeProps {
  reason: ResolutionReason;
}

export function RegulatoryStatusBadge(
  {
    reason,
  }: RegulatoryStatusBadgeProps,
) {
  const tone =
    TONE_VARS[
      REASON_TONE[
        reason
      ]
    ];

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-0.5 text-xs font-medium"
      style={{
        color:
          tone.color,

        backgroundColor:
          tone.surface,
      }}
    >
      <span
        className="size-1.5 rounded-full"
        style={{
          backgroundColor:
            tone.color,
        }}
        aria-hidden="true"
      />

      {REASON_LABEL[reason]}
    </span>
  );
}

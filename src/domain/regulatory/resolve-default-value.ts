import type {
  DefaultValueResolutionInput,
  DefaultValueResolutionResult,
  RegulatoryRecord,
  ResolutionTraceStep,
  ResolutionReason,
} from "./types.js";

const OTHER_COUNTRIES_NAME =
  "_Other Countries and Territorie";

type ExactSelection =
  | {
      kind: "SELECTED";
      record: RegulatoryRecord;
    }
  | {
      kind: "AMBIGUOUS";
    }
  | {
      kind: "NONE";
    };

function normalizeCode(
  value: string,
): string {
  return value.replace(/\s+/g, "");
}

function codeLevelPriority(
  level: RegulatoryRecord["code_level"],
): number {
  switch (level) {
    case "TARIC10":
      return 4;

    case "CN8":
      return 3;

    case "HS6":
      return 2;

    case "HS4":
      return 1;

    default:
      throw new Error(
        `Unsupported regulatory code level: ${level}`,
      );
  }
}

function isUsableTotalValue(
  record: RegulatoryRecord,
): boolean {
  return (
    record.total_emissions.status ===
      "AVAILABLE"
    && record.total_emissions.value !== null
  );
}

function exactReason(
  record: RegulatoryRecord,
):
  | "EXACT_TARIC_MATCH"
  | "EXACT_CN8_MATCH"
  | "EXACT_HS6_MATCH"
  | "EXACT_HS4_MATCH" {
  switch (record.code_level) {
    case "TARIC10":
      return "EXACT_TARIC_MATCH";

    case "CN8":
      return "EXACT_CN8_MATCH";

    case "HS6":
      return "EXACT_HS6_MATCH";

    case "HS4":
      return "EXACT_HS4_MATCH";

    default:
      throw new Error(
        `Unsupported regulatory code level: ${record.code_level}`,
      );
  }
}

function unresolved(
  reason:
    | "REFERENCE_REQUIRED"
    | "UNAVAILABLE"
    | "NOT_APPLICABLE"
    | "AMBIGUOUS"
    | "NO_MATCH",
  trace: ResolutionTraceStep[],
): DefaultValueResolutionResult {
  return {
    status: "UNRESOLVED",
    reason,
    record: null,
    trace,
  };
}

function selectExact(
  records: RegulatoryRecord[],
  productionRoute: string | null,
  trace: ResolutionTraceStep[],
): ExactSelection {
  const sorted = [...records].sort(
    (a, b) =>
      codeLevelPriority(b.code_level) -
      codeLevelPriority(a.code_level),
  );

  /*
   * Explicit production route:
   * route-specific first, then route-independent.
   */
  if (productionRoute !== null) {
    const routeSpecific =
      sorted.filter(
        (record: RegulatoryRecord) =>
          record.source_production_route_code ===
          productionRoute,
      );

    trace.push({
      step: "ROUTE_MATCH",
      outcome:
        `${routeSpecific.length} route-specific records`,
    });

    const usableRouteSpecific =
      routeSpecific.filter(
        (record: RegulatoryRecord) =>
          isUsableTotalValue(record),
      );

    if (
      usableRouteSpecific.length === 1
    ) {
      const selected =
        usableRouteSpecific[0];

      if (selected) {
        trace.push({
          step: "ROUTE_SELECTION",
          outcome:
            "Selected usable route-specific record",
        });

        return {
          kind: "SELECTED",
          record: selected,
        };
      }
    }

    if (
      usableRouteSpecific.length > 1
    ) {
      trace.push({
        step: "AMBIGUOUS_EXACT_MATCH",
        outcome:
          `${usableRouteSpecific.length} usable route-specific records`,
      });

      return {
        kind: "AMBIGUOUS",
      };
    }

    const routeIndependent =
      sorted.filter(
        (record: RegulatoryRecord) =>
          record.source_production_route_code ===
          null,
      );

    trace.push({
      step:
        "ROUTE_INDEPENDENT_CANDIDATES",
      outcome:
        `${routeIndependent.length} route-independent records`,
    });

    const usableRouteIndependent =
      routeIndependent.filter(
        (record: RegulatoryRecord) =>
          isUsableTotalValue(record),
      );

    if (
      usableRouteIndependent.length === 1
    ) {
      const selected =
        usableRouteIndependent[0];

      if (selected) {
        trace.push({
          step:
            "ROUTE_INDEPENDENT_MATCH",
          outcome:
            "Selected usable route-independent record",
        });

        return {
          kind: "SELECTED",
          record: selected,
        };
      }
    }

    if (
      usableRouteIndependent.length > 1
    ) {
      trace.push({
        step: "AMBIGUOUS_EXACT_MATCH",
        outcome:
          `${usableRouteIndependent.length} usable route-independent records`,
      });

      return {
        kind: "AMBIGUOUS",
      };
    }

    return {
      kind: "NONE",
    };
  }

  /*
   * No route supplied.
   * Evaluate every usable exact record.
   */
  const usable =
    sorted.filter(
      (record: RegulatoryRecord) =>
        isUsableTotalValue(record),
    );

  trace.push({
    step:
      "USABLE_EXACT_CANDIDATES",
    outcome:
      `${usable.length} usable exact records`,
  });

  if (usable.length === 1) {
    const selected = usable[0];

    if (selected) {
      trace.push({
        step:
          "EXACT_USABLE_MATCH",
        outcome:
          "Selected unique usable exact record",
      });

      return {
        kind: "SELECTED",
        record: selected,
      };
    }
  }

  if (usable.length > 1) {
    trace.push({
      step: "AMBIGUOUS_EXACT_MATCH",
      outcome:
        `${usable.length} usable exact records`,
    });

    return {
      kind: "AMBIGUOUS",
    };
  }

  return {
    kind: "NONE",
  };
}

function exactStatus(
  records: RegulatoryRecord[],
):
  | "REFERENCE_REQUIRED"
  | "UNAVAILABLE"
  | "NOT_APPLICABLE"
  | null {
  if (
    records.some(
      (record: RegulatoryRecord) =>
        record.total_emissions.status ===
        "REFERENCE_REQUIRED",
    )
  ) {
    return "REFERENCE_REQUIRED";
  }

  if (
    records.some(
      (record: RegulatoryRecord) =>
        record.total_emissions.status ===
        "UNAVAILABLE",
    )
  ) {
    return "UNAVAILABLE";
  }

  if (
    records.some(
      (record: RegulatoryRecord) =>
        record.total_emissions.status ===
        "NOT_APPLICABLE",
    )
  ) {
    return "NOT_APPLICABLE";
  }

  return null;
}

function selectFallback(
  records: RegulatoryRecord[],
  productionRoute: string | null,
  trace: ResolutionTraceStep[],
): ExactSelection {
  const usable =
    records.filter(
      (record: RegulatoryRecord) =>
        isUsableTotalValue(record),
    );

  /*
   * Explicit route:
   * prefer exact fallback route, then
   * route-independent fallback.
   */
  if (productionRoute !== null) {
    const routeSpecific =
      usable.filter(
        (record: RegulatoryRecord) =>
          record.source_production_route_code ===
          productionRoute,
      );

    trace.push({
      step:
        "FALLBACK_ROUTE_MATCH",
      outcome:
        `${routeSpecific.length} usable route-specific fallback records`,
    });

    if (
      routeSpecific.length === 1
    ) {
      const selected =
        routeSpecific[0];

      if (selected) {
        trace.push({
          step:
            "FALLBACK_SELECTION",
          outcome:
            "Selected route-specific fallback",
        });

        return {
          kind: "SELECTED",
          record: selected,
        };
      }
    }

    if (
      routeSpecific.length > 1
    ) {
      trace.push({
        step:
          "FALLBACK_AMBIGUOUS",
        outcome:
          `${routeSpecific.length} route-specific fallback records`,
      });

      return {
        kind: "AMBIGUOUS",
      };
    }

    const routeIndependent =
      usable.filter(
        (record: RegulatoryRecord) =>
          record.source_production_route_code ===
          null,
      );

    trace.push({
      step:
        "FALLBACK_ROUTE_INDEPENDENT",
      outcome:
        `${routeIndependent.length} usable route-independent fallback records`,
    });

    if (
      routeIndependent.length === 1
    ) {
      const selected =
        routeIndependent[0];

      if (selected) {
        trace.push({
          step:
            "FALLBACK_SELECTION",
          outcome:
            "Selected route-independent fallback",
        });

        return {
          kind: "SELECTED",
          record: selected,
        };
      }
    }

    if (
      routeIndependent.length > 1
    ) {
      trace.push({
        step:
          "FALLBACK_AMBIGUOUS",
        outcome:
          `${routeIndependent.length} route-independent fallback records`,
      });

      return {
        kind: "AMBIGUOUS",
      };
    }

    return {
      kind: "NONE",
    };
  }

  /*
   * No route supplied.
   */
  if (usable.length === 1) {
    const selected =
      usable[0];

    if (selected) {
      trace.push({
        step:
          "FALLBACK_SELECTION",
        outcome:
          "Selected unique fallback record",
      });

      return {
        kind: "SELECTED",
        record: selected,
      };
    }
  }

  if (usable.length > 1) {
    trace.push({
      step:
        "FALLBACK_AMBIGUOUS",
      outcome:
        `${usable.length} usable fallback records`,
    });

    return {
      kind: "AMBIGUOUS",
    };
  }

  return {
    kind: "NONE",
  };
}

/*
 * IMPORTANT:
 * The export is required by both Vitest test files.
 */
export function resolveDefaultValue(
  records: RegulatoryRecord[],
  input: DefaultValueResolutionInput,
): DefaultValueResolutionResult {
  const trace: ResolutionTraceStep[] = [];

  const normalizedCode =
    normalizeCode(
      input.trade_code,
    );

  const productionRoute =
    input.production_route ?? null;

  trace.push({
    step:
      "NORMALIZE_CODE",
    outcome:
      normalizedCode,
  });

  /*
   * ----------------------------------------------------------
   * 1. Country records
   * ----------------------------------------------------------
   */
  const countryRecords =
    records.filter(
      (record: RegulatoryRecord) =>
        record.origin_country_name ===
        input.origin_country_name,
    );

  trace.push({
    step:
      "COUNTRY_MATCH",
    outcome:
      `${countryRecords.length} records`,
  });

  /*
   * ----------------------------------------------------------
   * 2. Exact country + code
   * ----------------------------------------------------------
   */
  const exactCountryMatches =
    countryRecords.filter(
      (record: RegulatoryRecord) =>
        record.normalized_trade_code ===
        normalizedCode,
    );

  trace.push({
    step:
      "EXACT_CODE_MATCH",
    outcome:
      `${exactCountryMatches.length} records`,
  });

  if (
    exactCountryMatches.length > 0
  ) {
    const selection =
      selectExact(
        exactCountryMatches,
        productionRoute,
        trace,
      );

    if (
      selection.kind ===
      "SELECTED"
    ) {
      return {
        status:
          "RESOLVED",

        reason:
          exactReason(
            selection.record,
          ),

        record:
          selection.record,

        trace,
      };
    }

    if (
      selection.kind ===
      "AMBIGUOUS"
    ) {
      return unresolved(
        "AMBIGUOUS",
        trace,
      );
    }

    const status =
      exactStatus(
        exactCountryMatches,
      );

    if (
      status ===
      "REFERENCE_REQUIRED"
    ) {
      trace.push({
        step:
          "REFERENCE_REQUIRED",
        outcome:
          "Exact record requires more-specific regulatory resolution",
      });

      return unresolved(
        "REFERENCE_REQUIRED",
        trace,
      );
    }

    if (
      status ===
      "NOT_APPLICABLE"
    ) {
      trace.push({
        step:
          "NOT_APPLICABLE",
        outcome:
          "Exact record is not applicable",
      });

      return unresolved(
        "NOT_APPLICABLE",
        trace,
      );
    }

    if (
      status ===
      "UNAVAILABLE"
    ) {
      trace.push({
        step:
          "COUNTRY_FALLBACK_TRIGGER",
        outcome:
          "Exact country value is unavailable",
      });
    }
  } else {
    trace.push({
      step:
        "COUNTRY_FALLBACK_TRIGGER",
      outcome:
        "No exact country-specific record exists",
    });
  }

  /*
   * ----------------------------------------------------------
   * 3. Other Countries and Territories fallback
   * ----------------------------------------------------------
   */
  const fallbackRecords =
    records.filter(
      (record: RegulatoryRecord) =>
        record.origin_country_name ===
          OTHER_COUNTRIES_NAME
        && record.normalized_trade_code ===
          normalizedCode,
    );

  trace.push({
    step:
      "FALLBACK_COUNTRY_MATCH",
    outcome:
      `${fallbackRecords.length} records`,
  });

  const fallback =
    selectFallback(
      fallbackRecords,
      productionRoute,
      trace,
    );

  if (
    fallback.kind ===
    "SELECTED"
  ) {
    return {
      status:
        "RESOLVED",

      reason:
        "OTHER_COUNTRIES_FALLBACK",

      record:
        fallback.record,

      trace,
    };
  }

  if (
    fallback.kind ===
    "AMBIGUOUS"
  ) {
    return unresolved(
      "AMBIGUOUS",
      trace,
    );
  }

  /*
   * ----------------------------------------------------------
   * 4. Fallback exists but isn't usable
   * ----------------------------------------------------------
   */
  if (
    fallbackRecords.length > 0
  ) {
    const fallbackStatuses =
      new Set(
        fallbackRecords.map(
          (
            record: RegulatoryRecord,
          ) =>
            record.total_emissions.status,
        ),
      );

    if (
      fallbackStatuses.size === 1
      && fallbackStatuses.has(
        "REFERENCE_REQUIRED",
      )
    ) {
      trace.push({
        step:
          "FALLBACK_REFERENCE_REQUIRED",
        outcome:
          "Fallback requires regulatory reference resolution",
      });

      return unresolved(
        "REFERENCE_REQUIRED",
        trace,
      );
    }

    if (
      fallbackStatuses.size === 1
      && fallbackStatuses.has(
        "NOT_APPLICABLE",
      )
    ) {
      trace.push({
        step:
          "FALLBACK_NOT_APPLICABLE",
        outcome:
          "Fallback record is not applicable",
      });

      return unresolved(
        "NOT_APPLICABLE",
        trace,
      );
    }

    if (
      fallbackStatuses.has(
        "UNAVAILABLE",
      )
    ) {
      trace.push({
        step:
          "FALLBACK_UNAVAILABLE",
        outcome:
          "Fallback record is unavailable",
      });

      return unresolved(
        "UNAVAILABLE",
        trace,
      );
    }
  }

  /*
   * Exact country record existed but was unavailable,
   * and no usable fallback exists.
   */
  const countryStatus =
    exactStatus(
      exactCountryMatches,
    );

  if (
    countryStatus ===
    "UNAVAILABLE"
  ) {
    trace.push({
      step:
        "FALLBACK_UNAVAILABLE",
      outcome:
        "No usable fallback value exists",
    });

    return unresolved(
      "UNAVAILABLE",
      trace,
    );
  }

  trace.push({
    step:
      "NO_FALLBACK_MATCH",
    outcome:
      "No applicable regulatory fallback exists",
  });

  return unresolved(
    "NO_MATCH",
    trace,
  );
}
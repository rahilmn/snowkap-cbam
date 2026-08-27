import type {
  DefaultValueResolutionInput,
  DefaultValueResolutionResult,
  RegulatoryRecord,
  ResolutionTraceStep,
} from "./types.js";

function normalizeCode(
  value: string,
): string {
  return value.replace(/\s+/g, "");
}

function matchesCountry(
  record: RegulatoryRecord,
  originCountryName: string,
): boolean {
  return (
    record.origin_country_name ===
    originCountryName
  );
}

function matchesCode(
  record: RegulatoryRecord,
  normalizedCode: string,
): boolean {
  return (
    record.normalized_trade_code ===
    normalizedCode
  );
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

function resolutionReasonFor(
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

function unresolvedResult(
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

export function resolveDefaultValue(
  records: RegulatoryRecord[],
  input: DefaultValueResolutionInput,
): DefaultValueResolutionResult {
  const trace: ResolutionTraceStep[] = [];

  const normalizedCode = normalizeCode(
    input.trade_code,
  );

  trace.push({
    step: "NORMALIZE_CODE",
    outcome: normalizedCode,
  });

  const countryRecords =
    records.filter(
      (record) =>
        matchesCountry(
          record,
          input.origin_country_name,
        ),
    );

  trace.push({
    step: "COUNTRY_MATCH",
    outcome: `${countryRecords.length} records`,
  });

  if (countryRecords.length === 0) {
    trace.push({
      step: "NO_COUNTRY_MATCH",
      outcome:
        "No records found for the requested origin country",
    });

    return unresolvedResult(
      "NO_MATCH",
      trace,
    );
  }

  const exactMatches =
    countryRecords.filter(
      (record) =>
        matchesCode(
          record,
          normalizedCode,
        ),
    );

  trace.push({
    step: "EXACT_CODE_MATCH",
    outcome: `${exactMatches.length} records`,
  });

  if (exactMatches.length === 0) {
    trace.push({
      step: "NO_EXACT_MATCH",
      outcome:
        "No record exists for the requested country and code",
    });

    return unresolvedResult(
      "NO_MATCH",
      trace,
    );
  }

  const sorted = [
    ...exactMatches,
  ].sort(
    (a, b) =>
      codeLevelPriority(
        b.code_level,
      ) -
      codeLevelPriority(
        a.code_level,
      ),
  );

  /*
   * Route-specific exact match.
   */
  if (input.production_route) {
    const routeMatches =
      sorted.filter(
        (record) =>
          record.source_production_route_code ===
          input.production_route,
      );

    trace.push({
      step: "ROUTE_MATCH",
      outcome: `${routeMatches.length} route-specific records`,
    });

    const usableRouteRecord =
      routeMatches.find(
        isUsableTotalValue,
      );

    if (usableRouteRecord) {
      trace.push({
        step: "ROUTE_SELECTION",
        outcome:
          "Usable exact route-specific record selected",
      });

      return {
        status: "RESOLVED",
        reason:
          resolutionReasonFor(
            usableRouteRecord,
          ),
        record: usableRouteRecord,
        trace,
      };
    }
  }

  /*
   * Route-independent exact match.
   */
  const routeIndependent =
    sorted.filter(
      (record) =>
        record.source_production_route_code ===
        null,
    );

  const usableRouteIndependent =
    routeIndependent.find(
      isUsableTotalValue,
    );

  if (usableRouteIndependent) {
    trace.push({
      step: "ROUTE_INDEPENDENT_MATCH",
      outcome:
        "Usable exact route-independent record selected",
    });

    return {
      status: "RESOLVED",
      reason:
        resolutionReasonFor(
          usableRouteIndependent,
        ),
      record:
        usableRouteIndependent,
      trace,
    };
  }

  /*
   * Any unique usable exact record.
   *
   * We deliberately refuse to guess when multiple usable
   * records remain.
   */
  const usableExact =
    sorted.filter(
      isUsableTotalValue,
    );

  if (usableExact.length === 1) {
    const selected =
      usableExact[0];

    if (selected) {
      trace.push({
        step: "EXACT_USABLE_MATCH",
        outcome:
          "Unique usable exact record selected",
      });

      return {
        status: "RESOLVED",
        reason:
          resolutionReasonFor(
            selected,
          ),
        record: selected,
        trace,
      };
    }
  }

  if (usableExact.length > 1) {
    trace.push({
      step: "AMBIGUOUS_EXACT_MATCH",
      outcome:
        `${usableExact.length} usable exact records remain`,
    });

    return unresolvedResult(
      "AMBIGUOUS",
      trace,
    );
  }

  /*
   * An exact record exists but has no usable total value.
   *
   * Do not turn it into zero and do not yet attempt fallback.
   * Fallback behavior will be implemented as a separate,
   * explicitly tested rule.
   */
  const referenceMatch =
    sorted.find(
      (record) =>
        record.total_emissions.status ===
        "REFERENCE_REQUIRED",
    );

  if (referenceMatch) {
    trace.push({
      step: "REFERENCE_REQUIRED",
      outcome:
        "Exact record requires regulatory reference resolution",
    });

    return unresolvedResult(
      "REFERENCE_REQUIRED",
      trace,
    );
  }

  const unavailableMatch =
    sorted.find(
      (record) =>
        record.total_emissions.status ===
        "UNAVAILABLE",
    );

  if (unavailableMatch) {
    trace.push({
      step: "UNAVAILABLE",
      outcome:
        "Exact record has no usable total-emissions value",
    });

    return unresolvedResult(
      "UNAVAILABLE",
      trace,
    );
  }

  const notApplicableMatch =
    sorted.find(
      (record) =>
        record.total_emissions.status ===
        "NOT_APPLICABLE",
    );

  if (notApplicableMatch) {
    trace.push({
      step: "NOT_APPLICABLE",
      outcome:
        "Exact record is marked not applicable",
    });

    return unresolvedResult(
      "NOT_APPLICABLE",
      trace,
    );
  }

  trace.push({
    step: "NO_EXACT_USABLE_VALUE",
    outcome:
      "No exact record produced a usable total-emissions value",
  });

  return unresolvedResult(
    "NO_MATCH",
    trace,
  );
}
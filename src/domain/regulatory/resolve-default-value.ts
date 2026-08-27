import type {
  DefaultValueResolutionInput,
  DefaultValueResolutionResult,
  RegulatoryRecord,
  ResolutionTraceStep,
} from "./types.js";

function normalizeCode(value: string): string {
  return value.replace(/\s+/g, "");
}

function matchesCountry(
  record: RegulatoryRecord,
  originCountry: string,
): boolean {
  return record.origin_country_name === originCountry;
}

function matchesCode(
  record: RegulatoryRecord,
  normalizedCode: string,
): boolean {
  return record.normalized_trade_code === normalizedCode;
}

function codeLevelPriority(level: RegulatoryRecord["code_level"]): number {
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
      throw new Error(`Unsupported regulatory code level: ${level}`);
  }
}

function isUsableTotalValue(record: RegulatoryRecord): boolean {
  return (
    record.total_emissions.status === "AVAILABLE" &&
    record.total_emissions.value !== null
  );
}

function resolutionReasonFor(
  record: RegulatoryRecord,
): "EXACT_TARIC_MATCH" | "EXACT_CN8_MATCH" {
  return record.code_level === "TARIC10"
    ? "EXACT_TARIC_MATCH"
    : "EXACT_CN8_MATCH";
}

export function resolveDefaultValue(
  records: RegulatoryRecord[],
  input: DefaultValueResolutionInput,
): DefaultValueResolutionResult {
  const trace: ResolutionTraceStep[] = [];

  const normalizedCode = normalizeCode(input.trade_code);

  trace.push({
    step: "NORMALIZE_CODE",
    outcome: normalizedCode,
  });

  const countryRecords = records.filter((record) =>
    matchesCountry(record, input.origin_country),
  );

  trace.push({
    step: "COUNTRY_MATCH",
    outcome: `${countryRecords.length} records`,
  });

  if (countryRecords.length === 0) {
    return {
      status: "UNRESOLVED",
      reason: "NO_MATCH",
      record: null,
      trace,
    };
  }

  const exactMatches = countryRecords.filter((record) =>
    matchesCode(record, normalizedCode),
  );

  trace.push({
    step: "EXACT_CODE_MATCH",
    outcome: `${exactMatches.length} records`,
  });

  if (exactMatches.length === 0) {
    trace.push({
      step: "NO_EXACT_USABLE_VALUE",
      outcome: "No exact country/code record produced a usable value",
    });

    return {
      status: "UNRESOLVED",
      reason: "NO_MATCH",
      record: null,
      trace,
    };
  }

  const sorted = [...exactMatches].sort(
    (a, b) => codeLevelPriority(b.code_level) - codeLevelPriority(a.code_level),
  );

  /*
   * Route-specific exact match.
   */
  if (input.production_route) {
    const routeMatches = sorted.filter(
      (record) =>
        record.source_production_route_code === input.production_route,
    );

    const selectedRouteRecord = routeMatches.find(isUsableTotalValue);

    if (selectedRouteRecord) {
      trace.push({
        step: "ROUTE_MATCH",
        outcome: "Exact route-specific record selected",
      });

      return {
        status: "RESOLVED",
        reason: resolutionReasonFor(selectedRouteRecord),
        record: selectedRouteRecord,
        trace,
      };
    }

    trace.push({
      step: "ROUTE_MATCH",
      outcome: "No usable exact route-specific record",
    });
  }

  /*
   * Route-independent exact match.
   */
  const routeIndependent = sorted.filter(
    (record) => record.source_production_route_code === null,
  );

  const selectedRouteIndependent = routeIndependent.find(isUsableTotalValue);

  if (selectedRouteIndependent) {
    trace.push({
      step: "ROUTE_INDEPENDENT_MATCH",
      outcome: "Exact route-independent record selected",
    });

    return {
      status: "RESOLVED",
      reason: resolutionReasonFor(selectedRouteIndependent),
      record: selectedRouteIndependent,
      trace,
    };
  }

  /*
   * Unique usable exact record.
   *
   * This handles a valid exact match where the source contains
   * one usable record but there is no route-specific selection.
   */
  const usable = sorted.filter(isUsableTotalValue);

  if (usable.length === 1) {
    const selected = usable[0];

    if (selected) {
      trace.push({
        step: "EXACT_USABLE_MATCH",
        outcome: "Unique exact record selected",
      });

      return {
        status: "RESOLVED",
        reason: resolutionReasonFor(selected),
        record: selected,
        trace,
      };
    }
  }

  if (usable.length > 1) {
    trace.push({
      step: "AMBIGUOUS_EXACT_MATCH",
      outcome: `${usable.length} usable exact records remain`,
    });

    return {
      status: "UNRESOLVED",
      reason: "NO_MATCH",
      record: null,
      trace,
    };
  }

  trace.push({
    step: "NO_EXACT_USABLE_VALUE",
    outcome: "No exact country/code record produced a usable value",
  });

  return {
    status: "UNRESOLVED",
    reason: "NO_MATCH",
    record: null,
    trace,
  };
}

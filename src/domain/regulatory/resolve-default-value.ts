import type {
  DefaultValueResolutionInput,
  DefaultValueResolutionResult,
  RegulatoryRecord,
  ResolutionTraceStep,
} from "./types.js";


const OTHER_TERRITORIES =
  "_Other Countries and Territorie";


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
    &&
    record.total_emissions.value !==
      null
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


interface CountryResolutionResult {
  result: DefaultValueResolutionResult;
  hasExactMatch: boolean;
}


function resolveForCountry(
  records: RegulatoryRecord[],
  countryName: string,
  input: DefaultValueResolutionInput,
  normalizedCode: string,
  trace: ResolutionTraceStep[],
): CountryResolutionResult {
  const countryRecords =
    records.filter(
      (record) =>
        matchesCountry(
          record,
          countryName,
        ),
    );

  trace.push({
    step: "COUNTRY_MATCH",
    outcome:
      `${countryRecords.length} records for ${countryName}`,
  });


  if (
    countryRecords.length === 0
  ) {
    trace.push({
      step: "NO_COUNTRY_MATCH",
      outcome:
        `No records found for ${countryName}`,
    });

    return {
      result:
        unresolvedResult(
          "NO_MATCH",
          trace,
        ),

      hasExactMatch:
        false,
    };
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
    outcome:
      `${exactMatches.length} records for ${countryName}`,
  });


  /*
   * No exact regulatory code exists for this country.
   *
   * This is the only condition under which the caller is
   * permitted to try the Other Countries and Territories
   * fallback.
   */
  if (
    exactMatches.length === 0
  ) {
    trace.push({
      step: "NO_EXACT_MATCH",
      outcome:
        `No record exists for ${countryName} and code ${normalizedCode}`,
    });

    return {
      result:
        unresolvedResult(
          "NO_MATCH",
          trace,
        ),

      hasExactMatch:
        false,
    };
  }


  const sorted =
    [
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
   * If an explicit production route was supplied, prefer
   * an exact match for that route.
   */
  if (
    input.production_route
  ) {
    const routeMatches =
      sorted.filter(
        (record) =>
          record
            .source_production_route_code ===
          input.production_route,
      );

    trace.push({
      step:
        "ROUTE_MATCH",

      outcome:
        `${routeMatches.length} route-specific records for ${countryName}`,
    });

    const usableRouteMatches =
      routeMatches.filter(
        isUsableTotalValue,
      );

    if (
      usableRouteMatches.length ===
      1
    ) {
      const selected =
        usableRouteMatches[0];

      if (!selected) {
        throw new Error(
          "Expected a route-specific record.",
        );
      }

      trace.push({
        step:
          "ROUTE_SELECTION",

        outcome:
          "Usable exact route-specific record selected",
      });

      return {
        result: {
          status:
            "RESOLVED",

          reason:
            resolutionReasonFor(
              selected,
            ),

          record:
            selected,

          trace,
        },

        hasExactMatch:
          true,
      };
    }

    if (
      usableRouteMatches.length >
      1
    ) {
      trace.push({
        step:
          "AMBIGUOUS_EXACT_MATCH",

        outcome:
          `${usableRouteMatches.length} usable route-specific records remain`,
      });

      return {
        result:
          unresolvedResult(
            "AMBIGUOUS",
            trace,
          ),

        hasExactMatch:
          true,
      };
    }
  }


  /*
   * Route-independent exact match.
   *
   * This remains valid even when a route was supplied, provided
   * there is no usable route-specific record.
   */
  const routeIndependent =
    sorted.filter(
      (record) =>
        record
          .source_production_route_code ===
        null,
    );

  const usableRouteIndependent =
    routeIndependent.filter(
      isUsableTotalValue,
    );


  if (
    usableRouteIndependent.length ===
    1
  ) {
    const selected =
      usableRouteIndependent[0];

    if (!selected) {
      throw new Error(
        "Expected a route-independent record.",
      );
    }

    trace.push({
      step:
        "ROUTE_INDEPENDENT_MATCH",

      outcome:
        "Usable exact route-independent record selected",
    });

    return {
      result: {
        status:
          "RESOLVED",

        reason:
          resolutionReasonFor(
            selected,
          ),

        record:
          selected,

        trace,
      },

      hasExactMatch:
        true,
    };
  }


  if (
    usableRouteIndependent.length >
    1
  ) {
    trace.push({
      step:
        "AMBIGUOUS_EXACT_MATCH",

      outcome:
        `${usableRouteIndependent.length} usable route-independent records remain`,
    });

    return {
      result:
        unresolvedResult(
          "AMBIGUOUS",
          trace,
        ),

      hasExactMatch:
        true,
    };
  }


  /*
   * If an explicit route was requested and exact records exist
   * only for other routes, do not silently choose another route.
   */
  if (
    input.production_route
  ) {
    const requestedRouteExists =
      sorted.some(
        (record) =>
          record
            .source_production_route_code ===
          input.production_route,
      );

    const otherRouteRecords =
      sorted.filter(
        (record) =>
          record
            .source_production_route_code !==
            null
          &&
          record
            .source_production_route_code !==
          input.production_route,
      );

    if (
      !requestedRouteExists
      &&
      otherRouteRecords.length > 0
      &&
      routeIndependent.length === 0
    ) {
      trace.push({
        step:
          "EXPLICIT_ROUTE_NO_MATCH",

        outcome:
          `Exact code exists only for other routes; requested route ${input.production_route} was not found`,
      });

      return {
        result:
          unresolvedResult(
            "NO_MATCH",
            trace,
          ),

        hasExactMatch:
          true,
      };
    }
  }


  /*
   * Unique usable exact match.
   */
  const usableExact =
    sorted.filter(
      isUsableTotalValue,
    );

  if (
    usableExact.length ===
    1
  ) {
    const selected =
      usableExact[0];

    if (!selected) {
      throw new Error(
        "Expected a usable exact record.",
      );
    }

    trace.push({
      step:
        "EXACT_USABLE_MATCH",

      outcome:
        "Unique usable exact record selected",
    });

    return {
      result: {
        status:
          "RESOLVED",

        reason:
          resolutionReasonFor(
            selected,
          ),

        record:
          selected,

        trace,
      },

      hasExactMatch:
        true,
    };
  }


  if (
    usableExact.length >
    1
  ) {
    trace.push({
      step:
        "AMBIGUOUS_EXACT_MATCH",

      outcome:
        `${usableExact.length} usable exact records remain`,
    });

    return {
      result:
        unresolvedResult(
          "AMBIGUOUS",
          trace,
        ),

      hasExactMatch:
        true,
    };
  }


  /*
   * Exact regulatory record exists but does not contain a usable
   * total-emissions value.
   *
   * These explicit regulatory statuses must not be bypassed
   * with Other Countries and Territories fallback.
   */
  const referenceMatch =
    sorted.find(
      (record) =>
        record.total_emissions.status ===
        "REFERENCE_REQUIRED",
    );

  if (
    referenceMatch
  ) {
    trace.push({
      step:
        "REFERENCE_REQUIRED",

      outcome:
        "Exact record requires regulatory reference resolution",
    });

    return {
      result:
        unresolvedResult(
          "REFERENCE_REQUIRED",
          trace,
        ),

      hasExactMatch:
        true,
    };
  }


  const unavailableMatch =
    sorted.find(
      (record) =>
        record.total_emissions.status ===
        "UNAVAILABLE",
    );

  if (
    unavailableMatch
  ) {
    trace.push({
      step:
        "UNAVAILABLE",

      outcome:
        "Exact record has no usable total-emissions value",
    });

    return {
      result:
        unresolvedResult(
          "UNAVAILABLE",
          trace,
        ),

      hasExactMatch:
        true,
    };
  }


  const notApplicableMatch =
    sorted.find(
      (record) =>
        record.total_emissions.status ===
        "NOT_APPLICABLE",
    );

  if (
    notApplicableMatch
  ) {
    trace.push({
      step:
        "NOT_APPLICABLE",

      outcome:
        "Exact record is marked not applicable",
    });

    return {
      result:
        unresolvedResult(
          "NOT_APPLICABLE",
          trace,
        ),

      hasExactMatch:
        true,
    };
  }


  trace.push({
    step:
      "NO_EXACT_USABLE_VALUE",

    outcome:
      "No exact record produced a usable total-emissions value",
  });


  return {
    result:
      unresolvedResult(
        "NO_MATCH",
        trace,
      ),

    hasExactMatch:
      true,
  };
}


export function resolveDefaultValue(
  records: RegulatoryRecord[],
  input: DefaultValueResolutionInput,
): DefaultValueResolutionResult {
  const trace:
    ResolutionTraceStep[] =
    [];

  const normalizedCode =
    normalizeCode(
      input.trade_code,
    );

  trace.push({
    step:
      "NORMALIZE_CODE",

    outcome:
      normalizedCode,
  });


  /*
   * FIRST: resolve against the requested country.
   */
  const requestedCountry =
    resolveForCountry(
      records,
      input.origin_country_name,
      input,
      normalizedCode,
      trace,
    );


  /*
   * If an exact record exists for the requested country,
   * its result is authoritative.
   *
   * This prevents fallback from bypassing explicit regulatory
   * statuses such as REFERENCE_REQUIRED, UNAVAILABLE,
   * NOT_APPLICABLE, and AMBIGUOUS.
   */
  if (
    requestedCountry.hasExactMatch
  ) {
    return requestedCountry.result;
  }


  /*
   * SECOND: country fallback.
   *
   * Fallback is attempted only when there is no exact record
   * for the requested country/code.
   */
  if (
    input.origin_country_name !==
    OTHER_TERRITORIES
  ) {
    trace.push({
      step:
        "COUNTRY_FALLBACK",

      outcome:
        `Trying ${OTHER_TERRITORIES}`,
    });


    const fallback =
      resolveForCountry(
        records,
        OTHER_TERRITORIES,
        input,
        normalizedCode,
        trace,
      );


    if (
      fallback.hasExactMatch
    ) {
      /*
       * A usable fallback gets the explicit fallback reason.
       */
      if (
        fallback.result.status ===
        "RESOLVED"
      ) {
        return {
          ...fallback.result,

          reason:
            "OTHER_COUNTRIES_FALLBACK",
        };
      }


      /*
       * Non-usable fallback states remain explicit.
       */
      return fallback.result;
    }
  }


  return unresolvedResult(
    "NO_MATCH",
    trace,
  );
}
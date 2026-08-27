import "server-only";

import type {
  CodeLevel,
  DefaultValueResolutionInput,
  RegulatoryRecord,
  ValueStatus,
} from "../../domain/regulatory/types";

import type {
  RegulatoryRepository,
} from "./regulatory-repository";

import type {
  RegulatoryCountryRow,
  RegulatoryDatasetRow,
  RegulatoryEmissionValueRow,
  RegulatoryGoodRow,
  RegulatoryRouteRow,
} from "./regulatory-database-types";

import {
  getSupabaseClient,
} from "../supabase/client";


const DATASET_TYPE =
  "DEFAULT_EMISSION_VALUES";

const OTHER_TERRITORIES =
  "_Other Countries and Territorie";


function normalizeCode(
  value: string,
): string {
  return value.replace(
    /\s+/g,
    "",
  );
}


function mapCodeLevel(
  tradeCodeType: string,
): CodeLevel {
  switch (tradeCodeType) {
    case "HS_HEADING":
      return "HS4";

    case "HS_SUBHEADING":
      return "HS6";

    case "CN":
      return "CN8";

    case "TARIC":
      return "TARIC10";

    default:
      throw new Error(
        `Unsupported trade code type: ${tradeCodeType}`,
      );
  }
}


function mapValueStatus(
  status: string,
): ValueStatus {
  switch (status) {
    case "AVAILABLE":
      return "AVAILABLE";

    case "UNAVAILABLE":
      return "UNAVAILABLE";

    case "REFERENCE_REQUIRED":
      return "REFERENCE_REQUIRED";

    case "NOT_APPLICABLE":
      return "NOT_APPLICABLE";

    case "SOURCE_TEXT":
      return "SOURCE_TEXT";

    default:
      throw new Error(
        `Unsupported regulatory value status: ${status}`,
      );
  }
}


function toStringOrNull(
  value: unknown,
): string | null {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  return String(value);
}


function mapRecord(
  dataset: RegulatoryDatasetRow,
  country: RegulatoryCountryRow,
  good: RegulatoryGoodRow,
  emission: RegulatoryEmissionValueRow,
  route: RegulatoryRouteRow | null,
): RegulatoryRecord {
  return {
    dataset_id:
      dataset.id,

    dataset_version:
      dataset.version,

    origin_country_name:
      country.name,

    source_sheet:
      emission.source_sheet,

    source_row:
      emission.source_row,

    source_trade_code:
      emission.source_trade_code,

    normalized_trade_code:
      normalizeCode(
        good.trade_code,
      ),

    code_level:
      mapCodeLevel(
        good.trade_code_type,
      ),

    sector:
      good.sector,

    product_name:
      good.description,

    emission_unit:
      emission.emission_unit,

    direct_emissions: {
      value:
        toStringOrNull(
          emission.direct_value,
        ),

      status:
        mapValueStatus(
          emission.direct_status,
        ),

      raw_source_value:
        emission.direct_raw_source_value,
    },

    indirect_emissions: {
      value:
        toStringOrNull(
          emission.indirect_value,
        ),

      status:
        mapValueStatus(
          emission.indirect_status,
        ),

      raw_source_value:
        emission.indirect_raw_source_value,
    },

    total_emissions: {
      value:
        toStringOrNull(
          emission.total_value,
        ),

      status:
        mapValueStatus(
          emission.total_status,
        ),

      raw_source_value:
        emission.total_raw_source_value,
    },

    source_production_route_code:
      route?.source_route_indicator ??
      null,

    production_route:
      route?.name ??
      null,
  };
}


export class SupabaseRegulatoryRepository
  implements RegulatoryRepository
{
  async findActiveDefaultEmissionCandidates(
    input: DefaultValueResolutionInput,
  ): Promise<RegulatoryRecord[]> {
    const supabase =
      getSupabaseClient();

    const requestedCountryName =
      input.origin_country_name;

    const normalizedCode =
      normalizeCode(
        input.trade_code,
      );


    // ========================================================
    // 1. Find the single ACTIVE regulatory dataset
    // ========================================================

    const {
      data: datasetData,
      error: datasetError,
    } = await supabase
      .from(
        "regulatory_datasets",
      )
      .select(
        "id, dataset_type, version, status",
      )
      .eq(
        "dataset_type",
        DATASET_TYPE,
      )
      .eq(
        "status",
        "ACTIVE",
      )
      .limit(2);

    if (datasetError) {
      throw new Error(
        `Failed to load active regulatory dataset: ${datasetError.message}`,
      );
    }

    const datasets =
      (datasetData ?? []) as unknown as RegulatoryDatasetRow[];

    if (
      datasets.length ===
      0
    ) {
      throw new Error(
        "No ACTIVE DEFAULT_EMISSION_VALUES dataset exists.",
      );
    }

    if (
      datasets.length >
      1
    ) {
      throw new Error(
        "More than one ACTIVE DEFAULT_EMISSION_VALUES dataset exists.",
      );
    }

    const dataset =
      datasets[0];

    if (!dataset) {
      throw new Error(
        "Active regulatory dataset could not be resolved.",
      );
    }


    // ========================================================
    // 2. Load requested country + fallback geography
    // ========================================================

    const countryNames =
      requestedCountryName ===
      OTHER_TERRITORIES
        ? [
            requestedCountryName,
          ]
        : [
            requestedCountryName,
            OTHER_TERRITORIES,
          ];

    const {
      data: countryData,
      error: countryError,
    } = await supabase
      .from("countries")
      .select(
        "id, name",
      )
      .in(
        "name",
        countryNames,
      );

    if (countryError) {
      throw new Error(
        `Failed to load regulatory countries: ${countryError.message}`,
      );
    }

    const countries =
      (countryData ?? []) as unknown as RegulatoryCountryRow[];


    const countriesByName =
      new Map<
        string,
        RegulatoryCountryRow
      >();

    const countriesById =
      new Map<
        string,
        RegulatoryCountryRow
      >();

    for (
      const country of countries
    ) {
      if (
        countriesByName.has(
          country.name,
        )
      ) {
        throw new Error(
          `Multiple country rows match ${country.name}`,
        );
      }

      if (
        countriesById.has(
          country.id,
        )
      ) {
        throw new Error(
          `Duplicate regulatory country id ${country.id}`,
        );
      }

      countriesByName.set(
        country.name,
        country,
      );

      countriesById.set(
        country.id,
        country,
      );
    }


    // Rule R7 clause 1: "If the country or territory is not explicitly
    // listed, use the value from: Other countries and territories." An
    // origin country absent from `countriesByName` here is exactly that
    // case -- it must still fall through to whatever candidates were
    // fetched for OTHER_TERRITORIES above, not return early. See
    // docs/adr/ADR-0010-emission-provenance-and-route-contract.md and
    // docs/architecture/REGULATORY_RESOLUTION_RULES.md Rule R7. The
    // resolver (src/domain/regulatory/resolve-default-value.ts) already
    // implements the fallback correctly given those candidates; this
    // adapter's job is only to fetch them, never to pre-filter by
    // whether the requested country happens to be known.


    const candidateCountryIds =
      countries.map(
        (country) =>
          country.id,
      );

    if (
      candidateCountryIds.length ===
      0
    ) {
      return [];
    }


    // ========================================================
    // 3. Resolve exact trade-code candidates
    // ========================================================

    const {
      data: goodData,
      error: goodError,
    } = await supabase
      .from(
        "cbam_goods",
      )
      .select(
        "id, trade_code, trade_code_type, record_level, sector, description",
      )
      .eq(
        "trade_code",
        normalizedCode,
      )
      .limit(100);

    if (goodError) {
      throw new Error(
        `Failed to load CBAM goods: ${goodError.message}`,
      );
    }

    const goods =
      (goodData ?? []) as unknown as RegulatoryGoodRow[];

    if (
      goods.length ===
      0
    ) {
      return [];
    }


    const goodIds =
      goods.map(
        (good) =>
          good.id,
      );

    if (
      goodIds.length ===
      0
    ) {
      return [];
    }


    // ========================================================
    // 4. Load all matching active emission records
    //    for requested country + fallback geography
    // ========================================================

    const {
      data: emissionData,
      error: emissionError,
    } = await supabase
      .from(
        "default_emission_values",
      )
      .select(
        `
          dataset_id,
          good_id,
          country_id,

          direct_value,
          direct_status,
          direct_raw_source_value,

          indirect_value,
          indirect_status,
          indirect_raw_source_value,

          total_value,
          total_status,
          total_raw_source_value,

          production_route_id,

          source_sheet,
          source_row,
          source_trade_code,

          emission_unit
        `,
      )
      .eq(
        "dataset_id",
        dataset.id,
      )
      .in(
        "country_id",
        candidateCountryIds,
      )
      .in(
        "good_id",
        goodIds,
      )
      .limit(1000);

    if (emissionError) {
      throw new Error(
        `Failed to load regulatory emission values: ${emissionError.message}`,
      );
    }

    const emissions =
      (emissionData ?? []) as unknown as RegulatoryEmissionValueRow[];

    if (
      emissions.length ===
      0
    ) {
      return [];
    }


    // ========================================================
    // 5. Load route definitions used by candidates
    // ========================================================

    const routeIds =
      [
        ...new Set(
          emissions
            .map(
              (emission) =>
                emission.production_route_id,
            )
            .filter(
              (
                routeId,
              ): routeId is string =>
                routeId !== null,
            ),
        ),
      ];


    const routesById =
      new Map<
        string,
        RegulatoryRouteRow
      >();


    if (
      routeIds.length >
      0
    ) {
      const {
        data: routeData,
        error: routeError,
      } = await supabase
        .from(
          "production_routes",
        )
        .select(
          "id, name, source_route_indicator",
        )
        .in(
          "id",
          routeIds,
        );

      if (routeError) {
        throw new Error(
          `Failed to load production routes: ${routeError.message}`,
        );
      }

      const routes =
        (routeData ?? []) as unknown as RegulatoryRouteRow[];

      for (
        const route of routes
      ) {
        if (
          routesById.has(
            route.id,
          )
        ) {
          throw new Error(
            `Duplicate production route id ${route.id}`,
          );
        }

        routesById.set(
          route.id,
          route,
        );
      }
    }


    // ========================================================
    // 6. Map database rows to domain records
    // ========================================================

    return emissions.map(
      (emission) => {
        const good =
          goods.find(
            (candidate) =>
              candidate.id ===
              emission.good_id,
          );

        if (!good) {
          throw new Error(
            `Emission record references unknown CBAM good ${emission.good_id}`,
          );
        }


        const country =
          countriesById.get(
            emission.country_id,
          );

        if (!country) {
          throw new Error(
            `Emission record references unknown country ${emission.country_id}`,
          );
        }


        const route =
          emission.production_route_id
            ? routesById.get(
                emission.production_route_id,
              ) ?? null
            : null;


        if (
          emission.production_route_id !==
            null
          && route === null
        ) {
          throw new Error(
            `Emission record references unknown production route ${emission.production_route_id}`,
          );
        }


        return mapRecord(
          dataset,
          country,
          good,
          emission,
          route,
        );
      },
    );
  }
}
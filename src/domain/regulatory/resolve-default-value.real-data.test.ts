import {
  describe,
  expect,
  it,
} from "vitest";

import {
  readFileSync,
} from "node:fs";

import {
  resolveDefaultValue,
} from "./resolve-default-value.js";

import type {
  RegulatoryRecord,
} from "./types.js";

const DATASET_PATH =
  "data/processed/default-emission-values-definitive.json";

const OTHER_COUNTRIES_NAME =
  "_Other Countries and Territorie";

function loadDataset(): RegulatoryRecord[] {
  const raw = readFileSync(
    DATASET_PATH,
    "utf-8",
  );

  return JSON.parse(
    raw,
  ) as RegulatoryRecord[];
}

const records = loadDataset();

describe(
  "resolveDefaultValue against definitive dataset",
  () => {
    it(
      "contains the expected India CN8 record",
      () => {
        const matches =
          records.filter(
            (record) =>
              record.origin_country_name ===
                "India"
              && record.normalized_trade_code ===
                "72061000",
          );

        expect(
          matches.length,
        ).toBeGreaterThan(0);

        expect(
          matches.some(
            (record) =>
              record.code_level ===
              "CN8",
          ),
        ).toBe(true);
      },
    );

    it(
      "resolves India 72061000",
      () => {
        const result =
          resolveDefaultValue(
            records,
            {
              origin_country_name:
                "India",

              trade_code:
                "72061000",

              production_route:
                "(C)",
            },
          );

        expect(
          result.status,
        ).toBe(
          "RESOLVED",
        );

        expect(
          result.record
            ?.normalized_trade_code,
        ).toBe(
          "72061000",
        );

        expect(
          result.record
            ?.total_emissions.status,
        ).toBe(
          "AVAILABLE",
        );
      },
    );

    it(
      "resolves India 31021012",
      () => {
        const result =
          resolveDefaultValue(
            records,
            {
              origin_country_name:
                "India",

              trade_code:
                "31021012",
            },
          );

        expect(
          result.status,
        ).toBe(
          "RESOLVED",
        );

        expect(
          result.record
            ?.normalized_trade_code,
        ).toBe(
          "31021012",
        );

        expect(
          result.record
            ?.total_emissions.value,
        ).toBe(
          "0.740",
        );
      },
    );

    it(
      "finds the India TARIC record",
      () => {
        const matches =
          records.filter(
            (record) =>
              record.origin_country_name ===
                "India"
              && record.normalized_trade_code ===
                "2507008080",
          );

        expect(
          matches.length,
        ).toBe(1);

        expect(
          matches[0]
            ?.code_level,
        ).toBe(
          "TARIC10",
        );
      },
    );

    it(
      "preserves the India 3102 reference row",
      () => {
        const matches =
          records.filter(
            (record) =>
              record.origin_country_name ===
                "India"
              && record.normalized_trade_code ===
                "3102"
              && record.code_level ===
                "HS4",
          );

        expect(
          matches.length,
        ).toBe(1);

        expect(
          matches[0]
            ?.total_emissions.status,
        ).toBe(
          "REFERENCE_REQUIRED",
        );

        expect(
          matches[0]
            ?.total_emissions
            .raw_source_value,
        ).toBe(
          "see below",
        );
      },
    );

    it(
      "uses the real Other Countries and Territories fallback for an unavailable country value",
      () => {
        const fallbackByCode =
          new Map<
            string,
            RegulatoryRecord
          >();

        for (const record of records) {
          if (
            record.origin_country_name ===
              OTHER_COUNTRIES_NAME
            && record.total_emissions
                .status === "AVAILABLE"
            && record.total_emissions
                .value !== null
          ) {
            fallbackByCode.set(
              record.normalized_trade_code,
              record,
            );
          }
        }

        let candidate:
          | {
              countryRecord: RegulatoryRecord;
              fallbackRecord: RegulatoryRecord;
            }
          | undefined;

        for (const record of records) {
          if (
            record.origin_country_name ===
              OTHER_COUNTRIES_NAME
          ) {
            continue;
          }

          if (
            record.total_emissions
                .status !==
              "UNAVAILABLE"
          ) {
            continue;
          }

          const fallback =
            fallbackByCode.get(
              record.normalized_trade_code,
            );

          if (!fallback) {
            continue;
          }

          candidate = {
            countryRecord: record,
            fallbackRecord: fallback,
          };

          break;
        }

        expect(
          candidate,
        ).toBeDefined();

        if (!candidate) {
          throw new Error(
            "No real unavailable/fallback dataset pair was found",
          );
        }

        const result =
          resolveDefaultValue(
            records,
            {
              origin_country_name:
                candidate
                  .countryRecord
                  .origin_country_name,

              trade_code:
                candidate
                  .countryRecord
                  .normalized_trade_code,
            },
          );

        expect(
          result.status,
        ).toBe(
          "RESOLVED",
        );

        expect(
          result.reason,
        ).toBe(
          "OTHER_COUNTRIES_FALLBACK",
        );

        expect(
          result.record
            ?.origin_country_name,
        ).toBe(
          OTHER_COUNTRIES_NAME,
        );

        expect(
          result.record
            ?.normalized_trade_code,
        ).toBe(
          candidate
            .fallbackRecord
            .normalized_trade_code,
        );

        expect(
          result.record
            ?.total_emissions.value,
        ).toBe(
          candidate
            .fallbackRecord
            .total_emissions
            .value,
        );
      },
    );

    it(
      "uses the real fallback table for an unknown origin country",
      () => {
        const fallback =
          records.find(
            (record) =>
              record.origin_country_name ===
                OTHER_COUNTRIES_NAME
              && record.total_emissions
                  .status ===
                "AVAILABLE",
          );

        expect(
          fallback,
        ).toBeDefined();

        if (!fallback) {
          throw new Error(
            "No usable fallback record found",
          );
        }

        const result =
          resolveDefaultValue(
            records,
            {
              origin_country_name:
                "ZZ-UNKNOWN",

              trade_code:
                fallback
                  .normalized_trade_code,
            },
          );

        expect(
          result.status,
        ).toBe(
          "RESOLVED",
        );

        expect(
          result.reason,
        ).toBe(
          "OTHER_COUNTRIES_FALLBACK",
        );

        expect(
          result.record
            ?.origin_country_name,
        ).toBe(
          OTHER_COUNTRIES_NAME,
        );
      },
    );
  },
);
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
        ).toBe("RESOLVED");

        expect(
          result.reason,
        ).toBe(
          "EXACT_CN8_MATCH",
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
        ).toBe("RESOLVED");

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
      "does not convert unavailable TARIC to zero",
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

        const sourceRecord =
          matches[0];

        if (!sourceRecord) {
          throw new Error(
            "Expected India 2507008080 record",
          );
        }

        const result =
          resolveDefaultValue(
            records,
            {
              origin_country_name:
                "India",

              trade_code:
                "2507008080",
            },
          );

        if (
          sourceRecord
            .total_emissions
            .status ===
          "UNAVAILABLE"
        ) {
          expect(
            result.status,
          ).toBe(
            "UNRESOLVED",
          );

          expect(
            result.reason,
          ).toBe(
            "UNAVAILABLE",
          );
        }
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
            ?.direct_emissions
            .status,
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
  },
);
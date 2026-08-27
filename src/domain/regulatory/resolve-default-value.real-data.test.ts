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

interface DatasetFileRecord {
  dataset_id: string;

  origin_country_name: string;
  source_sheet: string;
  source_row: number;

  source_trade_code: string;
  normalized_trade_code: string;
  code_level:
    | "HS4"
    | "HS6"
    | "CN8"
    | "TARIC10";

  sector: string;
  product_name: string;

  emission_unit: string;

  direct_emissions: {
    value: string | null;
    status:
      | "AVAILABLE"
      | "UNAVAILABLE"
      | "REFERENCE_REQUIRED"
      | "NOT_APPLICABLE"
      | "SOURCE_TEXT";
    raw_source_value: string | null;
  };

  indirect_emissions: {
    value: string | null;
    status:
      | "AVAILABLE"
      | "UNAVAILABLE"
      | "REFERENCE_REQUIRED"
      | "NOT_APPLICABLE"
      | "SOURCE_TEXT";
    raw_source_value: string | null;
  };

  total_emissions: {
    value: string | null;
    status:
      | "AVAILABLE"
      | "UNAVAILABLE"
      | "REFERENCE_REQUIRED"
      | "NOT_APPLICABLE"
      | "SOURCE_TEXT";
    raw_source_value: string | null;
  };

  source_production_route_code: string | null;
  production_route: string | null;
}

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
              origin_country:
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
          result.record
            ?.normalized_trade_code,
        ).toBe("72061000");

        expect(
          result.record
            ?.total_emissions.status,
        ).toBe("AVAILABLE");
      },
    );

    it(
      "resolves India 31021012",
      () => {
        const result =
          resolveDefaultValue(
            records,
            {
              origin_country:
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
        ).toBe("31021012");

        expect(
          result.record
            ?.total_emissions.value,
        ).toBe("0.740");
      },
    );

    it(
      "finds the TARIC product in India",
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
          matches[0]?.code_level,
        ).toBe("TARIC10");
      },
    );

    it(
      "does not convert an unavailable TARIC value to zero",
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

        const record = matches[0];

        if (!record) {
          throw new Error(
            "Expected India 2507008080 record",
          );
        }

        const totalStatus =
          record.total_emissions.status;

        const result =
          resolveDefaultValue(
            records,
            {
              origin_country:
                "India",
              trade_code:
                "2507008080",
            },
          );

        if (
          totalStatus ===
          "UNAVAILABLE"
        ) {
          expect(
            result.status,
          ).toBe("UNRESOLVED");
        }
      },
    );

    it(
      "preserves the 3102 reference row",
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
            ?.direct_emissions.status,
        ).toBe(
          "REFERENCE_REQUIRED",
        );

        expect(
          matches[0]
            ?.total_emissions.raw_source_value,
        ).toBe("see below");
      },
    );
  },
);
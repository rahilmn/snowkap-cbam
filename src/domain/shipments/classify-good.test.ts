import {
  describe,
  expect,
  it,
} from "vitest";

import {
  classifyGood,
  requiredQuantityKind,
  validateCnCodeFormat,
} from "./classify-good";

import type {
  CbamGoodSummary,
} from "../regulatory/types";

const cementGood: CbamGoodSummary =
  {
    trade_code: "25232100",
    trade_code_type: "CN",
    record_level: "TRADE_GOOD",
    sector: "CEMENT",
    description: "Portland cement",
    functional_unit: "TONNES",
  };

const electricityGood: CbamGoodSummary =
  {
    ...cementGood,
    trade_code: "27160000",
    sector: "ELECTRICITY",
    functional_unit: "MWH",
  };

describe(
  "validateCnCodeFormat",
  () => {
    it(
      "accepts an 8-digit code as CN8",
      () => {
        expect(
          validateCnCodeFormat(
            "25232100",
          ),
        ).toEqual(
          { status: "OK", level: "CN8" },
        );
      },
    );

    it(
      "accepts a 10-digit code as TARIC10",
      () => {
        expect(
          validateCnCodeFormat(
            "2523210099",
          ),
        ).toEqual(
          { status: "OK", level: "TARIC10" },
        );
      },
    );

    it(
      "rejects a 6-digit code",
      () => {
        expect(
          validateCnCodeFormat(
            "252321",
          ),
        ).toEqual(
          { status: "INVALID_FORMAT" },
        );
      },
    );

    it(
      "rejects non-digit characters",
      () => {
        expect(
          validateCnCodeFormat(
            "2523210A",
          ),
        ).toEqual(
          { status: "INVALID_FORMAT" },
        );
      },
    );

    it(
      "rejects an empty string",
      () => {
        expect(
          validateCnCodeFormat(
            "",
          ),
        ).toEqual(
          { status: "INVALID_FORMAT" },
        );
      },
    );
  },
);

describe(
  "classifyGood",
  () => {
    it(
      "returns VALID with the single matching good",
      () => {
        expect(
          classifyGood(
            [cementGood],
          ),
        ).toEqual(
          { status: "VALID", good: cementGood },
        );
      },
    );

    it(
      "returns UNSUPPORTED_CODE when nothing matches",
      () => {
        expect(
          classifyGood(
            [],
          ),
        ).toEqual(
          { status: "UNSUPPORTED_CODE" },
        );
      },
    );

    it(
      "returns AMBIGUOUS with every candidate when more than one matches",
      () => {
        const duplicateGood: CbamGoodSummary =
          {
            ...cementGood,
            description: "Portland cement (duplicate row)",
          };

        expect(
          classifyGood(
            [cementGood, duplicateGood],
          ),
        ).toEqual(
          { status: "AMBIGUOUS", candidates: [cementGood, duplicateGood] },
        );
      },
    );
  },
);

describe(
  "requiredQuantityKind",
  () => {
    it(
      "requires MASS for a TONNES-unit good",
      () => {
        expect(
          requiredQuantityKind(
            cementGood,
          ),
        ).toBe(
          "MASS",
        );
      },
    );

    it(
      "requires ENERGY for an MWH-unit good",
      () => {
        expect(
          requiredQuantityKind(
            electricityGood,
          ),
        ).toBe(
          "ENERGY",
        );
      },
    );
  },
);

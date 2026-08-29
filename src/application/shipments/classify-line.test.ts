import {
  describe,
  expect,
  it,
} from "vitest";

import {
  classifyLine,
} from "./classify-line";

import type {
  RegulatoryRepository,
} from "../../infrastructure/regulatory/regulatory-repository";

import type {
  CbamGoodSummary,
} from "../../domain/regulatory/types";

const cementGood: CbamGoodSummary =
  {
    trade_code: "25232100",
    trade_code_type: "CN",
    record_level: "TRADE_GOOD",
    sector: "CEMENT",
    description: "Portland cement",
    functional_unit: "TONNES",
  };

function mockRepository(
  candidates: CbamGoodSummary[],
): RegulatoryRepository {
  return {
    findActiveDefaultEmissionCandidates: () =>
      Promise.resolve(
        [],
      ),

    findCbamGoodsByCode: () =>
      Promise.resolve(
        candidates,
      ),

    searchCbamGoodsByPrefix: () =>
      Promise.resolve(
        [],
      ),

    searchCbamGoodsByText: () =>
      Promise.resolve(
        [],
      ),

    findProductionRoutes: () =>
      Promise.resolve(
        [],
      ),
  };
}

describe(
  "classifyLine",
  () => {
    it(
      "returns INVALID_FORMAT without querying the repository",
      async () => {
        let queried =
          false;

        const repository =
          mockRepository(
            [cementGood],
          );

        repository.findCbamGoodsByCode =
          () => {
            queried = true;

            return Promise.resolve(
              [cementGood],
            );
          };

        const result =
          await classifyLine(
            repository,
            "not-a-code",
            "2026-03-15",
          );

        expect(result).toEqual(
          { status: "INVALID_FORMAT" },
        );

        expect(queried).toBe(
          false,
        );
      },
    );

    it(
      "returns VALID with the good, level, and required quantity kind",
      async () => {
        const result =
          await classifyLine(
            mockRepository(
              [cementGood],
            ),
            "25232100",
            "2026-03-15",
          );

        expect(result).toEqual(
          {
            status: "VALID",
            good: cementGood,
            level: "CN8",
            requiredQuantityKind: "MASS",
          },
        );
      },
    );

    it(
      "returns UNSUPPORTED_CODE when the repository finds nothing",
      async () => {
        const result =
          await classifyLine(
            mockRepository(
              [],
            ),
            "99999999",
            "2026-03-15",
          );

        expect(result).toEqual(
          { status: "UNSUPPORTED_CODE" },
        );
      },
    );

    it(
      "returns AMBIGUOUS with every candidate when more than one matches",
      async () => {
        const duplicate =
          {
            ...cementGood,
            description: "duplicate row",
          };

        const result =
          await classifyLine(
            mockRepository(
              [cementGood, duplicate],
            ),
            "25232100",
            "2026-03-15",
          );

        expect(result).toEqual(
          { status: "AMBIGUOUS", candidates: [cementGood, duplicate] },
        );
      },
    );

    it(
      "recognizes a 10-digit code as TARIC10",
      async () => {
        const tenDigitGood =
          {
            ...cementGood,
            trade_code: "2523210099",
            trade_code_type: "TARIC",
          };

        const result =
          await classifyLine(
            mockRepository(
              [tenDigitGood],
            ),
            "2523210099",
            "2026-03-15",
          );

        expect(result).toMatchObject(
          { status: "VALID", level: "TARIC10" },
        );
      },
    );
  },
);

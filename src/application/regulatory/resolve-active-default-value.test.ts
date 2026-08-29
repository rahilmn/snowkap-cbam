import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// This orchestration wrapper (resolveActiveDefaultValue) has two callers
// wired together -- the RegulatoryRepository port and the domain's own
// resolveDefaultValue -- and each already has its own dedicated test
// suite (supabase-regulatory-repository.test.ts and
// resolve-default-value.test.ts respectively). This file only tests the
// wiring itself: that the repository's candidates and the original input
// reach resolveDefaultValue unmodified, and that whatever it returns is
// passed back unmodified. The real resolveDefaultValue is mocked out at
// the module boundary so this suite can never depend on -- or
// accidentally exercise -- actual regulatory resolution logic.

const resolveDefaultValueMock =
  vi.fn();

vi.mock(
  "../../domain/regulatory/resolve-default-value",
  () => (
    {
      resolveDefaultValue: (
        ...args: unknown[]
      ) => resolveDefaultValueMock(...args),
    }
  ),
);

const {
  resolveActiveDefaultValue,
} = await import("./resolve-active-default-value");

import type {
  DefaultValueResolutionInput,
  DefaultValueResolutionResult,
  RegulatoryRecord,
} from "../../domain/regulatory/types";

import type {
  RegulatoryRepository,
} from "../../infrastructure/regulatory/regulatory-repository";

function mockRepository(
  findActiveDefaultEmissionCandidates: RegulatoryRepository["findActiveDefaultEmissionCandidates"],
): RegulatoryRepository {
  return {
    findActiveDefaultEmissionCandidates,

    findCbamGoodsByCode: () =>
      Promise.resolve(
        [],
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

const input: DefaultValueResolutionInput =
  {
    origin_country_name: "China",
    trade_code: "25232100",
    production_route: null,
  };

const record: RegulatoryRecord =
  {
    dataset_id: "dataset-1",
    dataset_version: "2026-definitive-corrected",
    origin_country_name: "China",
    source_sheet: "Cement",
    source_row: 42,
    source_trade_code: "25232100",
    normalized_trade_code: "25232100",
    code_level: "CN8",
    sector: "CEMENT",
    product_name: "Cement clinker",
    emission_unit: "tCO2e/t",
    direct_emissions: { value: "0.8", status: "AVAILABLE", raw_source_value: "0.8" },
    indirect_emissions: { value: "0.1", status: "AVAILABLE", raw_source_value: "0.1" },
    total_emissions: { value: "0.9", status: "AVAILABLE", raw_source_value: "0.9" },
    source_production_route_code: null,
    production_route: null,
  };

const resolvedResult: DefaultValueResolutionResult =
  {
    status: "RESOLVED",
    reason: "EXACT_CN8_MATCH",
    record,
    trace: [{ step: "match", outcome: "found" }],
  };

afterEach(() => {
  vi.clearAllMocks();
});

describe(
  "resolveActiveDefaultValue",
  () => {
    it(
      "calls the repository with exactly the input it was given",
      async () => {
        resolveDefaultValueMock.mockReturnValueOnce(
          resolvedResult,
        );

        const findActiveDefaultEmissionCandidates =
          vi.fn(
            () => Promise.resolve([record]),
          );

        await resolveActiveDefaultValue(
          mockRepository(
            findActiveDefaultEmissionCandidates,
          ),
          input,
        );

        expect(findActiveDefaultEmissionCandidates).toHaveBeenCalledTimes(
          1,
        );

        expect(findActiveDefaultEmissionCandidates).toHaveBeenCalledWith(
          input,
        );
      },
    );

    it(
      "calls resolveDefaultValue with exactly the records the repository resolved plus the original input",
      async () => {
        resolveDefaultValueMock.mockReturnValueOnce(
          resolvedResult,
        );

        const candidates =
          [record];

        await resolveActiveDefaultValue(
          mockRepository(
            () => Promise.resolve(candidates),
          ),
          input,
        );

        expect(resolveDefaultValueMock).toHaveBeenCalledTimes(
          1,
        );

        expect(resolveDefaultValueMock).toHaveBeenCalledWith(
          candidates,
          input,
        );
      },
    );

    it(
      "returns exactly whatever resolveDefaultValue returned, unmodified",
      async () => {
        resolveDefaultValueMock.mockReturnValueOnce(
          resolvedResult,
        );

        const result =
          await resolveActiveDefaultValue(
            mockRepository(
              () => Promise.resolve([record]),
            ),
            input,
          );

        expect(result).toBe(
          resolvedResult,
        );
      },
    );

    it(
      "passes an empty candidate array straight through to resolveDefaultValue, without filtering or short-circuiting it",
      async () => {
        const unresolvedResult: DefaultValueResolutionResult =
          {
            status: "UNRESOLVED",
            reason: "NO_MATCH",
            record: null,
            trace: [],
          };

        resolveDefaultValueMock.mockReturnValueOnce(
          unresolvedResult,
        );

        const result =
          await resolveActiveDefaultValue(
            mockRepository(
              () => Promise.resolve([]),
            ),
            input,
          );

        expect(resolveDefaultValueMock).toHaveBeenCalledWith(
          [],
          input,
        );

        expect(result).toBe(
          unresolvedResult,
        );
      },
    );
  },
);

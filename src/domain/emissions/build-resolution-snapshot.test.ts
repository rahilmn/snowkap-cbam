import { describe, expect, it } from "vitest";

import type {
  DefaultValueResolutionResult,
  RegulatoryRecord,
  RegulatoryValue,
} from "../regulatory/types";

import type {
  IsoTimestamp,
} from "../shared/reporting-period";

import {
  buildResolutionSnapshot,
} from "./build-resolution-snapshot";

const RESOLVED_AT =
  "2026-08-28T12:00:00.000Z" as IsoTimestamp;

function availableValue(
  value: string,
): RegulatoryValue {
  return {
    value,
    status: "AVAILABLE",
    raw_source_value: value,
  };
}

function unavailableValue(): RegulatoryValue {
  return {
    value: null,
    status: "UNAVAILABLE",
    raw_source_value: null,
  };
}

function record(
  overrides: Partial<RegulatoryRecord> = {},
): RegulatoryRecord {
  return {
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
    direct_emissions: availableValue("0.8"),
    indirect_emissions: availableValue("0.1"),
    total_emissions: availableValue("0.9"),
    source_production_route_code: null,
    production_route: null,
    ...overrides,
  };
}

describe("buildResolutionSnapshot", () => {
  it("builds a snapshot from a RESOLVED exact match with a MAPPED country", () => {
    const result: DefaultValueResolutionResult = {
      status: "RESOLVED",
      reason: "EXACT_CN8_MATCH",
      record: record(),
      trace: [
        { step: "NORMALIZE_CODE", outcome: "25232100" },
      ],
    };

    const snapshot =
      buildResolutionSnapshot(
        result,
        { status: "MAPPED", regulatory_country_name: "China" },
        RESOLVED_AT,
      );

    expect(snapshot).not.toBeNull();
    expect(snapshot?.dataset_id).toBe("dataset-1");
    expect(snapshot?.dataset_version).toBe("2026-definitive-corrected");
    expect(snapshot?.resolved_at).toBe(RESOLVED_AT);
    expect(snapshot?.reason).toBe("EXACT_CN8_MATCH");
    expect(snapshot?.country_mapping).toEqual({
      status: "MAPPED",
      regulatory_country_name: "China",
    });
    expect(snapshot?.record_identity).toEqual({
      source_sheet: "Cement",
      source_row: 42,
      source_trade_code: "25232100",
      origin_country_name: "China",
      source_production_route_code: null,
    });
    expect(snapshot?.values.direct).toEqual(availableValue("0.8"));
    expect(snapshot?.values.indirect).toEqual(availableValue("0.1"));
    expect(snapshot?.values.total).toEqual(availableValue("0.9"));
    expect(snapshot?.emission_unit).toBe("tCO2e/t");
    expect(snapshot?.trace).toEqual(result.trace);
  });

  it("builds a snapshot from an OTHER_COUNTRIES_FALLBACK resolution with an UNLISTED country", () => {
    const result: DefaultValueResolutionResult = {
      status: "RESOLVED",
      reason: "OTHER_COUNTRIES_FALLBACK",
      record: record({
        origin_country_name: "_Other Countries and Territorie",
      }),
      trace: [],
    };

    const snapshot =
      buildResolutionSnapshot(
        result,
        { status: "UNLISTED" },
        RESOLVED_AT,
      );

    expect(snapshot).not.toBeNull();
    expect(snapshot?.reason).toBe("OTHER_COUNTRIES_FALLBACK");
    expect(snapshot?.country_mapping).toEqual({ status: "UNLISTED" });
    expect(snapshot?.record_identity.origin_country_name).toBe(
      "_Other Countries and Territorie",
    );
  });

  it("preserves a per-value UNAVAILABLE status on an otherwise-usable RESOLVED record", () => {
    const result: DefaultValueResolutionResult = {
      status: "RESOLVED",
      reason: "EXACT_CN8_MATCH",
      record: record({
        direct_emissions: unavailableValue(),
      }),
      trace: [],
    };

    const snapshot =
      buildResolutionSnapshot(
        result,
        { status: "MAPPED", regulatory_country_name: "China" },
        RESOLVED_AT,
      );

    expect(snapshot?.values.direct.status).toBe("UNAVAILABLE");
    expect(snapshot?.values.total.status).toBe("AVAILABLE");
  });

  it.each([
    "REFERENCE_REQUIRED",
    "UNAVAILABLE",
    "NOT_APPLICABLE",
    "AMBIGUOUS",
    "NO_MATCH",
  ] as const)(
    "returns null for an UNRESOLVED result with reason %s",
    (reason) => {
      const result: DefaultValueResolutionResult = {
        status: "UNRESOLVED",
        reason,
        record: null,
        trace: [{ step: "X", outcome: reason }],
      };

      const snapshot =
        buildResolutionSnapshot(
          result,
          { status: "MAPPED", regulatory_country_name: "China" },
          RESOLVED_AT,
        );

      expect(snapshot).toBeNull();
    },
  );
});

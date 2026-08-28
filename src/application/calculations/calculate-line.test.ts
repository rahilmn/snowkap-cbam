import {
  describe,
  expect,
  it,
} from "vitest";

import {
  calculateLine,
} from "./calculate-line";

const orgId =
  "org-1" as never;

const actorUserId =
  "user-1" as never;

const lineId =
  "line-1" as never;

const computedDetermination =
  {
    method: "DEFAULT",
    resolution: {
      dataset_id: "dataset-1",
      dataset_version: "2026-definitive-corrected",
      resolved_at: "2026-08-28T00:00:00.000Z",
      reason: "EXACT_CN8_MATCH",
      country_mapping: { status: "MAPPED", regulatory_country_name: "China" },
      record_identity: {
        source_sheet: "Cement",
        source_row: 42,
        source_trade_code: "25232100",
        origin_country_name: "China",
        source_production_route_code: null,
      },
      values: {
        direct: { value: "1.250", status: "AVAILABLE", raw_source_value: "1.250" },
        indirect: { value: "0.140", status: "AVAILABLE", raw_source_value: "0.140" },
        total: { value: "1.390", status: "AVAILABLE", raw_source_value: "1.390" },
      },
      emission_unit: "TCO2E_PER_TONNE",
      trace: [],
    },
  };

function mockSupabase(
  {
    lineFetchResult = {
      data: {
        org_id: "org-1",
        shipment_id: "ship-1",
        net_mass_tonnes: "10.5",
        quantity_mwh: null,
        emission_determination: computedDetermination,
      },
      error: null,
    },
    insertResult = { error: null },
    insertPayloads = [] as unknown[],
  }: {
    lineFetchResult?: { data: unknown; error: unknown };
    insertResult?: { error: unknown };
    insertPayloads?: unknown[];
  },
) {
  return {
    from: (
      table: string,
    ) => {
      if (table === "audit_events") {
        return {
          insert: () =>
            Promise.resolve(
              { error: null },
            ),
        };
      }

      if (table === "calculation_results") {
        return {
          insert: (
            payload: unknown,
          ) => {
            insertPayloads.push(
              payload,
            );

            return Promise.resolve(
              insertResult,
            );
          },
        };
      }

      return {
        select: () => (
          {
            eq: () => (
              {
                maybeSingle: () =>
                  Promise.resolve(
                    lineFetchResult,
                  ),
              }
            ),
          }
        ),
      };
    },
  } as never;
}

describe(
  "calculateLine",
  () => {
    it(
      "computes and persists a COMPUTED result",
      async () => {
        const insertPayloads: unknown[] =
          [];

        const result =
          await calculateLine(
            mockSupabase(
              { insertPayloads },
            ),
            orgId,
            actorUserId,
            lineId,
          );

        expect(result.status).toBe(
          "OK",
        );

        expect(
          result.status === "OK" ? result.calculation.status : null,
        ).toBe(
          "COMPUTED",
        );

        expect(insertPayloads).toHaveLength(
          1,
        );

        expect(insertPayloads[0]).toMatchObject(
          {
            org_id: "org-1",
            line_id: "line-1",
            shipment_id: "ship-1",
            quantity: "10.5",
            quantity_unit: "TONNES",
            embedded_emissions_tco2e: "14.595",
          },
        );
      },
    );

    it(
      "returns INPUT_UNRESOLVED without persisting anything when the line has no determination",
      async () => {
        const insertPayloads: unknown[] =
          [];

        const result =
          await calculateLine(
            mockSupabase(
              {
                lineFetchResult: {
                  data: {
                    org_id: "org-1",
                    shipment_id: "ship-1",
                    net_mass_tonnes: "10.5",
                    quantity_mwh: null,
                    emission_determination: null,
                  },
                  error: null,
                },
                insertPayloads,
              },
            ),
            orgId,
            actorUserId,
            lineId,
          );

        expect(result).toEqual(
          {
            status: "OK",
            calculation: {
              status: "INPUT_UNRESOLVED",
              engine_version: "1.0.0",
            },
          },
        );

        expect(insertPayloads).toHaveLength(
          0,
        );
      },
    );

    it(
      "reports LINE_NOT_FOUND when the line doesn't exist",
      async () => {
        const result =
          await calculateLine(
            mockSupabase(
              { lineFetchResult: { data: null, error: null } },
            ),
            orgId,
            actorUserId,
            lineId,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "LINE_NOT_FOUND" },
        );
      },
    );

    it(
      "rejects LINE_NOT_FOUND when the line belongs to a different org than the caller's active org",
      async () => {
        const insertPayloads: unknown[] =
          [];

        const result =
          await calculateLine(
            mockSupabase(
              {
                lineFetchResult: {
                  data: {
                    org_id: "org-2",
                    shipment_id: "ship-1",
                    net_mass_tonnes: "10.5",
                    quantity_mwh: null,
                    emission_determination: computedDetermination,
                  },
                  error: null,
                },
                insertPayloads,
              },
            ),
            orgId,
            actorUserId,
            lineId,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "LINE_NOT_FOUND" },
        );

        expect(insertPayloads).toHaveLength(
          0,
        );
      },
    );

    it(
      "reports PERSIST_FAILED when the insert fails",
      async () => {
        const result =
          await calculateLine(
            mockSupabase(
              { insertResult: { error: { message: "db error" } } },
            ),
            orgId,
            actorUserId,
            lineId,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "PERSIST_FAILED" },
        );
      },
    );
  },
);

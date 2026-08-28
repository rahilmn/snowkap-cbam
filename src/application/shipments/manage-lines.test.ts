import {
  describe,
  expect,
  it,
} from "vitest";

import {
  addLine,
  removeLine,
  updateLine,
} from "./manage-lines";

import type {
  RegulatoryRepository,
} from "../../infrastructure/regulatory/regulatory-repository";

import type {
  CbamGoodSummary,
} from "../../domain/regulatory/types";

const orgId =
  "org-1" as never;

const actorUserId =
  "user-1" as never;

const shipmentId =
  "ship-1" as never;

const lineId =
  "line-1" as never;

const cementGood: CbamGoodSummary =
  {
    trade_code: "25232100",
    trade_code_type: "CN",
    record_level: "TRADE_GOOD",
    sector: "CEMENT",
    description: "Portland cement",
    functional_unit: "TONNES",
  };

const validInput =
  {
    cnCode: "25232100",
    goodsDescription: "Portland cement",
    originCountry: "DE",
    quantity: { kind: "MASS" as const, value: "10.5" },
    productionRouteName: null,
  };

const lineRow =
  {
    id: "line-1",
    shipment_id: "ship-1",
    org_id: "org-1",
    line_number: 1,
    cn_code: "25232100",
    cn_code_level: "CN8",
    goods_description: "Portland cement",
    origin_country: "DE",
    net_mass_tonnes: "10.5",
    quantity_mwh: null,
    production_route_name: null,
    production_route_indicator: null,
    emission_determination: null,
  };

function mockRepository(
  goods: CbamGoodSummary[] = [cementGood],
): RegulatoryRepository {
  return {
    findActiveDefaultEmissionCandidates: () =>
      Promise.resolve(
        [],
      ),

    findCbamGoodsByCode: () =>
      Promise.resolve(
        goods,
      ),

    searchCbamGoodsByPrefix: () =>
      Promise.resolve(
        [],
      ),

    findProductionRoutes: () =>
      Promise.resolve(
        [],
      ),
  };
}

function mockSupabase(
  {
    shipmentResult = { data: { release_date: "2026-03-15" }, error: null },
    lineFetchResult = {
      data: { org_id: "org-1", shipment_id: "ship-1", shipments: { release_date: "2026-03-15" } },
      error: null,
    },
    // Separate from lineFetchResult -- removeLine's ownership pre-check
    // selects only "org_id" (see the comment on removeLine itself), so
    // the mock's select() below branches on the requested columns rather
    // than reusing whichever result updateLine's broader fetch expects.
    ownerFetchResult = { data: { org_id: "org-1" }, error: null },
    maxLineNumberResult = { data: [], error: null },
    insertResult,
    updateResult,
    deleteResult,
    updatePayloads = [] as unknown[],
    deleteCalls = [] as unknown[],
  }: {
    shipmentResult?: { data: unknown; error: unknown };
    lineFetchResult?: { data: unknown; error: unknown };
    ownerFetchResult?: { data: unknown; error: unknown };
    maxLineNumberResult?: { data: unknown; error: unknown };
    insertResult?: { data: unknown; error: unknown };
    updateResult?: { data: unknown; error: unknown };
    deleteResult?: { data: unknown; error: unknown };
    updatePayloads?: unknown[];
    deleteCalls?: unknown[];
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

      if (table === "shipments") {
        return {
          select: () => (
            {
              eq: () => (
                {
                  maybeSingle: () =>
                    Promise.resolve(
                      shipmentResult,
                    ),
                }
              ),
            }
          ),
        };
      }

      // shipment_lines: .select() is called by addLine (max-line-number),
      // updateLine (its own row, with an embedded shipments(...)
      // relation) and removeLine (its org_id-only ownership pre-check),
      // all against this same table -- distinguish by call order isn't
      // reliable across the functions under test, so the mock switches
      // on the requested columns instead: an exact "org_id" select is
      // removeLine's ownership check (ownerFetchResult), anything else
      // reaching .maybeSingle() is updateLine's row fetch
      // (lineFetchResult), and the .order().limit() shape is addLine's
      // max-line-number lookup (maxLineNumberResult).
      return {
        select: (
          columns?: string,
        ) => (
          {
            eq: () => (
              {
                order: () => (
                  {
                    limit: () =>
                      Promise.resolve(
                        maxLineNumberResult,
                      ),
                  }
                ),

                maybeSingle: () =>
                  Promise.resolve(
                    columns === "org_id" ? ownerFetchResult : lineFetchResult,
                  ),
              }
            ),
          }
        ),

        insert: () => (
          {
            select: () => (
              {
                single: () =>
                  Promise.resolve(
                    insertResult,
                  ),
              }
            ),
          }
        ),

        update: (
          payload: unknown,
        ) => {
          updatePayloads.push(
            payload,
          );

          return {
            eq: () => (
              {
                select: () => (
                  {
                    maybeSingle: () =>
                      Promise.resolve(
                        updateResult,
                      ),
                  }
                ),
              }
            ),
          };
        },

        delete: () => {
          deleteCalls.push(
            true,
          );

          return {
            eq: () => (
              {
                select: () => (
                  {
                    maybeSingle: () =>
                      Promise.resolve(
                        deleteResult,
                      ),
                  }
                ),
              }
            ),
          };
        },
      };
    },
  } as never;
}

describe(
  "addLine",
  () => {
    it(
      "assigns line_number 1 to the first line on an empty shipment",
      async () => {
        const result =
          await addLine(
            mockSupabase(
              {
                maxLineNumberResult: { data: [], error: null },
                insertResult: { data: lineRow, error: null },
              },
            ),
            mockRepository(),
            orgId,
            actorUserId,
            shipmentId,
            validInput,
          );

        expect(result).toEqual(
          {
            status: "OK",
            line: {
              id: "line-1",
              shipment_id: "ship-1",
              org_id: "org-1",
              line_number: 1,
              cn_code: "25232100",
              cn_code_level: "CN8",
              goods_description: "Portland cement",
              origin_country: "DE",
              net_mass_tonnes: "10.5",
              quantity_mwh: null,
              production_route: null,
              emission_determination: null,
            },
          },
        );
      },
    );

    it(
      "assigns the next line_number after existing lines",
      async () => {
        const result =
          await addLine(
            mockSupabase(
              {
                maxLineNumberResult: { data: [{ line_number: 3 }], error: null },
                insertResult: { data: { ...lineRow, line_number: 4 }, error: null },
              },
            ),
            mockRepository(),
            orgId,
            actorUserId,
            shipmentId,
            validInput,
          );

        expect(
          result.status === "OK" ? result.line.line_number : null,
        ).toBe(
          4,
        );
      },
    );

    it(
      "rejects an invalid quantity without touching the database",
      async () => {
        const result =
          await addLine(
            mockSupabase(
              {},
            ),
            mockRepository(),
            orgId,
            actorUserId,
            shipmentId,
            { ...validInput, quantity: { kind: "MASS", value: "not-a-number" } },
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "INVALID_QUANTITY" },
        );
      },
    );

    it(
      "rejects a malformed origin country",
      async () => {
        const result =
          await addLine(
            mockSupabase(
              {},
            ),
            mockRepository(),
            orgId,
            actorUserId,
            shipmentId,
            { ...validInput, originCountry: "Germany" },
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "INVALID_ORIGIN_COUNTRY" },
        );
      },
    );

    it(
      "rejects an unsupported CN code before touching shipment_lines",
      async () => {
        const result =
          await addLine(
            mockSupabase(
              {},
            ),
            mockRepository(
              [],
            ),
            orgId,
            actorUserId,
            shipmentId,
            validInput,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "UNSUPPORTED_CODE" },
        );
      },
    );

    it(
      "rejects a quantity kind that doesn't match the good's functional unit",
      async () => {
        const result =
          await addLine(
            mockSupabase(
              {},
            ),
            mockRepository(),
            orgId,
            actorUserId,
            shipmentId,
            { ...validInput, quantity: { kind: "ENERGY", value: "10" } },
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "QUANTITY_UNIT_MISMATCH" },
        );
      },
    );

    it(
      "reports SHIPMENT_NOT_FOUND when the parent shipment doesn't exist",
      async () => {
        const result =
          await addLine(
            mockSupabase(
              { shipmentResult: { data: null, error: null } },
            ),
            mockRepository(),
            orgId,
            actorUserId,
            shipmentId,
            validInput,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "SHIPMENT_NOT_FOUND" },
        );
      },
    );

    it(
      "surfaces an RLS denial (locked/void parent) as SHIPMENT_NOT_EDITABLE",
      async () => {
        const result =
          await addLine(
            mockSupabase(
              {
                insertResult: {
                  data: null,
                  error: { code: "42501", message: "denied" },
                },
              },
            ),
            mockRepository(),
            orgId,
            actorUserId,
            shipmentId,
            validInput,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "SHIPMENT_NOT_EDITABLE" },
        );
      },
    );
  },
);

describe(
  "updateLine",
  () => {
    it(
      "persists a valid update",
      async () => {
        const result =
          await updateLine(
            mockSupabase(
              { updateResult: { data: lineRow, error: null } },
            ),
            mockRepository(),
            orgId,
            actorUserId,
            lineId,
            validInput,
          );

        expect(result.status).toBe(
          "OK",
        );
      },
    );

    it(
      "reports SHIPMENT_NOT_EDITABLE when RLS excludes the row (0 rows, no error)",
      async () => {
        const result =
          await updateLine(
            mockSupabase(
              { updateResult: { data: null, error: null } },
            ),
            mockRepository(),
            orgId,
            actorUserId,
            lineId,
            validInput,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "SHIPMENT_NOT_EDITABLE" },
        );
      },
    );

    it(
      "reports SHIPMENT_NOT_FOUND when the line's parent can't be resolved",
      async () => {
        const result =
          await updateLine(
            mockSupabase(
              { lineFetchResult: { data: null, error: null } },
            ),
            mockRepository(),
            orgId,
            actorUserId,
            lineId,
            validInput,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "SHIPMENT_NOT_FOUND" },
        );
      },
    );

    it(
      "clears an existing emission_determination -- editing the declared inputs invalidates it (found in P5 review)",
      async () => {
        const updatePayloads: unknown[] =
          [];

        const result =
          await updateLine(
            mockSupabase(
              {
                lineFetchResult: {
                  data: {
                    org_id: "org-1",
                    shipment_id: "ship-1",
                    shipments: { release_date: "2026-03-15" },
                  },
                  error: null,
                },
                updateResult: { data: lineRow, error: null },
                updatePayloads,
              },
            ),
            mockRepository(),
            orgId,
            actorUserId,
            lineId,
            validInput,
          );

        expect(result.status).toBe(
          "OK",
        );

        expect(updatePayloads[0]).toMatchObject(
          { emission_determination: null },
        );
      },
    );

    it(
      "reports SHIPMENT_NOT_FOUND (not a more specific reason) when the line belongs to a different org than the caller's active org",
      async () => {
        const updatePayloads: unknown[] =
          [];

        const result =
          await updateLine(
            mockSupabase(
              {
                lineFetchResult: {
                  data: {
                    org_id: "org-2",
                    shipment_id: "ship-1",
                    emission_determination: null,
                    shipments: { release_date: "2026-03-15" },
                  },
                  error: null,
                },
                updateResult: { data: { ...lineRow, org_id: "org-2" }, error: null },
                updatePayloads,
              },
            ),
            mockRepository(),
            orgId,
            actorUserId,
            lineId,
            validInput,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "SHIPMENT_NOT_FOUND" },
        );

        expect(updatePayloads).toHaveLength(
          0,
        );
      },
    );
  },
);

describe(
  "removeLine",
  () => {
    it(
      "removes a line and records an audit event",
      async () => {
        const result =
          await removeLine(
            mockSupabase(
              {
                deleteResult: {
                  data: { shipment_id: "ship-1", line_number: 1 },
                  error: null,
                },
              },
            ),
            orgId,
            actorUserId,
            lineId,
          );

        expect(result).toEqual(
          { status: "OK" },
        );
      },
    );

    it(
      "reports SHIPMENT_NOT_EDITABLE when RLS excludes the row",
      async () => {
        const result =
          await removeLine(
            mockSupabase(
              { deleteResult: { data: null, error: null } },
            ),
            orgId,
            actorUserId,
            lineId,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "SHIPMENT_NOT_EDITABLE" },
        );
      },
    );

    it(
      "reports SHIPMENT_NOT_EDITABLE (not a more specific reason) when the line belongs to a different org than the caller's active org",
      async () => {
        const deleteCalls: unknown[] =
          [];

        const result =
          await removeLine(
            mockSupabase(
              {
                ownerFetchResult: { data: { org_id: "org-2" }, error: null },
                deleteResult: {
                  data: { shipment_id: "ship-1", line_number: 1 },
                  error: null,
                },
                deleteCalls,
              },
            ),
            orgId,
            actorUserId,
            lineId,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "SHIPMENT_NOT_EDITABLE" },
        );

        expect(deleteCalls).toHaveLength(
          0,
        );
      },
    );
  },
);

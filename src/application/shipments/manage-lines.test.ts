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

const orgId =
  "org-1" as never;

const actorUserId =
  "user-1" as never;

const shipmentId =
  "ship-1" as never;

const lineId =
  "line-1" as never;

const validInput =
  {
    cnCode: "25232100",
    cnCodeLevel: "CN8" as const,
    goodsDescription: "Portland cement",
    originCountry: "DE",
    quantity: { kind: "MASS" as const, value: "10.5" },
    productionRoute: null,
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

function mockSupabase(
  {
    maxLineNumberResult = { data: [], error: null },
    insertResult,
    updateResult,
    deleteResult,
  }: {
    maxLineNumberResult?: { data: unknown; error: unknown };
    insertResult?: { data: unknown; error: unknown };
    updateResult?: { data: unknown; error: unknown };
    deleteResult?: { data: unknown; error: unknown };
  },
) {
  return {
    from: (
      table: string,
    ) => (
      table === "audit_events"
        ? {
            insert: () =>
              Promise.resolve(
                { error: null },
              ),
          }
        : {
            select: () => (
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

            update: () => (
              {
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
              }
            ),

            delete: () => (
              {
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
              }
            ),
          }
    ),
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
  },
);

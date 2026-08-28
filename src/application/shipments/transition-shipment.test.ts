import {
  describe,
  expect,
  it,
} from "vitest";

import {
  transitionShipmentStatus,
} from "./transition-shipment";

const orgId =
  "org-1" as never;

const actorUserId =
  "user-1" as never;

const shipmentId =
  "ship-1" as never;

const draftShipmentRow =
  {
    id: "ship-1",
    org_id: "org-1",
    reference: "REF-001",
    release_date: "2026-03-15",
    reporting_period_kind: "ANNUAL",
    reporting_period_year: 2026,
    reporting_period_quarter: null,
    customs_mrn: null,
    customs_procedure: null,
    status: "DRAFT",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };

const completeLineRow =
  {
    id: "line-1",
    shipment_id: "ship-1",
    org_id: "org-1",
    line_number: 1,
    cn_code: "25232100",
    cn_code_level: "CN8",
    goods_description: null,
    origin_country: "DE",
    net_mass_tonnes: "10.5",
    quantity_mwh: null,
    production_route_name: null,
    production_route_indicator: null,
    // P4 never sets this -- MARK_READY requires it (isLineComplete),
    // so this row is deliberately still "incomplete" by that measure
    // even though every other field is filled in. See the "rejects
    // MARK_READY" test below.
    emission_determination: null,
  };

function mockSupabase(
  {
    shipmentResult,
    linesResult = { data: [], error: null },
    updateError = null,
  }: {
    shipmentResult: { data: unknown; error: unknown };
    linesResult?: { data: unknown; error: unknown };
    updateError?: unknown;
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

      if (table === "shipment_lines") {
        return {
          select: () => (
            {
              eq: () =>
                Promise.resolve(
                  linesResult,
                ),
            }
          ),
        };
      }

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

        update: () => (
          {
            eq: () =>
              Promise.resolve(
                { error: updateError },
              ),
          }
        ),
      };
    },
  } as never;
}

describe(
  "transitionShipmentStatus",
  () => {
    it(
      "reports NOT_FOUND when the shipment doesn't exist (or isn't visible via RLS)",
      async () => {
        const result =
          await transitionShipmentStatus(
            mockSupabase(
              { shipmentResult: { data: null, error: null } },
            ),
            orgId,
            actorUserId,
            shipmentId,
            "VOID",
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "NOT_FOUND" },
        );
      },
    );

    it(
      "reports NOT_FOUND when the shipment's org_id doesn't match the caller's active org (audit-attribution guard, see resolve-line-emissions.ts's fetchLineForResolution)",
      async () => {
        let updateCalled =
          false;

        let auditInsertCalled =
          false;

        const supabase =
          {
            from: (
              table: string,
            ) => {
              if (table === "audit_events") {
                return {
                  insert: () => {
                    auditInsertCalled = true;

                    return Promise.resolve(
                      { error: null },
                    );
                  },
                };
              }

              if (table === "shipment_lines") {
                return {
                  select: () => (
                    {
                      eq: () =>
                        Promise.resolve(
                          { data: [], error: null },
                        ),
                    }
                  ),
                };
              }

              return {
                select: () => (
                  {
                    eq: () => (
                      {
                        maybeSingle: () =>
                          Promise.resolve(
                            { data: { ...draftShipmentRow, org_id: "org-2" }, error: null },
                          ),
                      }
                    ),
                  }
                ),

                update: () => {
                  updateCalled = true;

                  return {
                    eq: () =>
                      Promise.resolve(
                        { error: null },
                      ),
                  };
                },
              };
            },
          } as never;

        const result =
          await transitionShipmentStatus(
            supabase,
            orgId,
            actorUserId,
            shipmentId,
            "VOID",
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "NOT_FOUND" },
        );

        expect(updateCalled).toBe(
          false,
        );

        expect(auditInsertCalled).toBe(
          false,
        );
      },
    );

    it(
      "voids a DRAFT shipment regardless of line completeness",
      async () => {
        const result =
          await transitionShipmentStatus(
            mockSupabase(
              {
                shipmentResult: { data: draftShipmentRow, error: null },
                linesResult: { data: [completeLineRow], error: null },
              },
            ),
            orgId,
            actorUserId,
            shipmentId,
            "VOID",
          );

        expect(result).toEqual(
          {
            status: "OK",
            shipment: expect.objectContaining(
              { status: "VOID" },
            ),
          },
        );
      },
    );

    it(
      "rejects MARK_READY when a line has no emission_determination (P4: never set yet)",
      async () => {
        const result =
          await transitionShipmentStatus(
            mockSupabase(
              {
                shipmentResult: { data: draftShipmentRow, error: null },
                linesResult: { data: [completeLineRow], error: null },
              },
            ),
            orgId,
            actorUserId,
            shipmentId,
            "MARK_READY",
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "LINE_INCOMPLETE" },
        );
      },
    );

    it(
      "rejects MARK_READY on a shipment with no lines",
      async () => {
        const result =
          await transitionShipmentStatus(
            mockSupabase(
              {
                shipmentResult: { data: draftShipmentRow, error: null },
                linesResult: { data: [], error: null },
              },
            ),
            orgId,
            actorUserId,
            shipmentId,
            "MARK_READY",
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "NO_LINES" },
        );
      },
    );

    it(
      "rejects VOID on an already-LOCKED shipment without persisting",
      async () => {
        const result =
          await transitionShipmentStatus(
            mockSupabase(
              {
                shipmentResult: {
                  data: { ...draftShipmentRow, status: "LOCKED" },
                  error: null,
                },
              },
            ),
            orgId,
            actorUserId,
            shipmentId,
            "VOID",
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "SHIPMENT_ALREADY_LOCKED" },
        );
      },
    );

    it(
      "maps a persist error to PERSIST_FAILED",
      async () => {
        const result =
          await transitionShipmentStatus(
            mockSupabase(
              {
                shipmentResult: { data: draftShipmentRow, error: null },
                updateError: { message: "db error" },
              },
            ),
            orgId,
            actorUserId,
            shipmentId,
            "VOID",
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "PERSIST_FAILED" },
        );
      },
    );
  },
);

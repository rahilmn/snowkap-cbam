import {
  describe,
  expect,
  it,
} from "vitest";

import {
  transitionShipmentStatus,
} from "./transition-shipment";

import type {
  OrgContext,
} from "../organizations/org-context";

const orgId =
  "org-1" as never;

const actorUserId =
  "user-1" as never;

const shipmentId =
  "ship-1" as never;

function memberContext(
  role: OrgContext["role"] = "MEMBER",
): OrgContext {
  return {
    org_id: orgId,
    user_id: actorUserId,
    role,
    capabilities: [],
  };
}

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
    // Row-count check for the CAS guard: defaults to "the update
    // matched" (a truthy stand-in row) so every existing test, which
    // doesn't care about the concurrency case, keeps passing without
    // having to know about this parameter. A test exercising
    // CONCURRENT_MODIFICATION passes { id: null } here (matching a
    // real .maybeSingle() finding zero rows).
    updateData = { id: "ship-1" },
  }: {
    shipmentResult: { data: unknown; error: unknown };
    linesResult?: { data: unknown; error: unknown };
    updateError?: unknown;
    updateData?: unknown;
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

        update: () => {
          const chain = {
            eq: () => chain,
            select: () => chain,
            maybeSingle: () =>
              Promise.resolve(
                { data: updateError ? null : updateData, error: updateError },
              ),
          };

          return chain;
        },
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
            memberContext(),
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
            memberContext(),
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
            memberContext(),
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
            memberContext(),
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
            memberContext(),
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
            memberContext(),
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
            memberContext(),
            shipmentId,
            "VOID",
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "PERSIST_FAILED" },
        );
      },
    );

    it(
      "rejects CONCURRENT_MODIFICATION (not a silent OK) when the CAS predicate matches zero rows -- e.g. another request already transitioned this shipment out of the status this call read (P13 adversarial audit: this UPDATE previously carried no CAS predicate at all, so a lost race silently succeeded and recorded a false audit event)",
      async () => {
        const result =
          await transitionShipmentStatus(
            mockSupabase(
              {
                shipmentResult: { data: draftShipmentRow, error: null },
                updateData: null,
              },
            ),
            memberContext(),
            shipmentId,
            "VOID",
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "CONCURRENT_MODIFICATION" },
        );
      },
    );

    // LOCK is ADMIN+ only (master plan §27 screen 12: "MEMBER+ (lock
    // ADMIN+)") -- capability-matrix audit, added because this
    // transition previously had no role check at all: any MEMBER could
    // LOCK a shipment via the shipment detail screen's "Lock" button
    // (transition-actions.tsx). Both walls now enforce this: the
    // application-layer check tested below (Wall 1), and RLS's
    // `shipments_update_own_org_not_terminal` WITH CHECK
    // (20260829090000: `status <> 'LOCKED' or
    // app.user_is_admin_or_owner_of(org_id)`, Wall 2 -- see
    // docs/architecture/AUTHORIZATION_MATRIX.md's "LOCK role gate"
    // entry for the live-reproduced RLS-level probe).
    describe(
      "LOCK role gate",
      () => {
        const readyShipmentRow =
          { ...draftShipmentRow, status: "READY" };

        it(
          "rejects LOCK from a plain MEMBER with PERMISSION_DENIED, before touching the database",
          async () => {
            let dbTouched =
              false;

            const supabase =
              {
                from: () => {
                  dbTouched = true;

                  throw new Error(
                    "transitionShipmentStatus must not read the database before the LOCK role check runs",
                  );
                },
              } as never;

            const result =
              await transitionShipmentStatus(
                supabase,
                memberContext("MEMBER"),
                shipmentId,
                "LOCK",
              );

            expect(result).toEqual(
              { status: "REJECTED", reason: "PERMISSION_DENIED" },
            );

            expect(dbTouched).toBe(
              false,
            );
          },
        );

        it(
          "allows LOCK from an ADMIN on a READY shipment",
          async () => {
            const result =
              await transitionShipmentStatus(
                mockSupabase(
                  { shipmentResult: { data: readyShipmentRow, error: null } },
                ),
                memberContext("ADMIN"),
                shipmentId,
                "LOCK",
              );

            expect(result).toEqual(
              {
                status: "OK",
                shipment: expect.objectContaining(
                  { status: "LOCKED" },
                ),
              },
            );
          },
        );

        it(
          "allows LOCK from an OWNER on a READY shipment",
          async () => {
            const result =
              await transitionShipmentStatus(
                mockSupabase(
                  { shipmentResult: { data: readyShipmentRow, error: null } },
                ),
                memberContext("OWNER"),
                shipmentId,
                "LOCK",
              );

            expect(result).toEqual(
              {
                status: "OK",
                shipment: expect.objectContaining(
                  { status: "LOCKED" },
                ),
              },
            );
          },
        );

        // Current, deliberate behavior (not this audit's gap): the §14
        // roles matrix names LOCK specifically as ADMIN+ and says
        // nothing narrowing MARK_READY/REOPEN/VOID, which stay MEMBER+
        // day-to-day actions -- a plain MEMBER can still VOID a
        // shipment (already exercised by "voids a DRAFT shipment
        // regardless of line completeness", above, via the default
        // memberContext() MEMBER role). This test makes that contrast
        // explicit rather than leaving it implicit in a same-role
        // default.
        it(
          "does not require ADMIN+ for VOID -- a plain MEMBER may still void a shipment",
          async () => {
            const result =
              await transitionShipmentStatus(
                mockSupabase(
                  { shipmentResult: { data: draftShipmentRow, error: null } },
                ),
                memberContext("MEMBER"),
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
      },
    );
  },
);

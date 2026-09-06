import {
  describe,
  expect,
  it,
} from "vitest";

import {
  deriveI19Items,
} from "./i19";

import type {
  Shipment,
  ShipmentLine,
} from "../shipments/types";

import type {
  CompletenessReport,
  Declaration,
} from "../declarations/types";

function line(
  overrides: Partial<ShipmentLine> = {},
): ShipmentLine {
  return {
    id: "line-1" as ShipmentLine["id"],
    shipment_id: "ship-1" as ShipmentLine["shipment_id"],
    org_id: "org-1" as ShipmentLine["org_id"],
    line_number: 1,
    cn_code: "25232100",
    cn_code_level: "CN8",
    goods_description: null,
    origin_country: "CN" as ShipmentLine["origin_country"],
    net_mass_tonnes: "100" as ShipmentLine["net_mass_tonnes"],
    quantity_mwh: null,
    production_route: null,
    emission_determination: {
      method: "DEFAULT",
    } as ShipmentLine["emission_determination"],
    ...overrides,
  };
}

function shipment(
  overrides: Partial<Shipment> = {},
): Shipment {
  return {
    id: "ship-1" as Shipment["id"],
    org_id: "org-1" as Shipment["org_id"],
    reference: "SHIP-001",
    release_date: "2026-01-15" as Shipment["release_date"],
    reporting_period: { kind: "ANNUAL", year: 2026 },
    customs_mrn: null,
    customs_procedure: null,
    status: "DRAFT",
    lines: [line()],
    created_at: "2026-01-01T00:00:00Z" as Shipment["created_at"],
    updated_at: "2026-01-01T00:00:00Z" as Shipment["updated_at"],
    ...overrides,
  };
}

function declaration(
  overrides: Partial<Declaration> = {},
): Declaration {
  return {
    id: "decl-1" as Declaration["id"],
    org_id: "org-1" as Declaration["org_id"],
    reporting_period: { kind: "ANNUAL", year: 2026 },
    status: "DRAFT",
    member_shipment_ids: ["ship-1" as Declaration["member_shipment_ids"][number]],
    completeness_report: null,
    filed_snapshot: null,
    filed_reference: null,
    filed_at: null,
    supersedes_declaration_id: null,
    created_by_user_id: "user-1" as Declaration["created_by_user_id"],
    created_at: "2026-01-01T00:00:00Z" as Declaration["created_at"],
    updated_at: "2026-01-01T00:00:00Z" as Declaration["updated_at"],
    ...overrides,
  };
}

describe(
  "deriveI19Items",
  () => {
    it(
      "emits a REQUIRED/APPROVAL item for a DRAFT shipment that would succeed at MARK_READY, when no declaration exists for its period",
      () => {
        const items =
          deriveI19Items(
            [shipment()],
            [],
          );

        expect(items).toHaveLength(1);
        expect(items[0]?.priority).toBe("REQUIRED");
        expect(items[0]?.impact).toBe("APPROVAL");
        expect(items[0]?.title).toBe("Mark SHIP-001 ready");
        expect(items[0]?.rule).toBe("I19");
      },
    );

    it(
      "escalates impact to FILING when a declaration exists for the shipment's period and the shipment is a member of it",
      () => {
        const items =
          deriveI19Items(
            [shipment()],
            [
              declaration({
                member_shipment_ids: ["ship-1" as Declaration["member_shipment_ids"][number]],
              }),
            ],
          );

        expect(items).toHaveLength(1);
        expect(items[0]?.priority).toBe("REQUIRED");
        expect(items[0]?.impact).toBe("FILING");
      },
    );

    it(
      "does not emit an item for a shipment that is not DRAFT",
      () => {
        const items =
          deriveI19Items(
            [shipment({ status: "READY" })],
            [],
          );

        expect(items).toHaveLength(0);
      },
    );

    it(
      "does not emit an item for a DRAFT shipment with no lines (transitionShipment would reject NO_LINES)",
      () => {
        const items =
          deriveI19Items(
            [shipment({ lines: [] })],
            [],
          );

        expect(items).toHaveLength(0);
      },
    );

    it(
      "does not emit an item for a DRAFT shipment with an incomplete line (transitionShipment would reject LINE_INCOMPLETE) -- reuses the real domain transition function, not a duplicated rule",
      () => {
        const items =
          deriveI19Items(
            [shipment({ lines: [line({ emission_determination: null })] })],
            [],
          );

        expect(items).toHaveLength(0);
      },
    );

    describe(
      "the I19/I22 cross-item relation (the ONLY cross-item priority/impact relation)",
      () => {
        it(
          "when the I22 condition holds (D DRAFT with blockers) for a declaration in the shipment's period, and the shipment is a NON-MEMBER of that declaration, impact is forced to APPROVAL even though a declaration exists -- priority stays REQUIRED, action stays Mark ready",
          () => {
            const nonMemberShipment =
              shipment({ id: "ship-2" as Shipment["id"], reference: "SHIP-002" });

            const declarationWithBlockers =
              declaration({
                status: "DRAFT",
                // ship-2 is NOT in member_shipment_ids -- a real,
                // concrete "non-member shipment in D's period" case:
                // this declaration's member set was snapshotted before
                // ship-2 existed / was last refreshed.
                member_shipment_ids: ["ship-1" as Declaration["member_shipment_ids"][number]],
                completeness_report: {
                  generated_at: "2026-01-01T00:00:00Z" as CompletenessReport["generated_at"],
                  shipment_count: 1,
                  line_count: 1,
                  complete: false,
                  blockers: [
                    {
                      reason: "SHIPMENT_NOT_LOCKABLE",
                      shipment_id: "ship-1" as Declaration["member_shipment_ids"][number],
                      shipment_reference: "SHIP-001",
                    },
                  ],
                },
              });

            const items =
              deriveI19Items(
                [nonMemberShipment],
                [declarationWithBlockers],
              );

            expect(items).toHaveLength(1);
            expect(items[0]?.priority).toBe("REQUIRED");
            expect(items[0]?.impact).toBe("APPROVAL");
            expect(items[0]?.title).toBe("Mark SHIP-002 ready");
            expect(items[0]?.actionability).toBe("NAVIGATE");
          },
        );

        it(
          "the same I22 condition does NOT affect a MEMBER shipment's I19 item -- it keeps FILING",
          () => {
            const memberShipment =
              shipment();

            const declarationWithBlockers =
              declaration({
                status: "DRAFT",
                member_shipment_ids: ["ship-1" as Declaration["member_shipment_ids"][number]],
                completeness_report: {
                  generated_at: "2026-01-01T00:00:00Z" as CompletenessReport["generated_at"],
                  shipment_count: 1,
                  line_count: 1,
                  complete: false,
                  blockers: [
                    {
                      reason: "SHIPMENT_HAS_NO_LINES",
                      shipment_id: "other" as Declaration["member_shipment_ids"][number],
                      shipment_reference: "OTHER",
                    },
                  ],
                },
              });

            const items =
              deriveI19Items(
                [memberShipment],
                [declarationWithBlockers],
              );

            expect(items).toHaveLength(1);
            expect(items[0]?.impact).toBe("FILING");
          },
        );

        it(
          "the relation is unconditional on D's own status -- a non-member of a READY declaration still gets impact forced to APPROVAL (2026-09-05 S2 remediation B2: previously gated on an invented DRAFT-only precondition not in v2.1.1)",
          () => {
            const nonMemberShipment =
              shipment({ id: "ship-2" as Shipment["id"], reference: "SHIP-002" });

            const readyDeclaration =
              declaration({
                status: "READY",
                member_shipment_ids: ["ship-1" as Declaration["member_shipment_ids"][number]],
                completeness_report: {
                  generated_at: "2026-01-01T00:00:00Z" as CompletenessReport["generated_at"],
                  shipment_count: 1,
                  line_count: 1,
                  complete: true,
                  blockers: [],
                },
              });

            const items =
              deriveI19Items(
                [nonMemberShipment],
                [readyDeclaration],
              );

            expect(items).toHaveLength(1);
            expect(items[0]?.priority).toBe("REQUIRED");
            expect(items[0]?.impact).toBe("APPROVAL");
          },
        );

        it(
          "the relation is unconditional on completeness -- a non-member of a DRAFT declaration with a complete (blocker-free) report still gets impact forced to APPROVAL (2026-09-05 S2 remediation B2)",
          () => {
            const nonMemberShipment =
              shipment({ id: "ship-2" as Shipment["id"], reference: "SHIP-002" });

            const completeDraftDeclaration =
              declaration({
                status: "DRAFT",
                member_shipment_ids: ["ship-1" as Declaration["member_shipment_ids"][number]],
                completeness_report: {
                  generated_at: "2026-01-01T00:00:00Z" as CompletenessReport["generated_at"],
                  shipment_count: 1,
                  line_count: 1,
                  complete: true,
                  blockers: [],
                },
              });

            const items =
              deriveI19Items(
                [nonMemberShipment],
                [completeDraftDeclaration],
              );

            expect(items).toHaveLength(1);
            expect(items[0]?.priority).toBe("REQUIRED");
            expect(items[0]?.impact).toBe("APPROVAL");
          },
        );

        it(
          "the relation is unconditional on the completeness report existing at all -- a non-member of a DRAFT declaration whose report was never generated (null) still gets impact forced to APPROVAL (2026-09-05 S2 remediation B2)",
          () => {
            const nonMemberShipment =
              shipment({ id: "ship-2" as Shipment["id"], reference: "SHIP-002" });

            const reportlessDraftDeclaration =
              declaration({
                status: "DRAFT",
                member_shipment_ids: ["ship-1" as Declaration["member_shipment_ids"][number]],
                completeness_report: null,
              });

            const items =
              deriveI19Items(
                [nonMemberShipment],
                [reportlessDraftDeclaration],
              );

            expect(items).toHaveLength(1);
            expect(items[0]?.priority).toBe("REQUIRED");
            expect(items[0]?.impact).toBe("APPROVAL");
          },
        );

        it(
          "the relation is unconditional on D's status -- a non-member of a FILED_RECORDED declaration still gets impact forced to APPROVAL (2026-09-05 S2 remediation B2)",
          () => {
            const nonMemberShipment =
              shipment({ id: "ship-2" as Shipment["id"], reference: "SHIP-002" });

            const filedDeclaration =
              declaration({
                status: "FILED_RECORDED",
                member_shipment_ids: ["ship-1" as Declaration["member_shipment_ids"][number]],
                completeness_report: {
                  generated_at: "2026-01-01T00:00:00Z" as CompletenessReport["generated_at"],
                  shipment_count: 1,
                  line_count: 1,
                  complete: true,
                  blockers: [],
                },
                filed_snapshot: {},
                filed_reference: "REF-1",
                filed_at: "2026-01-05T00:00:00Z" as Declaration["filed_at"],
              });

            const items =
              deriveI19Items(
                [nonMemberShipment],
                [filedDeclaration],
              );

            expect(items).toHaveLength(1);
            expect(items[0]?.priority).toBe("REQUIRED");
            expect(items[0]?.impact).toBe("APPROVAL");
          },
        );

        it(
          "not suppressed, not merged, not downgraded -- exactly one I19 item still exists for the non-member shipment (only impact changes)",
          () => {
            const nonMemberShipment =
              shipment({ id: "ship-2" as Shipment["id"], reference: "SHIP-002" });

            const declarationWithBlockers =
              declaration({
                status: "DRAFT",
                member_shipment_ids: [],
                completeness_report: {
                  generated_at: "2026-01-01T00:00:00Z" as CompletenessReport["generated_at"],
                  shipment_count: 0,
                  line_count: 0,
                  complete: false,
                  blockers: [
                    { reason: "NO_SHIPMENTS_IN_PERIOD", shipment_id: null, shipment_reference: null },
                  ],
                },
              });

            const items =
              deriveI19Items(
                [nonMemberShipment],
                [declarationWithBlockers],
              );

            expect(items).toHaveLength(1);
            expect(items[0]?.priority).not.toBe("RECOMMENDED");
            expect(items[0]?.priority).not.toBe("OPTIONAL");
            expect(items[0]?.priority).toBe("REQUIRED");
          },
        );
      },
    );

    describe(
      "2026-09-07 (S5 review round 6, finding S5R6-A-GUID1): excludes VOID declarations from the period lookup",
      () => {
        it(
          "an unrelated VOID declaration for the same period that does NOT include the shipment must not force a genuinely FILING-eligible shipment down to APPROVAL",
          () => {
            const items =
              deriveI19Items(
                [shipment()],
                [
                  // The live, active declaration -- ship-1 IS a member.
                  declaration({
                    id: "decl-live" as Declaration["id"],
                    status: "DRAFT",
                    member_shipment_ids: ["ship-1" as Declaration["member_shipment_ids"][number]],
                  }),
                  // An unrelated, retired declaration for the SAME
                  // period that does NOT include ship-1 -- its frozen
                  // member_shipment_ids is a dead fact, not a live one.
                  declaration({
                    id: "decl-void" as Declaration["id"],
                    status: "VOID",
                    member_shipment_ids: [],
                  }),
                ],
              );

            expect(items).toHaveLength(1);
            expect(items[0]?.impact).toBe("FILING");
          },
        );

        it(
          "a period whose ONLY declaration is VOID (even one that happens to include the shipment as a member) must not report FILING -- a VOID declaration can never be filed",
          () => {
            const items =
              deriveI19Items(
                [shipment()],
                [
                  declaration({
                    status: "VOID",
                    member_shipment_ids: ["ship-1" as Declaration["member_shipment_ids"][number]],
                  }),
                ],
              );

            expect(items).toHaveLength(1);
            expect(items[0]?.impact).toBe("APPROVAL");
            expect(items[0]?.reason).not.toMatch(
              /eligible to be included/,
            );
          },
        );
      },
    );

    it(
      "does not consider a declaration in a DIFFERENT reporting period",
      () => {
        const items =
          deriveI19Items(
            [shipment()],
            [
              declaration({
                reporting_period: { kind: "ANNUAL", year: 2025 },
              }),
            ],
          );

        expect(items).toHaveLength(1);
        expect(items[0]?.impact).toBe("APPROVAL");
      },
    );
  },
);

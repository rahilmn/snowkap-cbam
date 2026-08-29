import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createShipment,
} from "./create-shipment";

import type {
  OrgContext,
} from "../organizations/org-context";

const orgId =
  "org-1" as never;

const actorUserId =
  "user-1" as never;

function memberContext(
  capabilities: OrgContext["capabilities"] = ["IMPORTER_DECLARANT"],
): OrgContext {
  return {
    org_id: orgId,
    user_id: actorUserId,
    role: "MEMBER",
    capabilities,
  };
}

function mockSupabase(
  {
    insertResult,
    auditInsertError = null,
  }: {
    insertResult: { data: unknown; error: unknown };
    auditInsertError?: unknown;
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
                { error: auditInsertError },
              ),
          }
        : {
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
          }
    ),
  } as never;
}

const shipmentRow =
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

describe(
  "createShipment",
  () => {
    it(
      "creates a DRAFT shipment with the derived annual reporting period",
      async () => {
        const result =
          await createShipment(
            mockSupabase(
              { insertResult: { data: shipmentRow, error: null } },
            ),
            memberContext(),
            { reference: "REF-001", releaseDate: "2026-03-15" },
          );

        expect(result).toEqual(
          {
            status: "OK",
            shipment: {
              id: "ship-1",
              org_id: "org-1",
              reference: "REF-001",
              release_date: "2026-03-15",
              reporting_period: { kind: "ANNUAL", year: 2026 },
              customs_mrn: null,
              customs_procedure: null,
              status: "DRAFT",
              lines: [],
              created_at: "2026-01-01T00:00:00Z",
              updated_at: "2026-01-01T00:00:00Z",
            },
          },
        );
      },
    );

    it(
      "derives a QUARTERLY reporting period for a pre-2026 release date",
      async () => {
        const result =
          await createShipment(
            mockSupabase(
              {
                insertResult: {
                  data: {
                    ...shipmentRow,
                    release_date: "2025-11-01",
                    reporting_period_kind: "QUARTERLY",
                    reporting_period_year: 2025,
                    reporting_period_quarter: 4,
                  },
                  error: null,
                },
              },
            ),
            memberContext(),
            { reference: "REF-002", releaseDate: "2025-11-01" },
          );

        expect(result.status).toBe(
          "OK",
        );

        expect(
          result.status === "OK" ? result.shipment.reporting_period : null,
        ).toEqual(
          { kind: "QUARTERLY", year: 2025, quarter: 4 },
        );
      },
    );

    it(
      "rejects a malformed release date without querying the database",
      async () => {
        const result =
          await createShipment(
            mockSupabase(
              { insertResult: { data: null, error: null } },
            ),
            memberContext(),
            { reference: "REF-003", releaseDate: "not-a-date" },
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "INVALID_DATE" },
        );
      },
    );

    it(
      "maps a unique-constraint violation to DUPLICATE_REFERENCE",
      async () => {
        const result =
          await createShipment(
            mockSupabase(
              {
                insertResult: {
                  data: null,
                  error: { code: "23505", message: "duplicate" },
                },
              },
            ),
            memberContext(),
            { reference: "REF-001", releaseDate: "2026-03-15" },
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "DUPLICATE_REFERENCE" },
        );
      },
    );

    it(
      "maps any other insert error to PERSIST_FAILED",
      async () => {
        const result =
          await createShipment(
            mockSupabase(
              {
                insertResult: {
                  data: null,
                  error: { code: "42501", message: "denied" },
                },
              },
            ),
            memberContext(),
            { reference: "REF-001", releaseDate: "2026-03-15" },
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "PERSIST_FAILED" },
        );
      },
    );

    describe(
      "capability gate",
      () => {
        it(
          "rejects an org without IMPORTER_DECLARANT with CAPABILITY_NOT_HELD, before touching the database",
          async () => {
            const supabase =
              {
                from: () => {
                  throw new Error(
                    "createShipment must not read the database before the capability check runs",
                  );
                },
              } as never;

            const result =
              await createShipment(
                supabase,
                memberContext(["PRODUCER_OPERATOR"]),
                { reference: "REF-001", releaseDate: "2026-03-15" },
              );

            expect(result).toEqual(
              { status: "REJECTED", reason: "CAPABILITY_NOT_HELD" },
            );
          },
        );

        it(
          "allows an org holding IMPORTER_DECLARANT",
          async () => {
            const result =
              await createShipment(
                mockSupabase(
                  { insertResult: { data: shipmentRow, error: null } },
                ),
                memberContext(["IMPORTER_DECLARANT"]),
                { reference: "REF-001", releaseDate: "2026-03-15" },
              );

            expect(result.status).toBe(
              "OK",
            );
          },
        );

        it(
          "allows an org holding both capabilities",
          async () => {
            const result =
              await createShipment(
                mockSupabase(
                  { insertResult: { data: shipmentRow, error: null } },
                ),
                memberContext(["IMPORTER_DECLARANT", "PRODUCER_OPERATOR"]),
                { reference: "REF-001", releaseDate: "2026-03-15" },
              );

            expect(result.status).toBe(
              "OK",
            );
          },
        );
      },
    );
  },
);

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createSupplier,
  listSuppliers,
  removeSupplier,
} from "./manage-suppliers";

const orgId =
  "org-1" as never;

const actorUserId =
  "user-1" as never;

const supplierRow =
  {
    id: "supplier-1",
    org_id: "org-1",
    name: "Acme Steel GmbH",
    country: "DE",
    contact_name: null,
    contact_email: null,
    linked_operator_id: null,
    linked_installation_ids: [],
    created_at: "2026-01-01T00:00:00Z",
  };

function mockSupabase(
  {
    listResult,
    insertResult,
    deleteError = null,
  }: {
    listResult?: { data: unknown; error: unknown };
    insertResult?: { data: unknown; error: unknown };
    deleteError?: unknown;
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
                    order: () =>
                      Promise.resolve(
                        listResult,
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

            delete: () => (
              {
                eq: () =>
                  Promise.resolve(
                    { error: deleteError },
                  ),
              }
            ),
          }
    ),
  } as never;
}

describe(
  "listSuppliers",
  () => {
    it(
      "maps rows to Supplier objects",
      async () => {
        const result =
          await listSuppliers(
            mockSupabase(
              { listResult: { data: [supplierRow], error: null } },
            ),
            orgId,
          );

        expect(result).toEqual(
          [
            {
              id: "supplier-1",
              org_id: "org-1",
              name: "Acme Steel GmbH",
              country: "DE",
              contact_name: null,
              contact_email: null,
              linked_operator_id: null,
              linked_installation_ids: [],
              created_at: "2026-01-01T00:00:00Z",
            },
          ],
        );
      },
    );
  },
);

describe(
  "createSupplier",
  () => {
    it(
      "creates a supplier with a valid country",
      async () => {
        const result =
          await createSupplier(
            mockSupabase(
              { insertResult: { data: supplierRow, error: null } },
            ),
            orgId,
            actorUserId,
            {
              name: "Acme Steel GmbH",
              country: "DE",
              contactName: null,
              contactEmail: null,
            },
          );

        expect(result).toEqual(
          { status: "OK", supplier: expect.objectContaining({ name: "Acme Steel GmbH" }) },
        );
      },
    );

    it(
      "rejects a malformed country code",
      async () => {
        const result =
          await createSupplier(
            mockSupabase(
              {},
            ),
            orgId,
            actorUserId,
            {
              name: "Acme Steel GmbH",
              country: "Germany",
              contactName: null,
              contactEmail: null,
            },
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "INVALID_COUNTRY" },
        );
      },
    );

    it(
      "allows a null country",
      async () => {
        const result =
          await createSupplier(
            mockSupabase(
              {
                insertResult: {
                  data: { ...supplierRow, country: null },
                  error: null,
                },
              },
            ),
            orgId,
            actorUserId,
            {
              name: "Unknown Supplier",
              country: null,
              contactName: null,
              contactEmail: null,
            },
          );

        expect(result.status).toBe(
          "OK",
        );
      },
    );
  },
);

describe(
  "removeSupplier",
  () => {
    it(
      "removes a supplier",
      async () => {
        const result =
          await removeSupplier(
            mockSupabase(
              {},
            ),
            orgId,
            actorUserId,
            "supplier-1" as never,
          );

        expect(result).toEqual(
          { status: "OK" },
        );
      },
    );

    it(
      "reports PERSIST_FAILED on error",
      async () => {
        const result =
          await removeSupplier(
            mockSupabase(
              { deleteError: { message: "denied" } },
            ),
            orgId,
            actorUserId,
            "supplier-1" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "PERSIST_FAILED" },
        );
      },
    );
  },
);

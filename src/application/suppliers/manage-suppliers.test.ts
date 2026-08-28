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
    ownershipFetchResult = { data: { org_id: "org-1" }, error: null },
    deleteError = null,
    deleteCalled,
    auditInsertCalled,
  }: {
    listResult?: { data: unknown; error: unknown };
    insertResult?: { data: unknown; error: unknown };
    ownershipFetchResult?: { data: unknown; error: unknown };
    deleteError?: unknown;
    deleteCalled?: { value: boolean };
    auditInsertCalled?: { value: boolean };
  },
) {
  return {
    from: (
      table: string,
    ) => (
      table === "audit_events"
        ? {
            insert: () => {
              if (auditInsertCalled) {
                auditInsertCalled.value = true;
              }

              return Promise.resolve(
                { error: null },
              );
            },
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

                    maybeSingle: () =>
                      Promise.resolve(
                        ownershipFetchResult,
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
                eq: () => {
                  if (deleteCalled) {
                    deleteCalled.value = true;
                  }

                  return Promise.resolve(
                    { error: deleteError },
                  );
                },
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

    it(
      "rejects SUPPLIER_NOT_FOUND (not OK) when the supplier belongs to a different org than the caller's active org",
      async () => {
        const deleteCalled =
          { value: false };

        const auditInsertCalled =
          { value: false };

        const result =
          await removeSupplier(
            mockSupabase(
              {
                ownershipFetchResult: { data: { org_id: "org-2" }, error: null },
                deleteCalled,
                auditInsertCalled,
              },
            ),
            orgId,
            actorUserId,
            "supplier-1" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "SUPPLIER_NOT_FOUND" },
        );

        expect(deleteCalled.value).toBe(
          false,
        );

        expect(auditInsertCalled.value).toBe(
          false,
        );
      },
    );

    it(
      "reports SUPPLIER_NOT_FOUND when the supplier doesn't exist",
      async () => {
        const result =
          await removeSupplier(
            mockSupabase(
              {
                ownershipFetchResult: { data: null, error: null },
              },
            ),
            orgId,
            actorUserId,
            "supplier-1" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "SUPPLIER_NOT_FOUND" },
        );
      },
    );
  },
);

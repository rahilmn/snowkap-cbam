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
            memberContext(),
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
            memberContext(),
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
            memberContext(),
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
                    "createSupplier must not read the database before the capability check runs",
                  );
                },
              } as never;

            const result =
              await createSupplier(
                supabase,
                memberContext(["PRODUCER_OPERATOR"]),
                {
                  name: "Acme Steel GmbH",
                  country: "DE",
                  contactName: null,
                  contactEmail: null,
                },
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
              await createSupplier(
                mockSupabase(
                  { insertResult: { data: supplierRow, error: null } },
                ),
                memberContext(["IMPORTER_DECLARANT"]),
                {
                  name: "Acme Steel GmbH",
                  country: "DE",
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
            memberContext(),
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
            memberContext(),
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
            memberContext(),
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
            memberContext(),
            "supplier-1" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "SUPPLIER_NOT_FOUND" },
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
                    "removeSupplier must not read the database before the capability check runs",
                  );
                },
              } as never;

            const result =
              await removeSupplier(
                supabase,
                memberContext(["PRODUCER_OPERATOR"]),
                "supplier-1" as never,
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
              await removeSupplier(
                mockSupabase(
                  {},
                ),
                memberContext(["IMPORTER_DECLARANT"]),
                "supplier-1" as never,
              );

            expect(result).toEqual(
              { status: "OK" },
            );
          },
        );
      },
    );
  },
);

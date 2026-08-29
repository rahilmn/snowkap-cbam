import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createOperator,
  listOperators,
  removeOperator,
} from "./manage-operators";

import type {
  OrgContext,
} from "../organizations/org-context";

const orgId =
  "org-1" as never;

const actorUserId =
  "user-1" as never;

function memberContext(
  capabilities: OrgContext["capabilities"] = ["PRODUCER_OPERATOR"],
): OrgContext {
  return {
    org_id: orgId,
    user_id: actorUserId,
    role: "MEMBER",
    capabilities,
  };
}

const operatorRow =
  {
    id: "operator-1",
    org_id: "org-1",
    provenance: "OPERATOR_PROVIDED",
    name: "Acme Steelworks",
    country: "DE",
    contact_email: null,
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
  "listOperators",
  () => {
    it(
      "maps rows to Operator objects",
      async () => {
        const result =
          await listOperators(
            mockSupabase(
              { listResult: { data: [operatorRow], error: null } },
            ),
            orgId,
          );

        expect(result).toEqual(
          [
            {
              id: "operator-1",
              org_id: "org-1",
              provenance: "OPERATOR_PROVIDED",
              name: "Acme Steelworks",
              country: "DE",
              contact_email: null,
              created_at: "2026-01-01T00:00:00Z",
            },
          ],
        );
      },
    );

    it(
      "returns an empty array on a fetch error",
      async () => {
        const result =
          await listOperators(
            mockSupabase(
              { listResult: { data: null, error: { message: "denied" } } },
            ),
            orgId,
          );

        expect(result).toEqual(
          [],
        );
      },
    );
  },
);

describe(
  "createOperator",
  () => {
    it(
      "creates an operator with a valid country",
      async () => {
        const result =
          await createOperator(
            mockSupabase(
              { insertResult: { data: operatorRow, error: null } },
            ),
            memberContext(),
            {
              provenance: "OPERATOR_PROVIDED",
              name: "Acme Steelworks",
              country: "DE",
              contactEmail: null,
            },
          );

        expect(result).toEqual(
          { status: "OK", operator: expect.objectContaining({ name: "Acme Steelworks" }) },
        );
      },
    );

    it(
      "rejects a malformed country code",
      async () => {
        const result =
          await createOperator(
            mockSupabase(
              {},
            ),
            memberContext(),
            {
              provenance: "OPERATOR_PROVIDED",
              name: "Acme Steelworks",
              country: "Germany",
              contactEmail: null,
            },
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "INVALID_COUNTRY" },
        );
      },
    );

    it(
      "reports PERSIST_FAILED when the insert fails",
      async () => {
        const result =
          await createOperator(
            mockSupabase(
              { insertResult: { data: null, error: { message: "denied" } } },
            ),
            memberContext(),
            {
              provenance: "OPERATOR_PROVIDED",
              name: "Acme Steelworks",
              country: "DE",
              contactEmail: null,
            },
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "PERSIST_FAILED" },
        );
      },
    );

    it(
      "records an audit event on success",
      async () => {
        const auditInsertCalled =
          { value: false };

        await createOperator(
          mockSupabase(
            {
              insertResult: { data: operatorRow, error: null },
              auditInsertCalled,
            },
          ),
          memberContext(),
          {
            provenance: "OPERATOR_PROVIDED",
            name: "Acme Steelworks",
            country: "DE",
            contactEmail: null,
          },
        );

        expect(auditInsertCalled.value).toBe(
          true,
        );
      },
    );

    describe(
      "capability gate",
      () => {
        it(
          "rejects an org without PRODUCER_OPERATOR with CAPABILITY_NOT_HELD, before touching the database",
          async () => {
            const supabase =
              {
                from: () => {
                  throw new Error(
                    "createOperator must not read the database before the capability check runs",
                  );
                },
              } as never;

            const result =
              await createOperator(
                supabase,
                memberContext(["IMPORTER_DECLARANT"]),
                {
                  provenance: "OPERATOR_PROVIDED",
                  name: "Acme Steelworks",
                  country: "DE",
                  contactEmail: null,
                },
              );

            expect(result).toEqual(
              { status: "REJECTED", reason: "CAPABILITY_NOT_HELD" },
            );
          },
        );

        it(
          "allows an org holding PRODUCER_OPERATOR",
          async () => {
            const result =
              await createOperator(
                mockSupabase(
                  { insertResult: { data: operatorRow, error: null } },
                ),
                memberContext(["PRODUCER_OPERATOR"]),
                {
                  provenance: "OPERATOR_PROVIDED",
                  name: "Acme Steelworks",
                  country: "DE",
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
  "removeOperator",
  () => {
    it(
      "removes an operator",
      async () => {
        const result =
          await removeOperator(
            mockSupabase(
              {},
            ),
            memberContext(),
            "operator-1" as never,
          );

        expect(result).toEqual(
          { status: "OK" },
        );
      },
    );

    it(
      "reports PERSIST_FAILED on a delete error",
      async () => {
        const result =
          await removeOperator(
            mockSupabase(
              { deleteError: { message: "denied" } },
            ),
            memberContext(),
            "operator-1" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "PERSIST_FAILED" },
        );
      },
    );

    it(
      "rejects OPERATOR_NOT_FOUND (not OK) when the operator belongs to a different org than the caller's active org",
      async () => {
        const deleteCalled =
          { value: false };

        const auditInsertCalled =
          { value: false };

        const result =
          await removeOperator(
            mockSupabase(
              {
                ownershipFetchResult: { data: { org_id: "org-2" }, error: null },
                deleteCalled,
                auditInsertCalled,
              },
            ),
            memberContext(),
            "operator-1" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "OPERATOR_NOT_FOUND" },
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
      "reports OPERATOR_NOT_FOUND when the operator doesn't exist",
      async () => {
        const result =
          await removeOperator(
            mockSupabase(
              {
                ownershipFetchResult: { data: null, error: null },
              },
            ),
            memberContext(),
            "operator-1" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "OPERATOR_NOT_FOUND" },
        );
      },
    );

    describe(
      "capability gate",
      () => {
        it(
          "rejects an org without PRODUCER_OPERATOR with CAPABILITY_NOT_HELD, before touching the database",
          async () => {
            const supabase =
              {
                from: () => {
                  throw new Error(
                    "removeOperator must not read the database before the capability check runs",
                  );
                },
              } as never;

            const result =
              await removeOperator(
                supabase,
                memberContext(["IMPORTER_DECLARANT"]),
                "operator-1" as never,
              );

            expect(result).toEqual(
              { status: "REJECTED", reason: "CAPABILITY_NOT_HELD" },
            );
          },
        );

        it(
          "allows an org holding PRODUCER_OPERATOR",
          async () => {
            const result =
              await removeOperator(
                mockSupabase(
                  {},
                ),
                memberContext(["PRODUCER_OPERATOR"]),
                "operator-1" as never,
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

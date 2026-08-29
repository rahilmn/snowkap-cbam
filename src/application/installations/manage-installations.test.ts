import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createInstallation,
  listInstallations,
  listInstallationsByOperator,
  removeInstallation,
} from "./manage-installations";

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

const installationRow =
  {
    id: "installation-1",
    operator_id: "operator-1",
    org_id: "org-1",
    provenance: "OPERATOR_PROVIDED",
    name: "Plant 1",
    country: "DE",
    un_locode: "DEHAM",
    address: null,
    cbam_installation_id: null,
    created_at: "2026-01-01T00:00:00Z",
  };

function mockSupabase(
  {
    listResult,
    insertResult,
    operatorOwnershipResult = { data: { org_id: "org-1" }, error: null },
    installationOwnershipResult = { data: { org_id: "org-1" }, error: null },
    deleteError = null,
    deleteCalled,
    insertCalled,
    auditInsertCalled,
  }: {
    listResult?: { data: unknown; error: unknown };
    insertResult?: { data: unknown; error: unknown };
    operatorOwnershipResult?: { data: unknown; error: unknown };
    installationOwnershipResult?: { data: unknown; error: unknown };
    deleteError?: unknown;
    deleteCalled?: { value: boolean };
    insertCalled?: { value: boolean };
    auditInsertCalled?: { value: boolean };
  },
) {
  return {
    from: (
      table: string,
    ) => {
      if (table === "audit_events") {
        return {
          insert: () => {
            if (auditInsertCalled) {
              auditInsertCalled.value = true;
            }

            return Promise.resolve(
              { error: null },
            );
          },
        };
      }

      if (table === "operators") {
        return {
          select: () => (
            {
              eq: () => (
                {
                  maybeSingle: () =>
                    Promise.resolve(
                      operatorOwnershipResult,
                    ),
                }
              ),
            }
          ),
        };
      }

      // installations table
      return {
        select: () => (
          {
            eq: () => (
              {
                eq: () => (
                  {
                    order: () =>
                      Promise.resolve(
                        listResult,
                      ),
                  }
                ),

                order: () =>
                  Promise.resolve(
                    listResult,
                  ),

                maybeSingle: () =>
                  Promise.resolve(
                    installationOwnershipResult,
                  ),
              }
            ),
          }
        ),

        insert: () => {
          if (insertCalled) {
            insertCalled.value = true;
          }

          return {
            select: () => (
              {
                single: () =>
                  Promise.resolve(
                    insertResult,
                  ),
              }
            ),
          };
        },

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
      };
    },
  } as never;
}

describe(
  "listInstallations",
  () => {
    it(
      "maps rows to Installation objects",
      async () => {
        const result =
          await listInstallations(
            mockSupabase(
              { listResult: { data: [installationRow], error: null } },
            ),
            orgId,
          );

        expect(result).toEqual(
          [
            {
              id: "installation-1",
              operator_id: "operator-1",
              org_id: "org-1",
              provenance: "OPERATOR_PROVIDED",
              name: "Plant 1",
              country: "DE",
              un_locode: "DEHAM",
              address: null,
              cbam_installation_id: null,
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
          await listInstallations(
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
  "listInstallationsByOperator",
  () => {
    it(
      "maps rows to Installation objects",
      async () => {
        const result =
          await listInstallationsByOperator(
            mockSupabase(
              { listResult: { data: [installationRow], error: null } },
            ),
            orgId,
            "operator-1" as never,
          );

        expect(result).toEqual(
          [
            expect.objectContaining(
              { id: "installation-1" },
            ),
          ],
        );
      },
    );
  },
);

describe(
  "createInstallation",
  () => {
    it(
      "creates an installation for an operator owned by the caller's org",
      async () => {
        const result =
          await createInstallation(
            mockSupabase(
              { insertResult: { data: installationRow, error: null } },
            ),
            memberContext(),
            {
              operatorId: "operator-1" as never,
              provenance: "OPERATOR_PROVIDED",
              name: "Plant 1",
              country: "DE",
              unLocode: "DEHAM",
              address: null,
              cbamInstallationId: null,
            },
          );

        expect(result).toEqual(
          { status: "OK", installation: expect.objectContaining({ name: "Plant 1" }) },
        );
      },
    );

    it(
      "rejects a malformed country code",
      async () => {
        const result =
          await createInstallation(
            mockSupabase(
              {},
            ),
            memberContext(),
            {
              operatorId: "operator-1" as never,
              provenance: "OPERATOR_PROVIDED",
              name: "Plant 1",
              country: "Germany",
              unLocode: null,
              address: null,
              cbamInstallationId: null,
            },
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "INVALID_COUNTRY" },
        );
      },
    );

    it(
      "rejects OPERATOR_NOT_FOUND when the operator belongs to a different org than the caller's active org",
      async () => {
        const insertCalled =
          { value: false };

        const auditInsertCalled =
          { value: false };

        const result =
          await createInstallation(
            mockSupabase(
              {
                operatorOwnershipResult: { data: { org_id: "org-2" }, error: null },
                insertCalled,
                auditInsertCalled,
              },
            ),
            memberContext(),
            {
              operatorId: "operator-1" as never,
              provenance: "OPERATOR_PROVIDED",
              name: "Plant 1",
              country: "DE",
              unLocode: null,
              address: null,
              cbamInstallationId: null,
            },
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "OPERATOR_NOT_FOUND" },
        );

        expect(insertCalled.value).toBe(
          false,
        );

        expect(auditInsertCalled.value).toBe(
          false,
        );
      },
    );

    it(
      "rejects OPERATOR_NOT_FOUND when the operator doesn't exist",
      async () => {
        const result =
          await createInstallation(
            mockSupabase(
              {
                operatorOwnershipResult: { data: null, error: null },
              },
            ),
            memberContext(),
            {
              operatorId: "operator-1" as never,
              provenance: "OPERATOR_PROVIDED",
              name: "Plant 1",
              country: "DE",
              unLocode: null,
              address: null,
              cbamInstallationId: null,
            },
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "OPERATOR_NOT_FOUND" },
        );
      },
    );

    it(
      "reports PERSIST_FAILED when the insert fails",
      async () => {
        const result =
          await createInstallation(
            mockSupabase(
              { insertResult: { data: null, error: { message: "denied" } } },
            ),
            memberContext(),
            {
              operatorId: "operator-1" as never,
              provenance: "OPERATOR_PROVIDED",
              name: "Plant 1",
              country: "DE",
              unLocode: null,
              address: null,
              cbamInstallationId: null,
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

        await createInstallation(
          mockSupabase(
            {
              insertResult: { data: installationRow, error: null },
              auditInsertCalled,
            },
          ),
          memberContext(),
          {
            operatorId: "operator-1" as never,
            provenance: "OPERATOR_PROVIDED",
            name: "Plant 1",
            country: "DE",
            unLocode: null,
            address: null,
            cbamInstallationId: null,
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
                    "createInstallation must not read the database before the capability check runs",
                  );
                },
              } as never;

            const result =
              await createInstallation(
                supabase,
                memberContext(["IMPORTER_DECLARANT"]),
                {
                  operatorId: "operator-1" as never,
                  provenance: "OPERATOR_PROVIDED",
                  name: "Plant 1",
                  country: "DE",
                  unLocode: null,
                  address: null,
                  cbamInstallationId: null,
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
              await createInstallation(
                mockSupabase(
                  { insertResult: { data: installationRow, error: null } },
                ),
                memberContext(["PRODUCER_OPERATOR"]),
                {
                  operatorId: "operator-1" as never,
                  provenance: "OPERATOR_PROVIDED",
                  name: "Plant 1",
                  country: "DE",
                  unLocode: null,
                  address: null,
                  cbamInstallationId: null,
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
  "removeInstallation",
  () => {
    it(
      "removes an installation",
      async () => {
        const result =
          await removeInstallation(
            mockSupabase(
              {},
            ),
            memberContext(),
            "installation-1" as never,
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
          await removeInstallation(
            mockSupabase(
              { deleteError: { message: "denied" } },
            ),
            memberContext(),
            "installation-1" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "PERSIST_FAILED" },
        );
      },
    );

    it(
      "reports INSTALLATION_HAS_DEPENDENTS (not a generic PERSIST_FAILED) when a foreign-key violation blocks the delete",
      async () => {
        // 23503 = Postgres foreign_key_violation -- fired by the
        // installations.installation_id FK's ON DELETE RESTRICT on
        // emission_data/sharing_grants (20260829270000), which replaced
        // ON DELETE CASCADE specifically so a MEMBER couldn't silently
        // destroy VERIFIED emission data and sharing grants by deleting
        // their parent installation (found in P7's mandatory review).
        const result =
          await removeInstallation(
            mockSupabase(
              { deleteError: { code: "23503", message: "violates foreign key constraint" } },
            ),
            memberContext(),
            "installation-1" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "INSTALLATION_HAS_DEPENDENTS" },
        );
      },
    );

    it(
      "rejects INSTALLATION_NOT_FOUND (not OK) when the installation belongs to a different org than the caller's active org",
      async () => {
        const deleteCalled =
          { value: false };

        const auditInsertCalled =
          { value: false };

        const result =
          await removeInstallation(
            mockSupabase(
              {
                installationOwnershipResult: { data: { org_id: "org-2" }, error: null },
                deleteCalled,
                auditInsertCalled,
              },
            ),
            memberContext(),
            "installation-1" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "INSTALLATION_NOT_FOUND" },
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
      "reports INSTALLATION_NOT_FOUND when the installation doesn't exist",
      async () => {
        const result =
          await removeInstallation(
            mockSupabase(
              {
                installationOwnershipResult: { data: null, error: null },
              },
            ),
            memberContext(),
            "installation-1" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "INSTALLATION_NOT_FOUND" },
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
                    "removeInstallation must not read the database before the capability check runs",
                  );
                },
              } as never;

            const result =
              await removeInstallation(
                supabase,
                memberContext(["IMPORTER_DECLARANT"]),
                "installation-1" as never,
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
              await removeInstallation(
                mockSupabase(
                  {},
                ),
                memberContext(["PRODUCER_OPERATOR"]),
                "installation-1" as never,
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

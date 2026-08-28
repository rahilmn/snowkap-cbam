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

const orgId =
  "org-1" as never;

const actorUserId =
  "user-1" as never;

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
            orgId,
            actorUserId,
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
            orgId,
            actorUserId,
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
            orgId,
            actorUserId,
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
            orgId,
            actorUserId,
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
            orgId,
            actorUserId,
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
          orgId,
          actorUserId,
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
            orgId,
            actorUserId,
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
            orgId,
            actorUserId,
            "installation-1" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "PERSIST_FAILED" },
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
            orgId,
            actorUserId,
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
            orgId,
            actorUserId,
            "installation-1" as never,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "INSTALLATION_NOT_FOUND" },
        );
      },
    );
  },
);

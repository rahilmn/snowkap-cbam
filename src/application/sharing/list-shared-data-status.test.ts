import {
  describe,
  expect,
  it,
} from "vitest";

import {
  listSharedDataStatus,
} from "./list-shared-data-status";

const orgId =
  "org-1" as never;

const directGrantRow =
  {
    id: "grant-1",
    grantor_org_id: "org-1",
    grantee_org_id: "org-2",
    invited_email: null,
    installation_id: "installation-1",
    status: "ACTIVE",
    created_by_user_id: "admin-1",
    expires_at: null,
    created_at: "2026-01-02T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
  };

const revokedGrantRow =
  {
    id: "grant-2",
    grantor_org_id: "org-1",
    grantee_org_id: "org-3",
    invited_email: null,
    installation_id: "installation-1",
    status: "REVOKED",
    created_by_user_id: "admin-1",
    expires_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:05:00Z",
  };

const pendingBootstrapGrantRow =
  {
    id: "grant-3",
    grantor_org_id: "org-1",
    grantee_org_id: null,
    invited_email: "ops@example.com",
    installation_id: "installation-2",
    status: "INVITED",
    created_by_user_id: "admin-1",
    expires_at: null,
    created_at: "2026-01-03T00:00:00Z",
    updated_at: "2026-01-03T00:00:00Z",
  };

/**
 * Same generic chainable mock as manage-sharing-grants.test.ts's own
 * makeMockSupabase (itself carried over from manage-emission-data.test.ts)
 * -- reused verbatim rather than re-derived, since this module issues the
 * same "select from a table, optionally .eq/.in/.order, then resolve"
 * call shape those mocks already cover, just against more tables
 * (sharing_grants, installations, organizations, audit_events).
 */
function makeMockSupabase(
  tables: Record<string, { data: unknown; error: unknown }>,
) {
  function builder(
    table: string,
  ) {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      then: (
        resolve: (value: { data: unknown; error: unknown }) => unknown,
        reject: (reason: unknown) => unknown,
      ) =>
        Promise.resolve(
          tables[table] ?? { data: null, error: null },
        ).then(resolve, reject),
    };

    return chain;
  }

  return {
    from: (table: string) => builder(table),
  } as never;
}

describe(
  "listSharedDataStatus",
  () => {
    it(
      "returns an empty array when the org has issued no grants",
      async () => {
        const result =
          await listSharedDataStatus(
            makeMockSupabase(
              {
                sharing_grants: { data: [], error: null },
              },
            ),
            orgId,
          );

        expect(result).toEqual(
          [],
        );
      },
    );

    it(
      "returns an empty array on a fetch error for the grants themselves",
      async () => {
        const result =
          await listSharedDataStatus(
            makeMockSupabase(
              {
                sharing_grants: { data: null, error: { message: "denied" } },
              },
            ),
            orgId,
          );

        expect(result).toEqual(
          [],
        );
      },
    );

    it(
      "resolves the grantee org's name for a direct grant, and the installation's name",
      async () => {
        const result =
          await listSharedDataStatus(
            makeMockSupabase(
              {
                sharing_grants: { data: [directGrantRow], error: null },
                installations: {
                  data: [{ id: "installation-1", name: "Duisburg Plant" }],
                  error: null,
                },
                organizations: {
                  data: [{ id: "org-2", name: "Acme Steel GmbH" }],
                  error: null,
                },
                audit_events: { data: [], error: null },
              },
            ),
            orgId,
          );

        expect(result).toHaveLength(
          1,
        );

        expect(result[0]!.installationName).toBe(
          "Duisburg Plant",
        );

        expect(result[0]!.granteeLabel).toBe(
          "Acme Steel GmbH",
        );

        expect(result[0]!.consumptionEvents).toEqual(
          [],
        );
      },
    );

    it(
      "still resolves the grantee org's name for a REVOKED grant -- history is not hidden once revoked",
      async () => {
        const result =
          await listSharedDataStatus(
            makeMockSupabase(
              {
                sharing_grants: { data: [revokedGrantRow], error: null },
                installations: {
                  data: [{ id: "installation-1", name: "Duisburg Plant" }],
                  error: null,
                },
                organizations: {
                  data: [{ id: "org-3", name: "Contoso Imports Ltd" }],
                  error: null,
                },
                audit_events: { data: [], error: null },
              },
            ),
            orgId,
          );

        expect(result[0]!.grant.status).toBe(
          "REVOKED",
        );

        expect(result[0]!.granteeLabel).toBe(
          "Contoso Imports Ltd",
        );
      },
    );

    it(
      "renders a still-pending bootstrap (invited-by-email) grant honestly -- no org to resolve yet",
      async () => {
        const result =
          await listSharedDataStatus(
            makeMockSupabase(
              {
                sharing_grants: { data: [pendingBootstrapGrantRow], error: null },
                installations: {
                  data: [{ id: "installation-2", name: "Second Plant" }],
                  error: null,
                },
                organizations: { data: [], error: null },
                audit_events: { data: [], error: null },
              },
            ),
            orgId,
          );

        expect(result[0]!.granteeLabel).toBe(
          "Pending invite: ops@example.com",
        );
      },
    );

    it(
      "renders honestly, not fabricated, when a grantee_org_id genuinely fails to resolve to a name (e.g. lookup gap)",
      async () => {
        const result =
          await listSharedDataStatus(
            makeMockSupabase(
              {
                sharing_grants: { data: [directGrantRow], error: null },
                installations: {
                  data: [{ id: "installation-1", name: "Duisburg Plant" }],
                  error: null,
                },
                // organizations lookup comes back empty -- org-2 not in it.
                organizations: { data: [], error: null },
                audit_events: { data: [], error: null },
              },
            ),
            orgId,
          );

        expect(result[0]!.granteeLabel).toBe(
          "Unknown organization",
        );
      },
    );

    it(
      "groups consumption events under the grant they belong to (matched on aggregate_id), most recent first",
      async () => {
        const result =
          await listSharedDataStatus(
            makeMockSupabase(
              {
                sharing_grants: { data: [directGrantRow], error: null },
                installations: {
                  data: [{ id: "installation-1", name: "Duisburg Plant" }],
                  error: null,
                },
                organizations: {
                  data: [{ id: "org-2", name: "Acme Steel GmbH" }],
                  error: null,
                },
                audit_events: {
                  data: [
                    {
                      id: "event-2",
                      occurred_at: "2026-02-02T00:00:00Z",
                      actor_user_id: "user-importer-2",
                      aggregate_id: "grant-1",
                      payload: {
                        installation_id: "installation-1",
                        emission_data_id: "ed-1",
                        emission_data_version: 2,
                        consuming_org_id: "org-2",
                        shipment_line_id: "line-2",
                        determination_kind: "REDETERMINED",
                      },
                    },
                    {
                      id: "event-1",
                      occurred_at: "2026-02-01T00:00:00Z",
                      actor_user_id: "user-importer-1",
                      aggregate_id: "grant-1",
                      payload: {
                        installation_id: "installation-1",
                        emission_data_id: "ed-1",
                        emission_data_version: 1,
                        consuming_org_id: "org-2",
                        shipment_line_id: "line-1",
                        determination_kind: "DETERMINED",
                      },
                    },
                    {
                      id: "event-unrelated",
                      occurred_at: "2026-02-03T00:00:00Z",
                      actor_user_id: "user-importer-3",
                      // A different grant's own aggregate_id -- must
                      // never bleed into grant-1's event list, even
                      // though it is the same org_id's audit stream.
                      aggregate_id: "grant-999",
                      payload: {},
                    },
                  ],
                  error: null,
                },
              },
            ),
            orgId,
          );

        expect(result[0]!.consumptionEvents).toHaveLength(
          2,
        );

        expect(
          result[0]!.consumptionEvents.map((event) => event.id),
        ).toEqual(
          [
            "event-2",
            "event-1",
          ],
        );

        expect(result[0]!.consumptionEvents[0]).toMatchObject(
          {
            id: "event-2",
            determinationKind: "REDETERMINED",
            emissionDataVersion: 2,
          },
        );
      },
    );

    it(
      "degrades to an empty consumption-events list per grant (not a blanket failure) when the audit_events lookup itself errors",
      async () => {
        const result =
          await listSharedDataStatus(
            makeMockSupabase(
              {
                sharing_grants: { data: [directGrantRow], error: null },
                installations: {
                  data: [{ id: "installation-1", name: "Duisburg Plant" }],
                  error: null,
                },
                organizations: {
                  data: [{ id: "org-2", name: "Acme Steel GmbH" }],
                  error: null,
                },
                audit_events: { data: null, error: { message: "denied" } },
              },
            ),
            orgId,
          );

        expect(result).toHaveLength(
          1,
        );

        expect(result[0]!.granteeLabel).toBe(
          "Acme Steel GmbH",
        );

        expect(result[0]!.consumptionEvents).toEqual(
          [],
        );
      },
    );

    it(
      "returns an empty array when the installation or organization name lookups themselves error",
      async () => {
        const result =
          await listSharedDataStatus(
            makeMockSupabase(
              {
                sharing_grants: { data: [directGrantRow], error: null },
                installations: { data: null, error: { message: "denied" } },
                organizations: {
                  data: [{ id: "org-2", name: "Acme Steel GmbH" }],
                  error: null,
                },
                audit_events: { data: [], error: null },
              },
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

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

/**
 * 2026-09-03 (P14). A bootstrap grant that was genuinely ACCEPTED and
 * then revoked: invited_email retained, grantee_org_id resolved. Only
 * public.accept_sharing_grant_invitation() can produce that combination
 * -- a bootstrap row starts with grantee_org_id NULL, the ordinary
 * grantee-accept policy cannot populate it, and (since 20260902150000) a
 * BEFORE INSERT trigger forbids minting the shape directly. It is
 * therefore the acceptance proof the grantor-side disclosure rule keys
 * on, and it is the only shape the product own UI can create.
 */
const acceptedThenRevokedBootstrapGrantRow =
  {
    id: "grant-4",
    grantor_org_id: "org-1",
    grantee_org_id: "org-3",
    invited_email: "ops@contoso.example.com",
    installation_id: "installation-1",
    status: "REVOKED",
    created_by_user_id: "admin-1",
    expires_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:05:00Z",
  };

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
  recorder: { fromCalls: string[] } = { fromCalls: [] },
) {
  function builder(
    table: string,
  ) {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      // 2026-09-07 (S5 review round 3, findings S5R3-SES-01/S5R3-VOCAB-B2/
      // S5R3-SHARE-B1): fetchAllConsumptionAuditEvents now pages the
      // audit_events query with .range(). Every existing fixture here
      // returns well under AUDIT_EVENTS_PAGE_SIZE rows, so the paging
      // loop always terminates after its first page -- this mock stays a
      // one-shot resolver, .range() is a pure pass-through.
      range: () => chain,
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
    from: (table: string) => {
      recorder.fromCalls.push(table);
      return builder(table);
    },

    // 2026-09-03 (P14): the grantee-org-name lookup moved from a direct
    // `organizations` read to public.sharing_counterparty_org_names(),
    // because a grantor has no membership in its grantee's org and the
    // RLS policy that used to carry it is gated to status = 'ACTIVE' --
    // so the producer's own transparency screen stopped being able to
    // name the org it had shared with the moment a grant was revoked.
    // Keyed on "organizations" here so every existing fixture in this
    // file keeps its exact meaning, matching the same convention in
    // list-available-actual-data.test.ts.
    rpc: (fnName: string) => {
      recorder.fromCalls.push(`rpc:${fnName}`);
      return Promise.resolve(
        tables.organizations ?? { data: null, error: null },
      );
    },
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
      "2026-09-06 (S5 review remediation round 2, finding S5R2-B-01): THROWS on a fetch error for the grants themselves -- never a fabricated 'no grants issued' all-clear",
      async () => {
        await expect(
          listSharedDataStatus(
            makeMockSupabase(
              {
                sharing_grants: { data: null, error: { message: "denied" } },
              },
            ),
            orgId,
          ),
        ).rejects.toThrow(
          "denied",
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

    /**
     * 2026-09-03 (P14). This test previously used revokedGrantRow -- a
     * REVOKED DIRECT grant -- to express "history is not hidden once
     * revoked". The intent was right; the fixture was not, for two
     * reasons.
     *
     * First, it asserted behaviour production never had. The name map it
     * was handed came from an RLS-scoped organizations read, and
     * organizations_select_via_own_issued_sharing_grant is gated to
     * status = ACTIVE -- so in production this exact scenario returned no
     * row and rendered "Unknown organization". The test passed only
     * because the mock supplied a map the real query could not.
     *
     * Second, and the reason the fixture cannot simply be kept: a
     * REVOKED direct grant is indistinguishable from the sham-grant
     * attack 20260829320000 closed. An attacker who knows a victim org
     * uuid can insert an INVITED direct grant naming it (status is forced
     * INVITED at insert) and then revoke their own grant. If a terminal
     * direct grant disclosed its grantee name, that sequence would turn a
     * known uuid into the victim organization name, with no acceptance
     * and no notice.
     *
     * So the intent is preserved with a fixture that carries acceptance
     * proof -- which is also the only shape the product own UI can create
     * -- and the direct-grant boundary is pinned explicitly below rather
     * than left implicit.
     */
    it(
      "still resolves the grantee org name for a REVOKED grant the grantee genuinely accepted -- history is not hidden once revoked",
      async () => {
        const result =
          await listSharedDataStatus(
            makeMockSupabase(
              {
                sharing_grants: {
                  data: [acceptedThenRevokedBootstrapGrantRow],
                  error: null,
                },
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
          "Contoso Imports Ltd (accepted via invite to ops@contoso.example.com)",
        );
      },
    );

    it(
      "does NOT resolve the grantee org name for a REVOKED DIRECT grant -- it carries no acceptance proof, and a self-issued self-revoked sham grant must never name a victim",
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
                // The RPC legitimately returns this name for an unrelated
                // reason: its result set spans every org the USER has any
                // grant relationship with, in both directions. That is
                // exactly why the label must re-gate per grant instead of
                // trusting the map.
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
          "Unknown organization",
        );
      },
    );

    it(
      "resolves grantee names through the counterparty RPC, never through a direct organizations read",
      async () => {
        // A grantor has no membership in its grantee org, so a direct
        // read is RLS-empty by construction. Pinning the call shape stops
        // a future refactor from quietly reintroducing one and
        // rediscovering "Unknown organization" in production.
        const recorder =
          { fromCalls: [] as string[] };

        await listSharedDataStatus(
          makeMockSupabase(
            {
              sharing_grants: {
                data: [acceptedThenRevokedBootstrapGrantRow],
                error: null,
              },
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
            recorder,
          ),
          orgId,
        );

        expect(recorder.fromCalls).toContain(
          "rpc:sharing_counterparty_org_names",
        );

        expect(recorder.fromCalls).not.toContain(
          "organizations",
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

        // 2026-09-06 (S5 review remediation round 2, finding S5R2-B-01):
        // this must be distinguishable from a genuinely empty history --
        // consumptionEvents alone being [] does not tell the caller
        // whether the lookup failed or the grantee simply hasn't used
        // the data yet.
        expect(result[0]!.consumptionEventsUnavailable).toBe(
          true,
        );
      },
    );

    it(
      "2026-09-06 (S5 review remediation round 2, finding S5R2-B-01): consumptionEventsUnavailable is false when the audit_events lookup succeeds, even with zero rows",
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

        expect(result[0]!.consumptionEvents).toEqual(
          [],
        );

        expect(result[0]!.consumptionEventsUnavailable).toBe(
          false,
        );
      },
    );

    it(
      "2026-09-07 (S5 review round 3, findings S5R3-SES-01/S5R3-VOCAB-B2/S5R3-SHARE-B1): pages past PostgREST's max_rows cap instead of silently truncating -- a combined consumption history over 1000 events is not cut off at the 1000th",
      async () => {
        const firstPage =
          Array.from(
            { length: 1000 },
            (_, index) => (
              {
                id: `event-page1-${index}`,
                occurred_at: "2026-02-01T00:00:00Z",
                actor_user_id: null,
                aggregate_id: "grant-1",
                payload: {},
              }
            ),
          );

        const secondPage =
          [
            {
              id: "event-page2-0",
              occurred_at: "2026-01-01T00:00:00Z",
              actor_user_id: null,
              aggregate_id: "grant-1",
              payload: {},
            },
          ];

        let auditEventsCallCount =
          0;

        const rangesRequested: [number, number][] =
          [];

        const supabase =
          {
            from: (table: string) => {
              if (table !== "audit_events") {
                // 2026-09-07 (S5 review round 4, finding S5R4-SHARE-02):
                // the sharing_grants query now pages with .range() too
                // (two .order() calls then .range()). This fixture
                // returns a single row, well under
                // SHARING_GRANTS_PAGE_SIZE, so the paging loop always
                // terminates after its first page.
                return {
                  select: () => ({
                    eq: () => ({
                      order: () => ({
                        order: () => ({
                          range: () =>
                            Promise.resolve(
                              table === "sharing_grants"
                                ? { data: [directGrantRow], error: null }
                                : { data: [{ id: "installation-1", name: "Duisburg Plant" }], error: null },
                            ),
                        }),
                      }),
                    }),
                    in: () =>
                      Promise.resolve(
                        { data: [{ id: "installation-1", name: "Duisburg Plant" }], error: null },
                      ),
                  }),
                } as never;
              }

              const chain: Record<string, unknown> = {
                select: () => chain,
                eq: () => chain,
                in: () => chain,
                order: () => chain,
                range: (from: number, to: number) => {
                  rangesRequested.push(
                    [from, to],
                  );

                  return chain;
                },
                then: (
                  resolve: (value: { data: unknown; error: unknown }) => unknown,
                ) => {
                  auditEventsCallCount +=
                    1;

                  return Promise.resolve(
                    auditEventsCallCount === 1
                      ? { data: firstPage, error: null }
                      : { data: secondPage, error: null },
                  ).then(
                    resolve,
                  );
                },
              };

              return chain;
            },
            rpc: () =>
              Promise.resolve(
                { data: [{ id: "org-2", name: "Acme Steel GmbH" }], error: null },
              ),
          } as never;

        const result =
          await listSharedDataStatus(
            supabase,
            orgId,
          );

        expect(auditEventsCallCount).toBe(
          2,
        );

        expect(rangesRequested).toEqual(
          [
            [0, 999],
            [1000, 1999],
          ],
        );

        expect(result[0]!.consumptionEvents).toHaveLength(
          1001,
        );

        expect(result[0]!.consumptionEventsUnavailable).toBe(
          false,
        );
      },
    );

    it(
      "2026-09-06 (S5 review remediation round 2, finding S5R2-B-01): THROWS when the installation or organization name lookups themselves error -- previously blanked genuinely-fetched grants",
      async () => {
        await expect(
          listSharedDataStatus(
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
          ),
        ).rejects.toThrow(
          "denied",
        );
      },
    );

    it(
      "2026-09-07 (S5 review round 7, finding S5R7-A-2): chunks the installations lookup rather than issuing one oversized .in() call, when the org's issued grants span more than SHARING_GRANT_ID_CHUNK_SIZE distinct installations",
      async () => {
        const GRANT_COUNT =
          150;

        const grantRows =
          Array.from(
            { length: GRANT_COUNT },
            (_, index) => (
              {
                ...directGrantRow,
                id: `grant-chunk-${index}`,
                installation_id: `installation-chunk-${index}`,
              }
            ),
          );

        const installationRows =
          Array.from(
            { length: GRANT_COUNT },
            (_, index) => (
              {
                id: `installation-chunk-${index}`,
                name: `Installation ${index}`,
              }
            ),
          );

        const recorder =
          { fromCalls: [] as string[] };

        const result =
          await listSharedDataStatus(
            makeMockSupabase(
              {
                sharing_grants: { data: grantRows, error: null },
                installations: { data: installationRows, error: null },
                organizations: { data: [{ id: "org-2", name: "Acme Steel GmbH" }], error: null },
                audit_events: { data: [], error: null },
              },
              recorder,
            ),
            orgId,
          );

        expect(result).toHaveLength(
          GRANT_COUNT,
        );

        // 150 ids at SHARING_GRANT_ID_CHUNK_SIZE=100 -- exactly 2
        // chunks, so exactly 2 separate `installations` queries AND 2
        // separate `audit_events` queries, never 1 (the old,
        // oversized-.in() shape for either).
        expect(
          recorder.fromCalls.filter(
            (name) => name === "installations",
          ),
        ).toHaveLength(
          2,
        );

        expect(
          recorder.fromCalls.filter(
            (name) => name === "audit_events",
          ),
        ).toHaveLength(
          2,
        );
      },
    );
  },
);

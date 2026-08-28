import {
  describe,
  expect,
  it,
} from "vitest";

import {
  getCurrentOrgSummary,
} from "./get-current-org-context";

const orgAId =
  "org-a";

const orgBId =
  "org-b";

const meId =
  "user-me";

/**
 * memberships_select_own_org's RLS policy scopes visibility to "any
 * row in an org I belong to" (so the Team screen can list teammates),
 * not "only my own row" -- this fixture includes a teammate's row in
 * the same org as `me`, exactly what a real RLS-scoped query returns.
 * A correct implementation must additionally filter by user_id
 * itself; this mock's .eq() actually applies that filter (rather than
 * ignoring it), so a regression that drops the .eq("user_id", ...)
 * call from get-current-org-context.ts causes this test to fail by
 * returning the teammate's row instead of `me`'s.
 */
const membershipRows =
  [
    {
      org_id: orgAId,
      user_id: meId,
      role: "MEMBER",
      created_at: "2026-01-01T00:00:00Z",
      organizations: { name: "Org A", capabilities: ["IMPORTER_DECLARANT"] },
    },
    {
      org_id: orgAId,
      user_id: "user-teammate",
      role: "OWNER",
      created_at: "2026-01-01T00:00:00Z",
      organizations: { name: "Org A", capabilities: ["IMPORTER_DECLARANT"] },
    },
    {
      org_id: orgBId,
      user_id: meId,
      role: "ADMIN",
      created_at: "2026-01-02T00:00:00Z",
      organizations: { name: "Org B", capabilities: ["PRODUCER_OPERATOR"] },
    },
  ];

function mockSupabase() {
  return {
    auth: {
      getUser: () =>
        Promise.resolve(
          { data: { user: { id: meId } } },
        ),
    },

    from: () => (
      {
        select: () => (
          {
            eq: (
              field: string,
              value: string,
            ) => (
              {
                order: () =>
                  Promise.resolve(
                    {
                      data: membershipRows.filter(
                        (row) =>
                          (row as never)[field] === value,
                      ),
                      error: null,
                    },
                  ),
              }
            ),
          }
        ),
      }
    ),
  } as never;
}

describe(
  "getCurrentOrgSummary",
  () => {
    it(
      "resolves the caller's own role, not a teammate's, in an org with other members",
      async () => {
        const summary =
          await getCurrentOrgSummary(
            mockSupabase(),
          );

        expect(summary?.context.role).toBe(
          "MEMBER",
        );

        expect(summary?.context.org_id).toBe(
          orgAId,
        );
      },
    );

    it(
      "lists every org the caller belongs to for the switcher, without teammates' rows",
      async () => {
        const summary =
          await getCurrentOrgSummary(
            mockSupabase(),
          );

        expect(summary?.availableOrganizations).toEqual(
          [
            {
              orgId: orgAId,
              organizationName: "Org A",
              role: "MEMBER",
              capabilities: ["IMPORTER_DECLARANT"],
            },
            {
              orgId: orgBId,
              organizationName: "Org B",
              role: "ADMIN",
              capabilities: ["PRODUCER_OPERATOR"],
            },
          ],
        );
      },
    );

    it(
      "switches to the preferred org when it matches one of the caller's memberships",
      async () => {
        const summary =
          await getCurrentOrgSummary(
            mockSupabase(),
            orgBId,
          );

        expect(summary?.context.org_id).toBe(
          orgBId,
        );

        expect(summary?.context.role).toBe(
          "ADMIN",
        );
      },
    );

    it(
      "falls back to the oldest membership when the preferred org doesn't match any",
      async () => {
        const summary =
          await getCurrentOrgSummary(
            mockSupabase(),
            "org-not-a-member-of",
          );

        expect(summary?.context.org_id).toBe(
          orgAId,
        );
      },
    );
  },
);

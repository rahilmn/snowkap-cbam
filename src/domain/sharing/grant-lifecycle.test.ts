import {
  describe,
  expect,
  it,
} from "vitest";

import {
  transitionSharingGrant,
} from "./grant-lifecycle";

import type {
  SharingGrant,
} from "./types";

function grant(
  overrides: Partial<SharingGrant> = {},
): SharingGrant {
  return {
    id: "grant-1" as never,
    grantor_org_id: "org-producer" as never,
    grantee_org_id: null,
    invited_email: "buyer@example.com",
    installation_id: "inst-1" as never,
    status: "INVITED",
    created_by_user_id: "user-1" as never,
    expires_at: null,
    created_at: "2026-08-28T00:00:00.000Z" as never,
    updated_at: "2026-08-28T00:00:00.000Z" as never,
    ...overrides,
  };
}

describe(
  "transitionSharingGrant",
  () => {
    describe(
      "ACCEPT",
      () => {
        it(
          "moves INVITED -> ACTIVE and resolves the grantee org",
          () => {
            const result =
              transitionSharingGrant(
                grant(),
                {
                  action: "ACCEPT",
                  granteeOrgId: "org-importer" as never,
                  now: "2026-08-29T00:00:00.000Z" as never,
                },
              );

            expect(result).toEqual(
              {
                status: "OK",
                grant: grant({
                  status: "ACTIVE",
                  grantee_org_id: "org-importer" as never,
                }),
              },
            );
          },
        );

        it(
          "rejects accepting a grant that isn't INVITED",
          () => {
            const result =
              transitionSharingGrant(
                grant({ status: "ACTIVE", grantee_org_id: "org-importer" as never }),
                {
                  action: "ACCEPT",
                  granteeOrgId: "org-importer" as never,
                  now: "2026-08-29T00:00:00.000Z" as never,
                },
              );

            expect(result).toEqual(
              { status: "REJECTED", reason: "GRANT_NOT_INVITED" },
            );
          },
        );

        it(
          // 2026-08-29 (P11 finding #5, live-reproduced): the exact
          // CAS UPDATE acceptSharingGrant used to issue against a
          // grant expired 400 days accepted it cleanly. This is the
          // regression test.
          "rejects accepting a grant whose expires_at has already lapsed",
          () => {
            const result =
              transitionSharingGrant(
                grant({ expires_at: "2025-07-25T00:00:00.000Z" as never }),
                {
                  action: "ACCEPT",
                  granteeOrgId: "org-importer" as never,
                  now: "2026-08-29T00:00:00.000Z" as never,
                },
              );

            expect(result).toEqual(
              { status: "REJECTED", reason: "GRANT_EXPIRED" },
            );
          },
        );

        it(
          "rejects accepting a grant at the EXACT instant expires_at is reached (expiry is inclusive, matching EXPIRE's own >= semantics)",
          () => {
            const result =
              transitionSharingGrant(
                grant({ expires_at: "2026-08-29T00:00:00.000Z" as never }),
                {
                  action: "ACCEPT",
                  granteeOrgId: "org-importer" as never,
                  now: "2026-08-29T00:00:00.000Z" as never,
                },
              );

            expect(result).toEqual(
              { status: "REJECTED", reason: "GRANT_EXPIRED" },
            );
          },
        );

        it(
          "accepts a grant whose expires_at is still in the future",
          () => {
            const result =
              transitionSharingGrant(
                grant({ expires_at: "2027-01-01T00:00:00.000Z" as never }),
                {
                  action: "ACCEPT",
                  granteeOrgId: "org-importer" as never,
                  now: "2026-08-29T00:00:00.000Z" as never,
                },
              );

            expect(result.status).toBe("OK");
          },
        );

        it(
          "accepts a grant with no expires_at at all (never auto-expires)",
          () => {
            const result =
              transitionSharingGrant(
                grant({ expires_at: null }),
                {
                  action: "ACCEPT",
                  granteeOrgId: "org-importer" as never,
                  now: "2026-08-29T00:00:00.000Z" as never,
                },
              );

            expect(result.status).toBe("OK");
          },
        );
      },
    );

    describe(
      "REVOKE",
      () => {
        it(
          "moves ACTIVE -> REVOKED",
          () => {
            const result =
              transitionSharingGrant(
                grant({ status: "ACTIVE", grantee_org_id: "org-importer" as never }),
                { action: "REVOKE" },
              );

            expect(result).toEqual(
              {
                status: "OK",
                grant: grant({ status: "REVOKED", grantee_org_id: "org-importer" as never }),
              },
            );
          },
        );

        it(
          "allows revoking a still-pending INVITED grant",
          () => {
            const result =
              transitionSharingGrant(
                grant(),
                { action: "REVOKE" },
              );

            expect(result).toEqual(
              { status: "OK", grant: grant({ status: "REVOKED" }) },
            );
          },
        );

        it(
          "rejects revoking an already-terminal grant",
          () => {
            const result =
              transitionSharingGrant(
                grant({ status: "REVOKED" }),
                { action: "REVOKE" },
              );

            expect(result).toEqual(
              { status: "REJECTED", reason: "ALREADY_TERMINAL" },
            );
          },
        );

        it(
          "rejects revoking an EXPIRED grant",
          () => {
            const result =
              transitionSharingGrant(
                grant({ status: "EXPIRED" }),
                { action: "REVOKE" },
              );

            expect(result).toEqual(
              { status: "REJECTED", reason: "ALREADY_TERMINAL" },
            );
          },
        );
      },
    );

    describe(
      "EXPIRE",
      () => {
        it(
          "moves ACTIVE -> EXPIRED when past expires_at",
          () => {
            const result =
              transitionSharingGrant(
                grant({
                  status: "ACTIVE",
                  grantee_org_id: "org-importer" as never,
                  expires_at: "2026-01-01T00:00:00.000Z" as never,
                }),
                { action: "EXPIRE", now: "2026-06-01T00:00:00.000Z" as never },
              );

            expect(result).toEqual(
              {
                status: "OK",
                grant: grant({
                  status: "EXPIRED",
                  grantee_org_id: "org-importer" as never,
                  expires_at: "2026-01-01T00:00:00.000Z" as never,
                }),
              },
            );
          },
        );

        it(
          "rejects expiring a grant with no expiry set",
          () => {
            const result =
              transitionSharingGrant(
                grant({ status: "ACTIVE", grantee_org_id: "org-importer" as never }),
                { action: "EXPIRE", now: "2026-06-01T00:00:00.000Z" as never },
              );

            expect(result).toEqual(
              { status: "REJECTED", reason: "NOT_YET_EXPIRED" },
            );
          },
        );

        it(
          "rejects expiring a grant before its expires_at",
          () => {
            const result =
              transitionSharingGrant(
                grant({
                  status: "ACTIVE",
                  grantee_org_id: "org-importer" as never,
                  expires_at: "2026-12-01T00:00:00.000Z" as never,
                }),
                { action: "EXPIRE", now: "2026-06-01T00:00:00.000Z" as never },
              );

            expect(result).toEqual(
              { status: "REJECTED", reason: "NOT_YET_EXPIRED" },
            );
          },
        );

        it(
          // 2026-08-29 (P11 finding #5's own residual note): an
          // INVITED grant that simply lapsed without ever being
          // accepted could not reach EXPIRED through this function at
          // all before this fix -- only accept_sharing_grant_invitation's
          // own raw-SQL lazy-expire covered that case, and only for
          // the bootstrap path. This closes the gap in the pure state
          // machine itself.
          "moves INVITED -> EXPIRED when past expires_at, even though it was never accepted",
          () => {
            const result =
              transitionSharingGrant(
                grant({
                  status: "INVITED",
                  expires_at: "2026-01-01T00:00:00.000Z" as never,
                }),
                { action: "EXPIRE", now: "2026-06-01T00:00:00.000Z" as never },
              );

            expect(result).toEqual(
              {
                status: "OK",
                grant: grant({
                  status: "EXPIRED",
                  expires_at: "2026-01-01T00:00:00.000Z" as never,
                }),
              },
            );
          },
        );

        it(
          "rejects expiring an INVITED grant that hasn't lapsed yet",
          () => {
            const result =
              transitionSharingGrant(
                grant({
                  status: "INVITED",
                  expires_at: "2026-12-01T00:00:00.000Z" as never,
                }),
                { action: "EXPIRE", now: "2026-06-01T00:00:00.000Z" as never },
              );

            expect(result).toEqual(
              { status: "REJECTED", reason: "NOT_YET_EXPIRED" },
            );
          },
        );
      },
    );
  },
);

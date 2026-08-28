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
                { action: "ACCEPT", granteeOrgId: "org-importer" as never },
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
                { action: "ACCEPT", granteeOrgId: "org-importer" as never },
              );

            expect(result).toEqual(
              { status: "REJECTED", reason: "GRANT_NOT_INVITED" },
            );
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
      },
    );
  },
);

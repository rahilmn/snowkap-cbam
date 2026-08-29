import {
  describe,
  expect,
  it,
} from "vitest";

import {
  toSharingGrant,
} from "./sharing-grant-mapper";

import type {
  SharingGrantRow,
} from "./sharing-grant-mapper";

function sharingGrantRow(
  overrides: Partial<SharingGrantRow> = {},
): SharingGrantRow {
  return {
    id: "grant-1",
    grantor_org_id: "org-producer",
    grantee_org_id: "org-importer",
    invited_email: null,
    installation_id: "inst-1",
    status: "ACTIVE",
    created_by_user_id: "user-1",
    expires_at: "2027-08-28T00:00:00.000Z",
    created_at: "2026-08-28T00:00:00.000Z",
    updated_at: "2026-08-29T00:00:00.000Z",
    ...overrides,
  };
}

describe(
  "toSharingGrant",
  () => {
    it(
      "maps a resolved ACTIVE grant row onto every SharingGrant field",
      () => {
        const row =
          sharingGrantRow();

        const result =
          toSharingGrant(
            row,
          );

        expect(
          result,
        ).toEqual(
          {
            id: "grant-1",
            grantor_org_id: "org-producer",
            grantee_org_id: "org-importer",
            invited_email: null,
            installation_id: "inst-1",
            status: "ACTIVE",
            created_by_user_id: "user-1",
            expires_at: "2027-08-28T00:00:00.000Z",
            created_at: "2026-08-28T00:00:00.000Z",
            updated_at: "2026-08-29T00:00:00.000Z",
          },
        );
      },
    );

    it(
      "passes through a null grantee_org_id and a non-null invited_email for an unaccepted bootstrap invite",
      () => {
        const row =
          sharingGrantRow(
            {
              grantee_org_id: null,
              invited_email: "buyer@example.com",
              status: "INVITED",
              expires_at: null,
            },
          );

        const result =
          toSharingGrant(
            row,
          );

        expect(
          result.grantee_org_id,
        ).toBeNull();

        expect(
          result.invited_email,
        ).toBe(
          "buyer@example.com",
        );

        expect(
          result.status,
        ).toBe(
          "INVITED",
        );

        expect(
          result.expires_at,
        ).toBeNull();
      },
    );

    it(
      "passes REVOKED and EXPIRED statuses through unchanged",
      () => {
        expect(
          toSharingGrant(
            sharingGrantRow(
              {
                status: "REVOKED",
              },
            ),
          ).status,
        ).toBe(
          "REVOKED",
        );

        expect(
          toSharingGrant(
            sharingGrantRow(
              {
                status: "EXPIRED",
              },
            ),
          ).status,
        ).toBe(
          "EXPIRED",
        );
      },
    );
  },
);

import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  Membership,
} from "./types";

import {
  changeMembershipRole,
  removeMembership,
} from "./invariants";

const ORG_A =
  "org-a" as Membership["org_id"];

const ORG_B =
  "org-b" as Membership["org_id"];

function membership(
  overrides: Partial<Membership> = {},
): Membership {
  return {
    id: "membership-1" as Membership["id"],
    org_id: ORG_A,
    user_id: "user-1" as Membership["user_id"],
    role: "MEMBER",
    created_at: "2026-01-01T00:00:00.000Z" as Membership["created_at"],
    ...overrides,
  };
}

describe(
  "changeMembershipRole",
  () => {
    it(
      "allows demoting an OWNER when another OWNER exists in the same org",
      () => {
        const owner1 =
          membership(
            {
              id: "m-1" as Membership["id"],
              role: "OWNER",
            },
          );

        const owner2 =
          membership(
            {
              id: "m-2" as Membership["id"],
              role: "OWNER",
            },
          );

        const result =
          changeMembershipRole(
            [owner1, owner2],
            owner1.id,
            "ADMIN",
          );

        expect(
          result.status,
        ).toBe(
          "OK",
        );

        if (result.status === "OK") {
          expect(
            result.memberships.find(
              (m) => m.id === owner1.id,
            )?.role,
          ).toBe(
            "ADMIN",
          );
        }
      },
    );

    it(
      "rejects demoting the last OWNER of an org",
      () => {
        const soleOwner =
          membership(
            {
              id: "m-1" as Membership["id"],
              role: "OWNER",
            },
          );

        const result =
          changeMembershipRole(
            [soleOwner],
            soleOwner.id,
            "ADMIN",
          );

        expect(
          result,
        ).toEqual(
          {
            status: "REJECTED",
            reason: "LAST_OWNER",
          },
        );
      },
    );

    it(
      "counts owners per-org, not globally",
      () => {
        // Sole OWNER of org A; a different org B also has exactly one
        // OWNER. Demoting org A's owner must still be rejected — org B's
        // owner does not count toward org A's minimum.
        const orgAOwner =
          membership(
            {
              id: "m-1" as Membership["id"],
              org_id: ORG_A,
              role: "OWNER",
            },
          );

        const orgBOwner =
          membership(
            {
              id: "m-2" as Membership["id"],
              org_id: ORG_B,
              role: "OWNER",
            },
          );

        const result =
          changeMembershipRole(
            [orgAOwner, orgBOwner],
            orgAOwner.id,
            "MEMBER",
          );

        expect(
          result,
        ).toEqual(
          {
            status: "REJECTED",
            reason: "LAST_OWNER",
          },
        );
      },
    );

    it(
      "allows promoting a MEMBER to ADMIN freely",
      () => {
        const owner =
          membership(
            {
              id: "m-1" as Membership["id"],
              role: "OWNER",
            },
          );

        const member =
          membership(
            {
              id: "m-2" as Membership["id"],
              role: "MEMBER",
            },
          );

        const result =
          changeMembershipRole(
            [owner, member],
            member.id,
            "ADMIN",
          );

        expect(
          result.status,
        ).toBe(
          "OK",
        );
      },
    );

    it(
      "rejects an unknown membership id",
      () => {
        const result =
          changeMembershipRole(
            [],
            "missing" as Membership["id"],
            "ADMIN",
          );

        expect(
          result,
        ).toEqual(
          {
            status: "REJECTED",
            reason: "MEMBERSHIP_NOT_FOUND",
          },
        );
      },
    );
  },
);

describe(
  "removeMembership",
  () => {
    it(
      "allows removing a non-OWNER",
      () => {
        const owner =
          membership(
            {
              id: "m-1" as Membership["id"],
              role: "OWNER",
            },
          );

        const member =
          membership(
            {
              id: "m-2" as Membership["id"],
              role: "MEMBER",
            },
          );

        const result =
          removeMembership(
            [owner, member],
            member.id,
          );

        expect(
          result.status,
        ).toBe(
          "OK",
        );

        if (result.status === "OK") {
          expect(
            result.memberships,
          ).toHaveLength(
            1,
          );
        }
      },
    );

    it(
      "rejects removing the last OWNER of an org",
      () => {
        const soleOwner =
          membership(
            {
              id: "m-1" as Membership["id"],
              role: "OWNER",
            },
          );

        const result =
          removeMembership(
            [soleOwner],
            soleOwner.id,
          );

        expect(
          result,
        ).toEqual(
          {
            status: "REJECTED",
            reason: "LAST_OWNER",
          },
        );
      },
    );

    it(
      "allows removing an OWNER when a co-OWNER remains",
      () => {
        const owner1 =
          membership(
            {
              id: "m-1" as Membership["id"],
              role: "OWNER",
            },
          );

        const owner2 =
          membership(
            {
              id: "m-2" as Membership["id"],
              role: "OWNER",
            },
          );

        const result =
          removeMembership(
            [owner1, owner2],
            owner1.id,
          );

        expect(
          result.status,
        ).toBe(
          "OK",
        );
      },
    );
  },
);

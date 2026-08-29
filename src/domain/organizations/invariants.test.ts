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
  deactivateMembership,
  reactivateMembership,
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
    deactivated_at: null,
    ...overrides,
  };
}

const DEACTIVATED_AT =
  "2026-06-01T12:00:00.000Z" as Membership["created_at"];

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
            "OWNER",
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
            "OWNER",
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
            "OWNER",
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
            "OWNER",
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
            "OWNER",
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

    // 2026-08-29 (P13 audit finding, live-reproduced against real
    // Postgres): an ADMIN could promote a confederate MEMBER to OWNER,
    // then demote the real OWNER (now legal, since a second OWNER
    // exists) -- permanently locking the founding OWNER out of
    // org-settings' danger zone. isLastActiveOwner alone never caught
    // this: it only blocks a change that would leave zero active
    // owners, never one that GRANTS ownership in the first place.

    it(
      "rejects an ADMIN granting OWNER to another member",
      () => {
        const admin =
          membership(
            {
              id: "m-1" as Membership["id"],
              role: "ADMIN",
            },
          );

        const confederate =
          membership(
            {
              id: "m-2" as Membership["id"],
              user_id: "user-2" as Membership["user_id"],
              role: "MEMBER",
            },
          );

        const result =
          changeMembershipRole(
            [admin, confederate],
            confederate.id,
            "OWNER",
            admin.role,
          );

        expect(
          result,
        ).toEqual(
          {
            status: "REJECTED",
            reason: "ONLY_OWNER_CAN_GRANT_OWNERSHIP",
          },
        );
      },
    );

    it(
      "rejects an ADMIN self-promoting to OWNER",
      () => {
        const admin =
          membership(
            {
              id: "m-1" as Membership["id"],
              role: "ADMIN",
            },
          );

        const result =
          changeMembershipRole(
            [admin],
            admin.id,
            "OWNER",
            admin.role,
          );

        expect(
          result,
        ).toEqual(
          {
            status: "REJECTED",
            reason: "ONLY_OWNER_CAN_GRANT_OWNERSHIP",
          },
        );
      },
    );

    it(
      "allows an OWNER to grant OWNER to another member",
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
              user_id: "user-2" as Membership["user_id"],
              role: "MEMBER",
            },
          );

        const result =
          changeMembershipRole(
            [owner, member],
            member.id,
            "OWNER",
            owner.role,
          );

        expect(
          result.status,
        ).toBe(
          "OK",
        );

        if (result.status === "OK") {
          expect(
            result.memberships.find(
              (m) => m.id === member.id,
            )?.role,
          ).toBe(
            "OWNER",
          );
        }
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

// The owner minimum counts ACTIVE owners. Before deactivation existed
// every OWNER row was by definition active, so the two suites above
// never had to distinguish — these do. A deactivated OWNER holds no
// authority anywhere (app.user_is_admin_or_owner_of() skips the row,
// 20260829360000), so an org whose only other OWNER is deactivated has
// exactly one real owner, and the pre-deactivation isLastOwner() —
// which counted OWNER rows regardless of state — would have let both
// of these strip it.
describe(
  "the owner minimum counts only ACTIVE owners",
  () => {
    const activeOwner =
      membership(
        {
          id: "m-1" as Membership["id"],
          role: "OWNER",
        },
      );

    const deactivatedOwner =
      membership(
        {
          id: "m-2" as Membership["id"],
          role: "OWNER",
          deactivated_at: DEACTIVATED_AT,
        },
      );

    it(
      "changeMembershipRole rejects demoting the last ACTIVE owner even though a deactivated OWNER row exists",
      () => {
        const result =
          changeMembershipRole(
            [activeOwner, deactivatedOwner],
            activeOwner.id,
            "ADMIN",
            "OWNER",
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
      "removeMembership rejects removing the last ACTIVE owner even though a deactivated OWNER row exists",
      () => {
        const result =
          removeMembership(
            [activeOwner, deactivatedOwner],
            activeOwner.id,
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
      "still allows demoting a DEACTIVATED sole OWNER -- it holds no ownership to lose",
      () => {
        // The org has no active owner either way, so refusing here
        // would only strand a row nobody can edit; LAST_OWNER is about
        // preserving an owner that actually exists.
        const result =
          changeMembershipRole(
            [deactivatedOwner],
            deactivatedOwner.id,
            "MEMBER",
            "OWNER",
          );

        expect(
          result.status,
        ).toBe(
          "OK",
        );
      },
    );

    it(
      "still allows removing a DEACTIVATED sole OWNER",
      () => {
        const result =
          removeMembership(
            [deactivatedOwner],
            deactivatedOwner.id,
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

describe(
  "deactivateMembership",
  () => {
    it(
      "sets deactivated_at on the target and leaves every other membership untouched",
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
          deactivateMembership(
            [owner, member],
            member.id,
            DEACTIVATED_AT,
          );

        expect(
          result.status,
        ).toBe(
          "OK",
        );

        if (result.status === "OK") {
          expect(
            result.memberships.find(
              (m) => m.id === member.id,
            )?.deactivated_at,
          ).toBe(
            DEACTIVATED_AT,
          );

          expect(
            result.memberships.find(
              (m) => m.id === owner.id,
            )?.deactivated_at,
          ).toBeNull();
        }
      },
    );

    it(
      "rejects deactivating the sole remaining active OWNER",
      () => {
        const soleOwner =
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
          deactivateMembership(
            [soleOwner, member],
            soleOwner.id,
            DEACTIVATED_AT,
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
      "allows deactivating an OWNER when another ACTIVE owner remains",
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
          deactivateMembership(
            [owner1, owner2],
            owner1.id,
            DEACTIVATED_AT,
          );

        expect(
          result.status,
        ).toBe(
          "OK",
        );
      },
    );

    it(
      "counts owners per-org, not globally",
      () => {
        // Same reasoning as changeMembershipRole's own per-org test:
        // org B's owner is no help to org A.
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
          deactivateMembership(
            [orgAOwner, orgBOwner],
            orgAOwner.id,
            DEACTIVATED_AT,
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
      "rejects deactivating an already-deactivated membership",
      () => {
        const alreadyGone =
          membership(
            {
              id: "m-1" as Membership["id"],
              deactivated_at: "2026-05-01T00:00:00.000Z" as Membership["created_at"],
            },
          );

        const result =
          deactivateMembership(
            [alreadyGone],
            alreadyGone.id,
            DEACTIVATED_AT,
          );

        // Not a silent no-op: re-deactivating would otherwise
        // overwrite the original offboarding timestamp with a later
        // one, quietly rewriting when this person actually lost access.
        expect(
          result,
        ).toEqual(
          {
            status: "REJECTED",
            reason: "ALREADY_DEACTIVATED",
          },
        );
      },
    );

    it(
      "rejects an unknown membership id",
      () => {
        const result =
          deactivateMembership(
            [],
            "missing" as Membership["id"],
            DEACTIVATED_AT,
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
  "reactivateMembership",
  () => {
    it(
      "clears deactivated_at on the target",
      () => {
        const deactivated =
          membership(
            {
              id: "m-1" as Membership["id"],
              deactivated_at: DEACTIVATED_AT,
            },
          );

        const result =
          reactivateMembership(
            [deactivated],
            deactivated.id,
          );

        expect(
          result.status,
        ).toBe(
          "OK",
        );

        if (result.status === "OK") {
          expect(
            result.memberships[0].deactivated_at,
          ).toBeNull();
        }
      },
    );

    it(
      "restores an OWNER without any owner-count objection",
      () => {
        // Reactivation only ever ADDS an active owner, so there is no
        // owner minimum for it to violate -- the one asymmetry with
        // deactivateMembership.
        const deactivatedOwner =
          membership(
            {
              id: "m-1" as Membership["id"],
              role: "OWNER",
              deactivated_at: DEACTIVATED_AT,
            },
          );

        const result =
          reactivateMembership(
            [deactivatedOwner],
            deactivatedOwner.id,
          );

        expect(
          result.status,
        ).toBe(
          "OK",
        );
      },
    );

    it(
      "rejects reactivating a membership that is already active",
      () => {
        const active =
          membership(
            {
              id: "m-1" as Membership["id"],
            },
          );

        const result =
          reactivateMembership(
            [active],
            active.id,
          );

        expect(
          result,
        ).toEqual(
          {
            status: "REJECTED",
            reason: "NOT_DEACTIVATED",
          },
        );
      },
    );

    it(
      "rejects an unknown membership id",
      () => {
        const result =
          reactivateMembership(
            [],
            "missing" as Membership["id"],
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

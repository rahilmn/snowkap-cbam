import {
  describe,
  expect,
  it,
} from "vitest";

import {
  describeInvitationState,
} from "./invitation-state";

const invitation =
  (expiresAt: string, status = "PENDING") =>
    (
      {
        status,
        expires_at: expiresAt,
      } as never
    );

describe(
  "describeInvitationState",
  () => {
    it(
      "calls a PENDING invitation awaiting acceptance while it is still in date",
      () => {
        expect(
          describeInvitationState(
            invitation("2026-09-09T00:00:00.000Z"),
            "2026-09-03T00:00:00.000Z" as never,
          ),
        ).toBe(
          "AWAITING_ACCEPTANCE",
        );
      },
    );

    it(
      "calls a lapsed PENDING invitation expired, because nothing in the database will",
      () => {
        // organization_invitations has no EXPIRED status: a row sits at
        // PENDING until an acceptance attempt flips it, and the admin's
        // own SELECT policy carries no expiry predicate, so without this
        // the Team screen shows a dead invitation as if it were live.
        expect(
          describeInvitationState(
            invitation("2026-09-02T00:00:00.000Z"),
            "2026-09-03T00:00:00.000Z" as never,
          ),
        ).toBe(
          "EXPIRED",
        );
      },
    );

    it(
      "treats the exact boundary as expired -- one tick stricter than the acceptance RPC, deliberately",
      () => {
        // The RPC uses expires_at < now(), so it still accepts at exact
        // equality. Erring toward "expired" costs a needless re-invite;
        // erring the other way costs a user clicking a dead link.
        expect(
          describeInvitationState(
            invitation("2026-09-03T00:00:00.000Z"),
            "2026-09-03T00:00:00.000Z" as never,
          ),
        ).toBe(
          "EXPIRED",
        );
      },
    );

    it(
      "never labels a non-PENDING invitation expired -- its own status already says what happened",
      () => {
        expect(
          describeInvitationState(
            invitation("2020-01-01T00:00:00.000Z", "ACCEPTED"),
            "2026-09-03T00:00:00.000Z" as never,
          ),
        ).toBe(
          "AWAITING_ACCEPTANCE",
        );

        expect(
          describeInvitationState(
            invitation("2020-01-01T00:00:00.000Z", "REVOKED"),
            "2026-09-03T00:00:00.000Z" as never,
          ),
        ).toBe(
          "AWAITING_ACCEPTANCE",
        );
      },
    );
  },
);

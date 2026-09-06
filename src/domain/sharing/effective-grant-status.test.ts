import {
  describe,
  expect,
  it,
} from "vitest";

import {
  effectiveSharingGrantStatus,
} from "./effective-grant-status";

const NOW =
  new Date(
    "2026-09-07T00:00:00.000Z",
  );

describe(
  "effectiveSharingGrantStatus",
  () => {
    it(
      "2026-09-07 (S5 review round 4, finding S5R4-VOCAB-1): reports EXPIRED for an ACTIVE grant whose expires_at has already passed",
      () => {
        expect(
          effectiveSharingGrantStatus(
            "ACTIVE",
            "2026-08-28T00:00:00.000Z",
            NOW,
          ),
        ).toBe(
          "EXPIRED",
        );
      },
    );

    it(
      "reports ACTIVE for an ACTIVE grant whose expires_at is still in the future",
      () => {
        expect(
          effectiveSharingGrantStatus(
            "ACTIVE",
            "2026-10-01T00:00:00.000Z",
            NOW,
          ),
        ).toBe(
          "ACTIVE",
        );
      },
    );

    it(
      "reports ACTIVE for an ACTIVE grant with no expiry at all",
      () => {
        expect(
          effectiveSharingGrantStatus(
            "ACTIVE",
            null,
            NOW,
          ),
        ).toBe(
          "ACTIVE",
        );
      },
    );

    it(
      "passes REVOKED through unchanged, expiry irrelevant",
      () => {
        expect(
          effectiveSharingGrantStatus(
            "REVOKED",
            "2026-01-01T00:00:00.000Z",
            NOW,
          ),
        ).toBe(
          "REVOKED",
        );
      },
    );

    it(
      "passes an already-EXPIRED status through unchanged",
      () => {
        expect(
          effectiveSharingGrantStatus(
            "EXPIRED",
            null,
            NOW,
          ),
        ).toBe(
          "EXPIRED",
        );
      },
    );

    it(
      "passes INVITED through unchanged even with a lapsed expires_at -- accept_sharing_grant_invitation() is the sanctioned place that transition happens, not this display helper",
      () => {
        expect(
          effectiveSharingGrantStatus(
            "INVITED",
            "2020-01-01T00:00:00.000Z",
            NOW,
          ),
        ).toBe(
          "INVITED",
        );
      },
    );

    it(
      "treats expires_at exactly equal to now as already lapsed (strict greater-than, matching every real access predicate's own >now() check)",
      () => {
        expect(
          effectiveSharingGrantStatus(
            "ACTIVE",
            NOW.toISOString(),
            NOW,
          ),
        ).toBe(
          "EXPIRED",
        );
      },
    );
  },
);

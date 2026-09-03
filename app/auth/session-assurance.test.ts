import {
  describe,
  expect,
  it,
} from "vitest";

import {
  sessionWasEstablishedByEmailLink,
} from "./session-assurance";

/**
 * The claim shapes below are the ones GoTrue v2.195.0 actually emits,
 * copied from a live probe against this project's local Auth rather
 * than invented -- see session-assurance.ts's doc comment for the
 * measurements.
 */
describe(
  "sessionWasEstablishedByEmailLink",
  () => {
    it(
      "accepts a recovery session -- the shape /reset-password exists for",
      () => {
        expect(
          sessionWasEstablishedByEmailLink(
            {
              amr: [
                {
                  method: "otp",
                  timestamp: 1788465889,
                },
              ],
            },
          ),
        ).toBe(true);
      },
    );

    it(
      "REFUSES a password sign-in session -- the shape a stolen cookie has",
      () => {
        expect(
          sessionWasEstablishedByEmailLink(
            {
              amr: [
                {
                  method: "password",
                  timestamp: 1788465889,
                },
              ],
            },
          ),
        ).toBe(false);
      },
    );

    it(
      "judges the LATEST authentication, not whether a link appears anywhere",
      () => {
        // A session that began with a recovery link and was later
        // re-driven by a password no longer proves mailbox control.
        expect(
          sessionWasEstablishedByEmailLink(
            {
              amr: [
                {
                  method: "otp",
                  timestamp: 1788465000,
                },
                {
                  method: "password",
                  timestamp: 1788465889,
                },
              ],
            },
          ),
        ).toBe(false);

        // ...and the same history in the other order is accepted.
        expect(
          sessionWasEstablishedByEmailLink(
            {
              amr: [
                {
                  method: "password",
                  timestamp: 1788465000,
                },
                {
                  method: "otp",
                  timestamp: 1788465889,
                },
              ],
            },
          ),
        ).toBe(true);
      },
    );

    it(
      "fails closed on a missing, empty, or unparseable amr",
      () => {
        for (
          const claims of [
            {},
            { amr: [] },
            { amr: null },
            { amr: "otp" },
            { amr: [{ timestamp: 1788465889 }] },
            { amr: [42] },
            null,
            undefined,
            "otp",
          ]
        ) {
          expect(
            sessionWasEstablishedByEmailLink(claims),
          ).toBe(false);
        }
      },
    );

    it(
      "fails closed on a method it does not recognise",
      () => {
        expect(
          sessionWasEstablishedByEmailLink(
            {
              amr: [
                {
                  method: "some_future_method",
                  timestamp: 1788465889,
                },
              ],
            },
          ),
        ).toBe(false);
      },
    );

    it(
      "requires EVERY method to be a link method when nothing is timestamped",
      () => {
        // The bare RFC-8176 string form carries no ordering, so the
        // strictest reading is the only safe one.
        expect(
          sessionWasEstablishedByEmailLink(
            { amr: ["otp"] },
          ),
        ).toBe(true);

        expect(
          sessionWasEstablishedByEmailLink(
            { amr: ["otp", "password"] },
          ),
        ).toBe(false);

        // Mixed timestamped/untimestamped is likewise unorderable.
        expect(
          sessionWasEstablishedByEmailLink(
            {
              amr: [
                "password",
                {
                  method: "otp",
                  timestamp: 1788465889,
                },
              ],
            },
          ),
        ).toBe(false);
      },
    );

    it(
      "accepts the other spellings GoTrue uses for link-derived sessions",
      () => {
        for (
          const method of [
            "otp",
            "email_otp",
            "emailotp",
            "magiclink",
            "recovery",
            "invite",
          ]
        ) {
          expect(
            sessionWasEstablishedByEmailLink(
              {
                amr: [
                  {
                    method,
                    timestamp: 1788465889,
                  },
                ],
              },
            ),
          ).toBe(true);
        }
      },
    );
  },
);

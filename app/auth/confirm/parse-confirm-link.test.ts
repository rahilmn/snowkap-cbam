import {
  describe,
  expect,
  it,
} from "vitest";

import {
  defaultNextFor,
  parseConfirmLink,
  resolveNextPath,
} from "./parse-confirm-link";

describe(
  "parseConfirmLink",
  () => {
    it(
      "accepts a well-formed invitation link and routes it to the set-password step",
      () => {
        expect(
          parseConfirmLink(
            { token_hash: "abc123", type: "invite" },
          ),
        ).toEqual(
          {
            status: "OK",
            tokenHash: "abc123",
            type: "invite",
            next: "/reset-password?next=/accept-invitation",
          },
        );
      },
    );

    it(
      "rejects a missing or blank token_hash without reaching Supabase",
      () => {
        expect(
          parseConfirmLink(
            { type: "invite" },
          ),
        ).toEqual(
          { status: "INVALID", reason: "MISSING_TOKEN_HASH" },
        );

        expect(
          parseConfirmLink(
            { token_hash: "   ", type: "invite" },
          ),
        ).toEqual(
          { status: "INVALID", reason: "MISSING_TOKEN_HASH" },
        );
      },
    );

    it(
      "rejects a type outside the allowlist",
      () => {
        // Load-bearing, not defensive: auth-js types EmailOtpType as
        // `... | (string & {})`, i.e. structurally just string, so
        // nothing else stops an arbitrary type reaching verifyOtp.
        expect(
          parseConfirmLink(
            { token_hash: "abc123", type: "phone_change" },
          ),
        ).toEqual(
          { status: "INVALID", reason: "INVALID_TYPE" },
        );

        expect(
          parseConfirmLink(
            { token_hash: "abc123" },
          ),
        ).toEqual(
          { status: "INVALID", reason: "INVALID_TYPE" },
        );
      },
    );

    it(
      "takes the first value when a parameter is repeated in the query string",
      () => {
        expect(
          parseConfirmLink(
            {
              token_hash: ["abc123", "def456"],
              type: ["recovery", "invite"],
            },
          ),
        ).toEqual(
          {
            status: "OK",
            tokenHash: "abc123",
            type: "recovery",
            next: "/reset-password",
          },
        );
      },
    );
  },
);

describe(
  "resolveNextPath",
  () => {
    it(
      "keeps a safe root-relative next for a recovery link",
      () => {
        expect(
          resolveNextPath(
            "recovery",
            "/shipments",
          ),
        ).toBe(
          "/shipments",
        );
      },
    );

    it.each(
      [
        "//evil.example",
        "https://evil.example",
        "/\\evil.example",
        String.fromCharCode(47, 9) + "//evil.example",
        String.fromCharCode(47, 10) + "//evil.example",
        String.fromCharCode(47, 13) + "/evil.example",
      ],
    )(
      "falls back to the type default rather than honouring the unsafe next %j",
      (unsafe) => {
        // Same payload family is-safe-redirect-path.test.ts pins. Falling
        // back rather than erroring is deliberate: the caller still gets
        // signed in, just not sent somewhere attacker-chosen.
        expect(
          resolveNextPath(
            "recovery",
            unsafe,
          ),
        ).toBe(
          "/reset-password",
        );
      },
    );

    it(
      "ignores any next on an invitation link, so the set-password step cannot be skipped by a query parameter",
      () => {
        // GoTrue's invite verification confirms the account without the
        // invitee ever choosing a password. Letting ?next= jump straight
        // to /accept-invitation would recreate the dead end the step
        // exists to close.
        expect(
          resolveNextPath(
            "invite",
            "/accept-invitation",
          ),
        ).toBe(
          "/reset-password?next=/accept-invitation",
        );

        expect(
          resolveNextPath(
            "invite",
            "/shipments",
          ),
        ).toBe(
          "/reset-password?next=/accept-invitation",
        );
      },
    );

    it(
      "defaults each link type to the screen that type is for",
      () => {
        expect(defaultNextFor("signup")).toBe("/onboarding");
        expect(defaultNextFor("recovery")).toBe("/reset-password");
        expect(defaultNextFor("magiclink")).toBe("/");
        expect(defaultNextFor("email")).toBe("/");
        expect(defaultNextFor("email_change")).toBe("/");
      },
    );
  },
);

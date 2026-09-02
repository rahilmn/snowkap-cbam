import {
  describe,
  expect,
  it,
} from "vitest";

import {
  parseAuthLinkError,
} from "./parse-auth-link-error";

describe(
  "parseAuthLinkError",
  () => {
    it(
      "reads the failure GoTrue puts in the hash fragment -- the shape a spent invitation link actually produces",
      () => {
        expect(
          parseAuthLinkError(
            "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&type=invite",
            "",
          ),
        ).toEqual(
          { code: "otp_expired", type: "invite" },
        );
      },
    );

    it(
      "reads the same failure from the query string, which PKCE-flow links also carry",
      () => {
        expect(
          parseAuthLinkError(
            "",
            "?error=access_denied&error_code=otp_expired&type=recovery",
          ),
        ).toEqual(
          { code: "otp_expired", type: "recovery" },
        );
      },
    );

    it(
      "prefers the hash over the query when both are present",
      () => {
        expect(
          parseAuthLinkError(
            "#error_code=otp_expired&type=invite",
            "?error_code=bad_code_verifier&type=recovery",
          ),
        ).toEqual(
          { code: "otp_expired", type: "invite" },
        );
      },
    );

    it(
      "prefers the machine-readable error_code over the coarse error bucket",
      () => {
        expect(
          parseAuthLinkError(
            "#error=access_denied&error_code=otp_expired",
            "",
          )?.code,
        ).toBe(
          "otp_expired",
        );
      },
    );

    it(
      "falls back to error when no error_code is supplied",
      () => {
        expect(
          parseAuthLinkError(
            "#error=access_denied",
            "",
          ),
        ).toEqual(
          { code: "access_denied", type: null },
        );
      },
    );

    it(
      "returns null for a successful callback, so the normal session flow is untouched",
      () => {
        expect(
          parseAuthLinkError(
            "#access_token=abc&refresh_token=def&type=invite",
            "",
          ),
        ).toBeNull();

        expect(
          parseAuthLinkError(
            "",
            "?code=abc123",
          ),
        ).toBeNull();

        expect(
          parseAuthLinkError(
            "",
            "",
          ),
        ).toBeNull();
      },
    );
  },
);

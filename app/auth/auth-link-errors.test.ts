import {
  describe,
  expect,
  it,
} from "vitest";

import {
  describeAuthLinkError,
  toAuthLinkKind,
} from "./auth-link-errors";

describe(
  "describeAuthLinkError",
  () => {
    it(
      "explains a spent invitation link in terms a real invitee can act on, and offers both recovery routes",
      () => {
        // The 2026-09-02 production case: the token was consumed 76
        // seconds after delivery by something other than the invitee's
        // own click, and the page said only "This link is invalid or has
        // expired." The invitation itself was still valid the whole time.
        const copy =
          describeAuthLinkError(
            { code: "otp_expired", kind: "invite" },
          );

        expect(copy.title).toBe(
          "This invitation link has already been used or has expired",
        );

        expect(copy.body).toContain(
          "Your invitation itself is still",
        );

        expect(
          copy.ctas.map((cta) => cta.href),
        ).toEqual(
          ["/sign-in", "/forgot-password"],
        );
      },
    );

    it(
      "leads with a fresh reset link for a spent recovery link, not with sign in",
      () => {
        const copy =
          describeAuthLinkError(
            { code: "otp_expired", kind: "recovery" },
          );

        expect(copy.ctas[0]?.href).toBe(
          "/forgot-password",
        );
      },
    );

    it(
      "adds the different-device explanation only for a PKCE-shaped link",
      () => {
        const pkce =
          describeAuthLinkError(
            { code: "otp_expired", kind: "recovery", pkceCodeShape: true },
          );

        const tokenHash =
          describeAuthLinkError(
            { code: "otp_expired", kind: "recovery" },
          );

        expect(pkce.body).toContain(
          "different device or browser",
        );

        expect(tokenHash.body).not.toContain(
          "different device or browser",
        );
      },
    );

    it(
      "does not call a rate limit an expired link -- that would send the user to burn another one",
      () => {
        const copy =
          describeAuthLinkError(
            { code: "over_request_rate_limit", kind: "invite" },
          );

        expect(copy.title).toBe(
          "Too many attempts right now",
        );

        expect(copy.body).toContain(
          "not a problem with your link",
        );
      },
    );

    it(
      "explains the browser binding for a PKCE verifier mismatch",
      () => {
        const copy =
          describeAuthLinkError(
            { code: "bad_code_verifier", kind: "recovery" },
          );

        expect(copy.title).toContain(
          "opened in the browser that requested it",
        );
      },
    );

    it(
      "falls back to generic copy for an unknown code, still offering a next step",
      () => {
        const copy =
          describeAuthLinkError(
            { code: "something_new", kind: "unknown" },
          );

        expect(copy.title).toBe(
          "This link is invalid or has expired",
        );

        expect(copy.ctas.length).toBeGreaterThan(
          0,
        );
      },
    );

    it(
      "never renders text supplied in the URL -- only codes are honoured",
      () => {
        // error_description is attacker-controllable and arrives on a
        // trusted, branded origin. Nothing in this module accepts it, so
        // there is no path by which crafted wording reaches a user.
        const copy =
          describeAuthLinkError(
            {
              code: "<script>alert(1)</script>",
              kind: "unknown",
            },
          );

        expect(copy.title).not.toContain(
          "script",
        );

        expect(copy.body).not.toContain(
          "script",
        );
      },
    );
  },
);

describe(
  "toAuthLinkKind",
  () => {
    it(
      "narrows the known email-link types and maps everything else to unknown",
      () => {
        expect(toAuthLinkKind("invite")).toBe("invite");
        expect(toAuthLinkKind("recovery")).toBe("recovery");
        expect(toAuthLinkKind("email_change")).toBe("email_change");
        expect(toAuthLinkKind("nonsense")).toBe("unknown");
        expect(toAuthLinkKind(null)).toBe("unknown");
        expect(toAuthLinkKind(undefined)).toBe("unknown");
      },
    );
  },
);

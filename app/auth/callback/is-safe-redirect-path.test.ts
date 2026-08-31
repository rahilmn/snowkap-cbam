import {
  describe,
  expect,
  it,
} from "vitest";

import {
  isSafeRedirectPath,
} from "./is-safe-redirect-path";

describe(
  "isSafeRedirectPath",
  () => {
    it(
      "accepts a plain same-origin relative path",
      () => {
        expect(
          isSafeRedirectPath(
            "/accept-invitation",
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "accepts a same-origin relative path with a query string",
      () => {
        expect(
          isSafeRedirectPath(
            "/shipments?tab=ready",
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "rejects an absolute http(s) URL",
      () => {
        expect(
          isSafeRedirectPath(
            "https://evil.example/verify",
          ),
        ).toBe(
          false,
        );
      },
    );

    // 2026-08-29 (P13 audit finding, live-reproduced): a protocol-relative
    // URL ("//host/path") is not caught by a bare `startsWith("/")` check
    // -- the browser resolves it against the current protocol, landing
    // on a different origin exactly like a full https:// URL would.
    it(
      "rejects a protocol-relative URL (//host/path)",
      () => {
        expect(
          isSafeRedirectPath(
            "//evil.example/verify",
          ),
        ).toBe(
          false,
        );
      },
    );

    it(
      "rejects a backslash-prefixed path some browsers normalize to protocol-relative",
      () => {
        expect(
          isSafeRedirectPath(
            "/\\evil.example",
          ),
        ).toBe(
          false,
        );
      },
    );

    it(
      "rejects a path with no leading slash",
      () => {
        expect(
          isSafeRedirectPath(
            "evil.example",
          ),
        ).toBe(
          false,
        );
      },
    );

    it(
      "rejects an empty string",
      () => {
        expect(
          isSafeRedirectPath(
            "",
          ),
        ).toBe(
          false,
        );
      },
    );

    it(
      "rejects a javascript: URL",
      () => {
        expect(
          isSafeRedirectPath(
            "javascript:alert(1)",
          ),
        ).toBe(
          false,
        );
      },
    );
    // 2026-08-31 (P13 final adversarial review). These are the exact
    // payloads that DEFEATED the original allowlist, reproduced in a real
    // browser engine before the fix. The WHATWG URL parser strips ASCII
    // tab/LF/CR from a URL BEFORE parsing, so a tab in the second
    // position -- which the old pattern accepted, a tab being neither "/"
    // nor a backslash -- turned "/<TAB>//evil.example" into
    // "//evil.example": protocol-relative and off-origin.
    //
    // Built with String.fromCharCode rather than backslash escapes so the
    // control character under test is unambiguous in the source and
    // cannot be silently mangled by tooling.
    const CONTROL_PAYLOADS: [string, string][] = [
      ["tab", `/${String.fromCharCode(9)}//evil.example`],
      ["line feed", `/${String.fromCharCode(10)}//evil.example`],
      ["carriage return", `/${String.fromCharCode(13)}/evil.example`],
      ["tab then backslash", `/${String.fromCharCode(9)}${String.fromCharCode(92)}evil.example`],
      ["form feed", `/${String.fromCharCode(12)}//evil.example`],
      ["vertical tab", `/${String.fromCharCode(11)}//evil.example`],
      ["NUL", `/${String.fromCharCode(0)}//evil.example`],
      ["space", `/ //evil.example`],
    ];

    it.each(CONTROL_PAYLOADS)(
      "rejects a %s used to smuggle a protocol-relative URL past the allowlist",
      (_label, payload) => {
        expect(
          isSafeRedirectPath(
            payload,
          ),
        ).toBe(
          false,
        );
      },
    );

    it.each([
      "/accept-invitation",
      "/shipments",
      "/shipments/abc-123?tab=lines#why-this-number",
      "/reset-password",
      "/declarations/040e02af-608c-438b-8322-04fcad6626f6",
    ])(
      "still accepts the legitimate root-relative path %s",
      (path) => {
        expect(
          isSafeRedirectPath(
            path,
          ),
        ).toBe(
          true,
        );
      },
    );
  },
);

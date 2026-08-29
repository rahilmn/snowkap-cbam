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
  },
);

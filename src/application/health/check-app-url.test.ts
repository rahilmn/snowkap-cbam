import {
  describe,
  expect,
  it,
} from "vitest";

import {
  checkAppUrl,
} from "./check-app-url";

describe(
  "checkAppUrl",
  () => {
    it(
      "reports missing when APP_URL is unset in production -- the case that silently emails localhost links to real users",
      () => {
        expect(
          checkAppUrl(
            { NODE_ENV: "production" },
          ),
        ).toEqual(
          { status: "missing" },
        );
      },
    );

    it(
      "treats a set-but-EMPTY APP_URL as unset",
      () => {
        // Same failure mode resolve-git-sha.ts already had to fix: a
        // Railway variable that exists but is blank. `??` would call
        // this configured; it is not.
        expect(
          checkAppUrl(
            { NODE_ENV: "production", APP_URL: "" },
          ),
        ).toEqual(
          { status: "missing" },
        );

        expect(
          checkAppUrl(
            { NODE_ENV: "production", APP_URL: "   " },
          ),
        ).toEqual(
          { status: "missing" },
        );
      },
    );

    it(
      "reports ok once APP_URL is configured in production",
      () => {
        expect(
          checkAppUrl(
            {
              NODE_ENV: "production",
              APP_URL: "https://snowkap-cbam-production.up.railway.app",
            },
          ),
        ).toEqual(
          { status: "ok" },
        );
      },
    );

    it(
      "reports not_required outside production, where the localhost fallback IS the right origin",
      () => {
        expect(
          checkAppUrl(
            { NODE_ENV: "development" },
          ),
        ).toEqual(
          { status: "not_required" },
        );

        expect(
          checkAppUrl(
            {},
          ),
        ).toEqual(
          { status: "not_required" },
        );
      },
    );

    it(
      "still reports ok in development when APP_URL is explicitly set",
      () => {
        expect(
          checkAppUrl(
            { NODE_ENV: "development", APP_URL: "http://127.0.0.1:3000" },
          ),
        ).toEqual(
          { status: "ok" },
        );
      },
    );

    it(
      "reports malformed when APP_URL has no scheme -- the real production failure",
      () => {
        // Found 2026-09-02 in the project's own API log: APP_URL was set
        // to the bare host, so every auth email link was built as
        // "snowkap-cbam-production.up.railway.app/auth/callback?..." --
        // not a usable URL. This check previously reported "ok" for it.
        expect(
          checkAppUrl(
            {
              NODE_ENV: "production",
              APP_URL: "snowkap-cbam-production.up.railway.app",
            },
          ),
        ).toEqual(
          { status: "malformed" },
        );
      },
    );

    it(
      "reports malformed for other unusable shapes",
      () => {
        for (const value of ["//host/path", "ftp://host", "not a url", "/relative"]) {
          expect(
            checkAppUrl(
              { NODE_ENV: "production", APP_URL: value },
            ),
          ).toEqual(
            { status: "malformed" },
          );
        }
      },
    );

    it(
      "still reports ok for a well-formed absolute URL",
      () => {
        expect(
          checkAppUrl(
            {
              NODE_ENV: "production",
              APP_URL: "https://snowkap-cbam-production.up.railway.app",
            },
          ),
        ).toEqual(
          { status: "ok" },
        );
      },
    );
  },
);

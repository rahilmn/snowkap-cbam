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
  },
);

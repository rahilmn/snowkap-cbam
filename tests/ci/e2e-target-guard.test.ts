/**
 * Regression suite for the E2E target guard (P14, H3).
 *
 * The hazard it closes is silent by construction: a developer without
 * `.env.local` ran the mutating Playwright suite against the HOSTED
 * project, with the production service-role key and the rate limiters
 * disabled, and nothing in the run said so. Every case below is written
 * as "this configuration must be REFUSED", because a guard that has
 * only ever been seen to allow is not a guard.
 */

import { describe, expect, it } from "vitest";

import {
  assertE2ETargetIsLocal,
  E2E_BACKEND_KEYS,
  isLoopbackUrl,
} from "../support/e2e-target-guard";

const LOCAL_URL = "http://127.0.0.1:54321";
const HOSTED_URL = "https://tjwzlbujbsnoacbhzmax.supabase.co";

/**
 * The key NAMES come from the guard's own exported list rather than
 * being written out here, and the fixtures below use computed keys.
 *
 * Partly that removes duplication -- a key added to E2E_BACKEND_KEYS is
 * automatically covered. Mostly it is so this file contains no
 * service-role key name followed by a quoted value, which is a real
 * credential shape: the committed-secret scan flagged the first version
 * of this suite for exactly that, and then flagged the comment written
 * to explain it, which is the scanner working correctly twice. Same
 * discipline as tests/ci/scan-for-committed-secrets.test.ts -- a test
 * about credentials should not contain something shaped like one.
 */
const [URL_KEY, PUBLIC_URL_KEY, SERVICE_ROLE_KEY, PUBLIC_ANON_KEY] =
  E2E_BACKEND_KEYS;

/** A full, correct local `.env.local`, as CI writes it. */
function localEnvLocal(
  overrides: Record<string, string | undefined> = {},
): Record<string, string> {
  const base: Record<string, string> = {
    [URL_KEY]: LOCAL_URL,
    [PUBLIC_URL_KEY]: LOCAL_URL,
    [SERVICE_ROLE_KEY]: "local-service-role",
    [PUBLIC_ANON_KEY]: "local-anon",
    APP_URL: "http://localhost:3000",
  };

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete base[key];
    } else {
      base[key] = value;
    }
  }

  return base;
}

/** What this project's `.env` actually holds: the hosted project. */
const HOSTED_ENV: Record<string, string> = {
  [URL_KEY]: HOSTED_URL,
  [PUBLIC_URL_KEY]: HOSTED_URL,
  [SERVICE_ROLE_KEY]: "the-real-production-service-role-key",
  [PUBLIC_ANON_KEY]: "the-real-production-anon-key",
};

describe("E2E target guard", () => {
  it("1. allows a fully local .env.local -- the configuration CI writes", () => {
    expect(assertE2ETargetIsLocal(localEnvLocal(), HOSTED_ENV)).toEqual({
      status: "OK",
    });
  });

  it("2. refuses a hosted SUPABASE_URL", () => {
    const verdict = assertE2ETargetIsLocal(
      localEnvLocal({ [URL_KEY]: HOSTED_URL }),
      HOSTED_ENV,
    );

    expect(verdict.status).toBe("REFUSED");
    expect(verdict).toMatchObject({ reason: "NON_LOCAL_BACKEND_URL" });
  });

  it(
    "3. refuses a missing .env.local -- the exact configuration that ran the " +
      "mutating suite against production",
    () => {
      const verdict = assertE2ETargetIsLocal(null, HOSTED_ENV);

      expect(verdict.status).toBe("REFUSED");
      expect(verdict).toMatchObject({ reason: "MISSING_ENV_LOCAL" });
      // The message has to say what would have happened, or the next
      // person hits it and adds an override.
      expect(
        verdict.status === "REFUSED" ? verdict.message : "",
      ).toContain("HOSTED");
    },
  );

  it("4. refuses mixed local and hosted URLs", () => {
    const verdict = assertE2ETargetIsLocal(
      localEnvLocal({ [PUBLIC_URL_KEY]: HOSTED_URL }),
      HOSTED_ENV,
    );

    expect(verdict.status).toBe("REFUSED");
    expect(verdict).toMatchObject({ reason: "NON_LOCAL_BACKEND_URL" });
  });

  it(
    "5. refuses a production service-role key inherited from .env, even when " +
      "both URLs are local -- the keys resolve independently",
    () => {
      const verdict = assertE2ETargetIsLocal(
        localEnvLocal({ [SERVICE_ROLE_KEY]: undefined }),
        HOSTED_ENV,
      );

      expect(verdict.status).toBe("REFUSED");
      expect(verdict).toMatchObject({ reason: "BACKEND_KEY_NOT_IN_ENV_LOCAL" });
      expect(
        verdict.status === "REFUSED" ? verdict.message : "",
      ).toContain(SERVICE_ROLE_KEY);
    },
  );

  it("refuses when any single backend key is inherited rather than declared", () => {
    for (const key of E2E_BACKEND_KEYS) {
      const verdict = assertE2ETargetIsLocal(
        localEnvLocal({ [key]: undefined }),
        HOSTED_ENV,
      );

      expect(
        verdict.status,
        `${key} inherited from .env must be refused`,
      ).toBe("REFUSED");
    }
  });

  it("refuses an empty backend URL rather than treating it as absent", () => {
    const verdict = assertE2ETargetIsLocal(
      localEnvLocal({ [URL_KEY]: "" }),
      HOSTED_ENV,
    );

    expect(verdict.status).toBe("REFUSED");
  });

  it("has no environment-variable escape hatch", () => {
    // Asserted as source, because the whole point is that no future
    // reader can quietly add one and still see this suite pass.
    const source = assertE2ETargetIsLocal.toString();

    expect(source).not.toContain("process.env");
  });
});

describe("loopback detection", () => {
  it.each([
    "http://127.0.0.1:54321",
    "http://localhost:3000",
    "http://[::1]:54321",
  ])("accepts %s", (url) => {
    expect(isLoopbackUrl(url)).toBe(true);
  });

  it.each([
    HOSTED_URL,
    // The classic bypass shapes: a hostname that merely CONTAINS a
    // loopback name, and a userinfo section that puts one before the @.
    "https://localhost.evil.example",
    "https://127.0.0.1.evil.example",
    "https://user:pass@evil.example/127.0.0.1",
    "not a url",
    "",
  ])("rejects %s", (url) => {
    expect(isLoopbackUrl(url)).toBe(false);
  });
});

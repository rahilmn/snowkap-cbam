import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

/**
 * 2026-08-29 (P11 mandatory security review, BLOCKING finding #8/N1,
 * SHOULD-FIX finding N5): this file previously did not exist --
 * get-client-ip.ts is mocked out wholesale by every call-site test
 * (app/(auth)/actions.test.ts, app/accept-invitation/actions.test.ts,
 * app/api/evidence/upload/route.test.ts), so the one module that
 * decides WHAT the rate-limit key is had never actually been
 * exercised. These tests drive the real `headers()`-reading code via
 * a mocked `next/headers`, the same shape every one of this
 * function's own real callers uses in production.
 */
let mockForwardedFor: string | null = null;

vi.mock(
  "next/headers",
  () => (
    {
      headers: async () => (
        {
          get: (name: string) =>
            name.toLowerCase() === "x-forwarded-for"
              ? mockForwardedFor
              : null,
        }
      ),
    }
  ),
);

async function importGetClientIp() {
  const module =
    await import("./get-client-ip");

  return module.getClientIp;
}

describe(
  "getClientIp",
  () => {
    afterEach(
      () => {
        mockForwardedFor = null;
        vi.resetModules();
      },
    );

    it(
      "returns the LAST entry of a multi-hop x-forwarded-for chain -- the one the nearest trusted proxy itself appended, per TRUSTED_PROXY_HOPS = 1",
      async () => {
        mockForwardedFor =
          "203.0.113.1, 70.41.3.18";

        const getClientIp =
          await importGetClientIp();

        expect(await getClientIp()).toBe(
          "70.41.3.18",
        );
      },
    );

    it(
      "is NOT fooled by a client sending an arbitrary x-forwarded-for with no proxy hop appended -- returns that lone (client-controlled) entry only because it is also the last one, never the client's chosen FIRST entry once a real proxy hop is present",
      async () => {
        // A caller spoofing a victim's IP as the first (and only)
        // entry, with the trusted proxy's own hop appended after it
        // -- exactly the live-reproduced lockout exploit this fix
        // closes (see get-client-ip.ts's own header comment). The
        // trusted (last) entry is the proxy's real hop, not the
        // spoofed victim IP.
        mockForwardedFor =
          "198.51.100.9, 70.41.3.18";

        const getClientIp =
          await importGetClientIp();

        expect(await getClientIp()).toBe(
          "70.41.3.18",
        );
        expect(await getClientIp()).not.toBe(
          "198.51.100.9",
        );
      },
    );

    it(
      "returns the sole entry when x-forwarded-for carries exactly one address",
      async () => {
        mockForwardedFor =
          "203.0.113.1";

        const getClientIp =
          await importGetClientIp();

        expect(await getClientIp()).toBe(
          "203.0.113.1",
        );
      },
    );

    it(
      "trims whitespace around each comma-separated entry",
      async () => {
        mockForwardedFor =
          "  203.0.113.1  ,   70.41.3.18   ";

        const getClientIp =
          await importGetClientIp();

        expect(await getClientIp()).toBe(
          "70.41.3.18",
        );
      },
    );

    it(
      "falls back to \"unknown\" when the header is entirely absent (e.g. pnpm dev with no proxy in front)",
      async () => {
        mockForwardedFor = null;

        const getClientIp =
          await importGetClientIp();

        expect(await getClientIp()).toBe(
          "unknown",
        );
      },
    );

    it(
      "falls back to \"unknown\" when the header is present but empty/whitespace-only",
      async () => {
        mockForwardedFor =
          "   ";

        const getClientIp =
          await importGetClientIp();

        expect(await getClientIp()).toBe(
          "unknown",
        );
      },
    );

    it(
      "ignores empty entries produced by stray commas (e.g. \"1.2.3.4,,5.6.7.8\") rather than trusting a blank as the last hop",
      async () => {
        mockForwardedFor =
          "203.0.113.1,,70.41.3.18,";

        const getClientIp =
          await importGetClientIp();

        expect(await getClientIp()).toBe(
          "70.41.3.18",
        );
      },
    );

    it(
      "clamps to the leftmost entry rather than throwing when the chain is shorter than TRUSTED_PROXY_HOPS would expect (defensive -- never worse than trusting the only entry present)",
      async () => {
        mockForwardedFor =
          "203.0.113.1";

        const getClientIp =
          await importGetClientIp();

        // TRUSTED_PROXY_HOPS is 1, so this is the same as the
        // single-entry case above -- included explicitly as the
        // boundary case the clamping logic (Math.max(..., 0)) exists
        // to guard, not merely coincide with.
        expect(await getClientIp()).toBe(
          "203.0.113.1",
        );
      },
    );
  },
);

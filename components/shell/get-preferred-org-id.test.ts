import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

/**
 * Same next/headers-mocking shape as get-client-ip.test.ts (the sibling
 * file in this directory) -- a fake cookie jar exposing only the
 * `get()` method this function actually calls, driven through the real
 * getPreferredOrgId() rather than mocked out wholesale.
 */
let mockCookieValue: string | undefined;

vi.mock(
  "next/headers",
  () => (
    {
      cookies: async () => (
        {
          get: (name: string) =>
            name === "snowkap-active-org" && mockCookieValue !== undefined
              ? { value: mockCookieValue }
              : undefined,
        }
      ),
    }
  ),
);

async function importGetPreferredOrgId() {
  const module =
    await import("./get-preferred-org-id");

  return module.getPreferredOrgId;
}

describe(
  "getPreferredOrgId",
  () => {
    afterEach(
      () => {
        mockCookieValue = undefined;
        vi.resetModules();
      },
    );

    it(
      "returns the cookie's value when the active-org cookie is present",
      async () => {
        mockCookieValue = "org-123";

        const getPreferredOrgId =
          await importGetPreferredOrgId();

        expect(await getPreferredOrgId()).toBe(
          "org-123",
        );
      },
    );

    it(
      "returns undefined when the active-org cookie is absent",
      async () => {
        mockCookieValue = undefined;

        const getPreferredOrgId =
          await importGetPreferredOrgId();

        expect(await getPreferredOrgId()).toBeUndefined();
      },
    );
  },
);

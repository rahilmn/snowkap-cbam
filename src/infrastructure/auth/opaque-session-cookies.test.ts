import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

const persistAppSessionMock =
  vi.fn(
    async (..._args: unknown[]) => "fresh-token",
  );

const revokeAppSessionMock =
  vi.fn(
    async (..._args: unknown[]) => undefined,
  );

vi.mock(
  "./app-session-store",
  () => (
    {
      persistAppSession: (...args: unknown[]) =>
        persistAppSessionMock(...args),
      revokeAppSession: (...args: unknown[]) =>
        revokeAppSessionMock(...args),
    }
  ),
);

const {
  createOpaqueSessionCookieAdapter,
  providerStorageKey,
  APP_SESSION_COOKIE,
} =
  await import(
    "./opaque-session-cookies"
  );

// Derived the same way the module itself derives it, rather than
// hardcoded -- NEXT_PUBLIC_SUPABASE_URL is not set in this unit-test
// environment, so the real value differs from what a live deployment
// would use.
const STORAGE_KEY =
  providerStorageKey();

function makeBridge(
  initial: { name: string; value: string }[] = [],
) {
  const cookies =
    [...initial];

  const setCalls: { name: string; value: string; options: Record<string, unknown> }[] =
    [];

  return {
    getAll: () => [...cookies],
    set: (
      name: string,
      value: string,
      options: Record<string, unknown>,
    ) => {
      setCalls.push(
        { name, value, options },
      );
    },
    setCalls,
  };
}

describe(
  "createOpaqueSessionCookieAdapter's setAll",
  () => {
    it(
      "2026-09-07 (S5 review round 11, finding S5R11-SF-B1, live-reproduced): does NOT throw when revokeAppSession hits a genuine database error -- it must never throw at all, since @supabase/ssr invokes it from inside GoTrueClient's own uncatchable onAuthStateChange plumbing, and an uncaught throw here previously crashed proxy.ts's middleware (no try/catch around supabase.auth.getUser()) for the request",
      async () => {
        const bridge =
          makeBridge(
            [
              { name: APP_SESSION_COOKIE, value: "existing-opaque-token" },
            ],
          );

        const adapter =
          createOpaqueSessionCookieAdapter(
            bridge,
          );

        revokeAppSessionMock.mockImplementationOnce(
          async () => {
            throw new Error(
              "app session: could not revoke the session (57014).",
            );
          },
        );

        // A blank provider cookie is how @supabase/ssr expresses a
        // sign-out -- the exact shape that reaches revokeAppSession.
        await expect(
          adapter.setAll(
            [
              { name: STORAGE_KEY, value: "", options: {} },
            ],
          ),
        ).resolves.toBeUndefined();

        expect(revokeAppSessionMock).toHaveBeenCalledWith(
          "existing-opaque-token",
        );

        // Degrades by still clearing the browser's opaque cookie
        // (best effort), rather than leaving the request in an
        // inconsistent state.
        const clearCall =
          bridge.setCalls.find(
            (call) => call.name === APP_SESSION_COOKIE,
          );

        expect(clearCall?.value).toBe(
          "",
        );

        expect(clearCall?.options.maxAge).toBe(
          0,
        );
      },
    );

    it(
      "2026-09-07 (S5 review round 11, finding S5R11-SF-B1, live-reproduced): does NOT throw when persistAppSession hits a genuine database error -- leaves the existing cookie untouched for this request rather than crashing the caller",
      async () => {
        const bridge =
          makeBridge(
            [
              { name: APP_SESSION_COOKIE, value: "existing-opaque-token" },
            ],
          );

        const adapter =
          createOpaqueSessionCookieAdapter(
            bridge,
          );

        persistAppSessionMock.mockImplementationOnce(
          async () => {
            throw new Error(
              "app session: could not store the session (57014).",
            );
          },
        );

        await expect(
          adapter.setAll(
            [
              { name: STORAGE_KEY, value: "a-real-provider-session-value", options: {} },
            ],
          ),
        ).resolves.toBeUndefined();

        expect(persistAppSessionMock).toHaveBeenCalled();

        // No new opaque cookie was ever set -- the failed refresh is
        // silently skipped for this one request, not propagated as an
        // uncaught exception.
        const appSessionCalls =
          bridge.setCalls.filter(
            (call) => call.name === APP_SESSION_COOKIE,
          );

        expect(appSessionCalls).toEqual(
          [],
        );
      },
    );

    it(
      "still sets the fresh cookie on the ordinary success path (no regression from the new try/catch)",
      async () => {
        const bridge =
          makeBridge(
            [
              { name: APP_SESSION_COOKIE, value: "old-token" },
            ],
          );

        const adapter =
          createOpaqueSessionCookieAdapter(
            bridge,
          );

        persistAppSessionMock.mockResolvedValueOnce(
          "brand-new-token",
        );

        await adapter.setAll(
          [
            { name: STORAGE_KEY, value: "a-real-provider-session-value", options: {} },
          ],
        );

        const appSessionCall =
          bridge.setCalls.find(
            (call) => call.name === APP_SESSION_COOKIE,
          );

        expect(appSessionCall?.value).toBe(
          "brand-new-token",
        );
      },
    );
  },
);

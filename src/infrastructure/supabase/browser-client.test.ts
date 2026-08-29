import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// 2026-08-29 (P11 mandatory security review, finding #14): this file
// previously did not exist. vi.resetModules() before each test is
// required here (unlike server-client.test.ts) because this module
// memoizes `cachedClient` at module scope -- without it, the second
// test's call would return the FIRST test's already-cached client
// rather than exercising createBrowserClient again.
const createBrowserClientMock =
  vi.fn(
    (
      _url: string,
      _anonKey: string,
      _options: unknown,
    ) => ({}),
  );

vi.mock(
  "@supabase/ssr",
  () => (
    {
      createBrowserClient:
        (
          url: string,
          anonKey: string,
          options: unknown,
        ) => createBrowserClientMock(url, anonKey, options),
    }
  ),
);

const ORIGINAL_ENV =
  { ...process.env };

beforeEach(() => {
  vi.resetModules();

  process.env.NEXT_PUBLIC_SUPABASE_URL =
    "http://127.0.0.1:54321";

  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
    "test-anon-key";
});

afterEach(() => {
  vi.clearAllMocks();

  process.env =
    { ...ORIGINAL_ENV };
});

describe(
  "getBrowserSupabaseClient",
  () => {
    it(
      // 2026-08-29 (P11 finding #14, live-reproduced): previously no
      // cookieOptions were passed at all, so @supabase/ssr's own
      // default (no `secure`) applied.
      "passes cookieOptions.secure = true in production",
      async () => {
        const previousNodeEnv =
          process.env.NODE_ENV;

        // @ts-expect-error -- NODE_ENV is genuinely writable at
        // runtime; restored in the finally block below.
        process.env.NODE_ENV =
          "production";

        try {
          const { getBrowserSupabaseClient } =
            await import("./browser-client");

          getBrowserSupabaseClient();

          const [, , options] =
            createBrowserClientMock.mock.calls[0] as [
              string,
              string,
              { cookieOptions?: { secure?: boolean } },
            ];

          expect(options.cookieOptions?.secure).toBe(true);
        } finally {
          // @ts-expect-error -- see the write above.
          process.env.NODE_ENV =
            previousNodeEnv;
        }
      },
    );

    it(
      "passes cookieOptions.secure = false outside production",
      async () => {
        const previousNodeEnv =
          process.env.NODE_ENV;

        // @ts-expect-error -- see the matching production test above.
        process.env.NODE_ENV =
          "development";

        try {
          const { getBrowserSupabaseClient } =
            await import("./browser-client");

          getBrowserSupabaseClient();

          const [, , options] =
            createBrowserClientMock.mock.calls[0] as [
              string,
              string,
              { cookieOptions?: { secure?: boolean } },
            ];

          expect(options.cookieOptions?.secure).toBe(false);
        } finally {
          // @ts-expect-error -- see the write above.
          process.env.NODE_ENV =
            previousNodeEnv;
        }
      },
    );

    it(
      "memoizes the client across calls (still, unchanged by this fix)",
      async () => {
        const { getBrowserSupabaseClient } =
          await import("./browser-client");

        const first =
          getBrowserSupabaseClient();

        const second =
          getBrowserSupabaseClient();

        expect(first).toBe(second);
        expect(createBrowserClientMock).toHaveBeenCalledTimes(1);
      },
    );

    it(
      "throws when required env vars are missing",
      async () => {
        delete process.env.NEXT_PUBLIC_SUPABASE_URL;

        const { getBrowserSupabaseClient } =
          await import("./browser-client");

        expect(
          () => getBrowserSupabaseClient(),
        ).toThrow();
      },
    );
  },
);

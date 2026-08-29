import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// 2026-08-29 (P11 mandatory security review, finding #14): this file
// previously did not exist. Mocked at the @supabase/ssr and
// next/headers boundaries, the same shape proxy.test.ts already uses
// for the sibling middleware client -- a unit test of this module's
// own cookieOptions wiring, not an integration test of @supabase/ssr
// itself.
const createServerClientMock =
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
      createServerClient:
        (
          url: string,
          anonKey: string,
          options: unknown,
        ) => createServerClientMock(url, anonKey, options),
    }
  ),
);

vi.mock(
  "next/headers",
  () => (
    {
      cookies: async () => (
        {
          getAll: () => [],
          set: () => undefined,
        }
      ),
    }
  ),
);

const { getServerSupabaseClient } =
  await import(
    "./server-client"
  );

const ORIGINAL_ENV =
  { ...process.env };

beforeEach(() => {
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
  "getServerSupabaseClient",
  () => {
    it(
      // 2026-08-29 (P11 finding #14, live-reproduced): previously no
      // cookieOptions were passed at all, so @supabase/ssr's own
      // default (no `secure`) applied -- session cookies were
      // eligible to be sent on a plaintext http:// request.
      "passes cookieOptions.secure = true in production",
      async () => {
        const previousNodeEnv =
          process.env.NODE_ENV;

        // @ts-expect-error -- NODE_ENV is genuinely writable at
        // runtime; restored in the finally block below.
        process.env.NODE_ENV =
          "production";

        try {
          await getServerSupabaseClient();

          const [, , options] =
            createServerClientMock.mock.calls[0] as [
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
      "passes cookieOptions.secure = false outside production, so local http:// dev keeps working",
      async () => {
        const previousNodeEnv =
          process.env.NODE_ENV;

        // @ts-expect-error -- see the matching production test above.
        process.env.NODE_ENV =
          "development";

        try {
          await getServerSupabaseClient();

          const [, , options] =
            createServerClientMock.mock.calls[0] as [
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
      "throws when required env vars are missing",
      async () => {
        delete process.env.NEXT_PUBLIC_SUPABASE_URL;

        await expect(
          getServerSupabaseClient(),
        ).rejects.toThrow();
      },
    );

    it(
      // 2026-08-29 (P13 adversarial security audit, finding #2,
      // confirmed live): this module's cookieOptions previously left
      // `httpOnly` at @supabase/ssr's own default of `false`, so the
      // session's access + refresh tokens were readable via
      // `document.cookie` by any script on the origin -- one XSS or one
      // compromised front-end dependency could exfiltrate a full
      // session. Unlike `secure` above, this is NOT NODE_ENV-gated:
      // this client reads/writes cookies via next/headers' cookie
      // store (mocked above), never `document.cookie`, so httpOnly is
      // safe in every environment.
      "passes cookieOptions.httpOnly = true regardless of environment",
      async () => {
        await getServerSupabaseClient();

        const [, , options] =
          createServerClientMock.mock.calls[0] as [
            string,
            string,
            { cookieOptions?: { httpOnly?: boolean } },
          ];

        expect(options.cookieOptions?.httpOnly).toBe(true);
      },
    );
  },
);

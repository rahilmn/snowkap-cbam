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

// 2026-08-30 (audit follow-up): the getAll/set members below are
// vi.fn() spies -- not inline arrows -- so tests can both control
// their return value/throw behavior and assert on how the module
// under test calls them. Declared before vi.mock() and referenced by
// closure inside its factory, the same "let ... ; vi.mock(() => ...
// references it)" shape app/team/actions.test.ts already uses for its
// next/headers mock.
const cookieStoreGetAllMock =
  vi.fn(
    () => [] as { name: string; value: string }[],
  );

const cookieStoreSetMock =
  vi.fn(
    () => undefined as void,
  );

vi.mock(
  "next/headers",
  () => (
    {
      cookies: async () => (
        {
          getAll: cookieStoreGetAllMock,
          set: cookieStoreSetMock,
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

    // 2026-08-30 (audit follow-up): the tests above only ever inspect
    // the captured `options` object -- none of them actually call
    // options.cookies.getAll()/setAll(), so the adapter functions
    // themselves (and the try/catch inside setAll, which this file's
    // own doc comment specifically calls out) had zero coverage. These
    // three pull the real `cookies` adapter off the captured options
    // and invoke it directly against the cookieStoreGetAllMock /
    // cookieStoreSetMock spies above.
    type CapturedCookiesAdapter = {
      getAll: () => { name: string; value: string }[];
      setAll: (
        cookiesToSet: {
          name: string;
          value: string;
          options?: Record<string, unknown>;
        }[],
      ) => void;
    };

    async function capturedCookiesAdapter() {
      await getServerSupabaseClient();

      const [, , options] =
        createServerClientMock.mock.calls[0] as [
          string,
          string,
          { cookies: CapturedCookiesAdapter },
        ];

      return options.cookies;
    }

    it(
      "options.cookies.getAll() forwards to the real cookie store's getAll()",
      async () => {
        const storedCookies =
          [
            { name: "sb-access-token", value: "token-1" },
            { name: "sb-refresh-token", value: "token-2" },
          ];

        cookieStoreGetAllMock.mockReturnValueOnce(storedCookies);

        const cookies =
          await capturedCookiesAdapter();

        const result =
          cookies.getAll();

        expect(cookieStoreGetAllMock).toHaveBeenCalledTimes(1);

        expect(result).toBe(storedCookies);
      },
    );

    it(
      "options.cookies.setAll() calls the cookie store's set() once per entry, with that entry's name/value/options",
      async () => {
        const cookiesToSet =
          [
            {
              name: "sb-access-token",
              value: "new-access-token",
              options: { path: "/", maxAge: 3600 },
            },
            {
              name: "sb-refresh-token",
              value: "new-refresh-token",
              options: { path: "/", maxAge: 7200 },
            },
          ];

        const cookies =
          await capturedCookiesAdapter();

        cookies.setAll(cookiesToSet);

        expect(cookieStoreSetMock).toHaveBeenCalledTimes(2);

        expect(cookieStoreSetMock).toHaveBeenNthCalledWith(
          1,
          "sb-access-token",
          "new-access-token",
          { path: "/", maxAge: 3600 },
        );

        expect(cookieStoreSetMock).toHaveBeenNthCalledWith(
          2,
          "sb-refresh-token",
          "new-refresh-token",
          { path: "/", maxAge: 7200 },
        );
      },
    );

    it(
      // 2026-08-29 (this file's own doc comment): a Server Component can
      // read cookies but Next.js throws if you try to set them from one
      // -- the try/catch inside setAll exists specifically to absorb
      // that. Reproduced here by making the mocked cookie store's set()
      // throw, the same way Next.js's real cookies().set() throws when
      // called outside a Server Action/Route Handler.
      "setAll() silently absorbs the error Next.js throws when cookies.set() is called from a Server Component",
      async () => {
        cookieStoreSetMock.mockImplementationOnce(
          () => {
            throw new Error(
              "Cookies can only be modified in a Server Action or Route Handler.",
            );
          },
        );

        const cookies =
          await capturedCookiesAdapter();

        expect(
          () => cookies.setAll(
            [
              {
                name: "sb-access-token",
                value: "new-access-token",
                options: { path: "/" },
              },
            ],
          ),
        ).not.toThrow();

        expect(cookieStoreSetMock).toHaveBeenCalledTimes(1);
      },
    );
  },
);

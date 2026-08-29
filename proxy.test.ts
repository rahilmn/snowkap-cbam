import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  NextRequest,
} from "next/server";

// Mocked at the @supabase/ssr boundary, the same way
// app/api/health/route.test.ts mocks getSupabaseClient rather than
// hitting a real Supabase instance -- this is a unit test of proxy.ts's
// own cookie-plumbing, not an integration test of Supabase Auth's
// refresh behavior itself (that's Supabase's own concern; the local,
// credentialed happy path is covered by tests/e2e/shell.spec.ts, which
// already runs every page through this proxy).
//
// The bug class this actually guards against: the documented
// createServerClient(cookies) pattern requires `setAll` to build a
// *new* NextResponse (via `response = NextResponse.next({ request })`)
// whenever GoTrue calls it mid-`getUser()`, because NextResponse.cookies
// only carry over if you set them on the response you actually return --
// forgetting to reassign `response` (or returning a response captured
// before the refresh) silently drops the refreshed session cookie.
const getUserMock =
  vi.fn();

const createServerClientMock =
  vi.fn(
    (
      _url: string,
      _anonKey: string,
      options: {
        cookies: {
          getAll: () => { name: string; value: string }[];
          setAll: (
            cookies: {
              name: string;
              value: string;
              options: Record<string, unknown>;
            }[],
          ) => void;
        };
      },
    ) => (
      {
        auth: {
          getUser:
            () => getUserMock(options.cookies),
        },
      }
    ),
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
        ) =>
          createServerClientMock(
            url,
            anonKey,
            options,
          ),
    }
  ),
);

const { proxy, config } =
  await import(
    "./proxy"
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

function requestWithCookie(
  cookie?: string,
) {
  return new NextRequest(
    "http://localhost/shipments",
    cookie
      ? { headers: { cookie } }
      : undefined,
  );
}

describe(
  "proxy",
  () => {
    it(
      "carries a refreshed session cookie GoTrue issues mid-getUser() onto the returned response",
      async () => {
        getUserMock.mockImplementationOnce(
          (
            cookies: {
              setAll: (
                cookies: {
                  name: string;
                  value: string;
                  options: Record<string, unknown>;
                }[],
              ) => void;
            },
          ) => {
            // Mirrors what @supabase/ssr's real createServerClient does
            // internally: a near-expiry access token triggers a refresh,
            // and the new session is handed back via the `setAll`
            // callback this file supplied -- never as a return value.
            cookies.setAll(
              [
                {
                  name: "sb-access-token",
                  value: "refreshed-access-token",
                  options: { path: "/" },
                },
              ],
            );

            return {
              data: { user: { id: "user-1" } },
              error: null,
            };
          },
        );

        const response =
          await proxy(
            requestWithCookie(
              "sb-access-token=stale-access-token",
            ),
          );

        expect(
          response.cookies.get(
            "sb-access-token",
          )?.value,
        ).toBe(
          "refreshed-access-token",
        );
      },
    );

    it(
      "passes an already-fresh (or genuinely signed-out) request through with no cookie mutation",
      async () => {
        getUserMock.mockResolvedValueOnce(
          {
            data: { user: null },
            error: { message: "Auth session missing!" },
          },
        );

        const response =
          await proxy(
            requestWithCookie(),
          );

        expect(
          response.cookies.getAll(),
        ).toEqual(
          [],
        );

        expect(
          response.headers.get(
            "x-middleware-next",
          ),
        ).toBe(
          "1",
        );
      },
    );

    it(
      "reads the incoming request's own cookies (not some other request's), scoped per call",
      async () => {
        getUserMock.mockResolvedValueOnce(
          {
            data: { user: { id: "user-1" } },
            error: null,
          },
        );

        await proxy(
          requestWithCookie(
            "sb-access-token=abc123",
          ),
        );

        const [
          cookiesArg,
        ] =
          getUserMock.mock.calls[0];

        expect(
          cookiesArg.getAll(),
        ).toEqual(
          [
            { name: "sb-access-token", value: "abc123" },
          ],
        );
      },
    );

    it(
      // 2026-08-29 (P11 mandatory security review, finding #14):
      // this file's createServerClient call previously omitted
      // cookieOptions entirely, so @supabase/ssr's own default
      // (no `secure`) applied -- the session cookie was eligible to
      // be sent on a plaintext http:// request.
      "passes cookieOptions.secure = true to createServerClient in production",
      async () => {
        const previousNodeEnv =
          process.env.NODE_ENV;

        // @ts-expect-error -- NODE_ENV is readonly in the ambient
        // ProcessEnv type but genuinely writable at runtime; this is
        // the standard pattern this file's own afterEach restore
        // (process.env = {...ORIGINAL_ENV}) already relies on.
        process.env.NODE_ENV =
          "production";

        getUserMock.mockResolvedValueOnce(
          { data: { user: null }, error: null },
        );

        await proxy(
          requestWithCookie(),
        );

        const [, , options] =
          createServerClientMock.mock.calls[0] as [
            string,
            string,
            { cookieOptions?: { secure?: boolean } },
          ];

        expect(options.cookieOptions?.secure).toBe(true);

        // @ts-expect-error -- see the write above.
        process.env.NODE_ENV =
          previousNodeEnv;
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

        getUserMock.mockResolvedValueOnce(
          { data: { user: null }, error: null },
        );

        await proxy(
          requestWithCookie(),
        );

        const [, , options] =
          createServerClientMock.mock.calls[0] as [
            string,
            string,
            { cookieOptions?: { secure?: boolean } },
          ];

        expect(options.cookieOptions?.secure).toBe(false);

        // @ts-expect-error -- see the write above.
        process.env.NODE_ENV =
          previousNodeEnv;
      },
    );

    it(
      "fails open to a plain pass-through response, without ever constructing a Supabase client, when env vars are unset",
      async () => {
        delete process.env.NEXT_PUBLIC_SUPABASE_URL;
        delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

        const response =
          await proxy(
            requestWithCookie(
              "sb-access-token=abc123",
            ),
          );

        expect(
          createServerClientMock,
        ).not.toHaveBeenCalled();

        expect(
          response.headers.get(
            "x-middleware-next",
          ),
        ).toBe(
          "1",
        );
      },
    );

    it(
      "runs on ordinary app routes but excludes static assets and image optimization",
      () => {
        expect(
          config.matcher,
        ).toEqual(
          [
            "/((?!_next/static|_next/image|favicon.ico).*)",
          ],
        );
      },
    );
  },
);

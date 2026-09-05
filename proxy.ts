import {
  createServerClient,
} from "@supabase/ssr";

import {
  NextResponse,
  type NextRequest,
} from "next/server";

import {
  createOpaqueSessionCookieAdapter,
} from "./src/infrastructure/auth/opaque-session-cookies";

/**
 * Named `proxy.ts` per Next.js 16 (the `middleware.ts` file convention
 * is deprecated as of v16.0.0 and renamed to `proxy` -- functionally
 * identical for this file's purpose, same request/response/cookie
 * APIs, same `config.matcher` export).
 *
 * Refreshes the Supabase session cookie on every request. Without
 * this, an access token expires mid-session and every subsequent
 * Server Component read silently runs as signed-out (RLS then denies
 * everything) until the browser client happens to refresh it -- this
 * keeps the cookie current before any Server Component or Route
 * Handler runs.
 *
 * Deliberately calls getUser(), not getSession(): getSession() only
 * reads the (possibly stale, client-supplied) cookie without
 * revalidating it against Supabase Auth, which is exactly the
 * anti-pattern Supabase's own docs warn against for anything used as
 * an authorization signal. getUser() always makes a real Auth server
 * round-trip.
 */
export async function proxy(
  request: NextRequest,
) {
  // SME Experience v2.1.1, S1: derived navigation. Carries the current
  // pathname to every Server Component via headers() (AppShell reads
  // it to derive which nav item is active, replacing a caller-supplied
  // activeNavLabel literal on most pages -- components/shell/derive-
  // active-nav-label.ts). Set on `request.headers` BEFORE the first
  // NextResponse.next({ request }) below, and before this same
  // `request` object is reused by the cookie adapter's own
  // NextResponse.next({ request }) call further down -- both calls
  // read whatever is currently on `request` at the moment they run, so
  // setting it here once, first, means every response Next.js builds
  // from `request` in this function carries it. A presentation-only
  // value (which nav item looks active), never an authorization input
  // -- no route's own capability/membership guard reads it.
  request.headers.set(
    "x-pathname",
    request.nextUrl.pathname,
  );

  let response =
    NextResponse.next(
      {
        request,
      },
    );

  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL;

  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    // Misconfigured environment -- fail open to a normal (signed-out)
    // response rather than crashing every request; server-side reads
    // will fail their own env checks with a clear error where it
    // matters (getServerSupabaseClient).
    return response;
  }

  const supabase =
    createServerClient(
      url,
      anonKey,
      {
        // 2026-08-29 (P11 finding #14) -- see server-client.ts's
        // matching comment for the full reasoning; same fix, applied
        // here too since this is the third of the three create*Client
        // call sites the review named.
        //
        // 2026-08-29 (P13 audit finding #2) -- see server-client.ts's
        // matching comment for the full reasoning. `httpOnly: true` is
        // safe unconditionally here too: this is the middleware/proxy
        // client, which reads/writes cookies via the request/response
        // cookie adapter below (next/server's NextRequest/NextResponse
        // cookie APIs), never via `document.cookie` -- there is no
        // browser-side reader in this file for httpOnly to break.
        cookieOptions: {
          secure: process.env.NODE_ENV === "production",
          httpOnly: true,
        },

        // 2026-09-04 (P14, AUTH-1). Backed by the server-side session
        // store, not by browser cookies -- see server-client.ts's
        // matching comment and
        // src/infrastructure/auth/opaque-session-cookies.ts. What this
        // middleware refreshes is now the STORED provider session; the
        // only thing it ever writes to the browser is the opaque
        // identifier, and usually not even that.
        cookies:
          createOpaqueSessionCookieAdapter(
            {
              getAll() {
                return request.cookies.getAll();
              },

              set(
                name,
                value,
                options,
              ) {
                request.cookies.set(
                  name,
                  value,
                );

                response =
                  NextResponse.next(
                    {
                      request,
                    },
                  );

                response.cookies.set(
                  name,
                  value,
                  options,
                );
              },
            },
          ),
      },
    );

  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    /*
     * Run on every request except static assets and image
     * optimization, which never need a session refresh.
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};

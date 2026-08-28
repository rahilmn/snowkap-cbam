import {
  createServerClient,
} from "@supabase/ssr";

import {
  NextResponse,
  type NextRequest,
} from "next/server";

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
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },

          setAll(
            cookiesToSet,
          ) {
            for (
              const {
                name,
                value,
              } of cookiesToSet
            ) {
              request.cookies.set(
                name,
                value,
              );
            }

            response =
              NextResponse.next(
                {
                  request,
                },
              );

            for (
              const {
                name,
                value,
                options,
              } of cookiesToSet
            ) {
              response.cookies.set(
                name,
                value,
                options,
              );
            }
          },
        },
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

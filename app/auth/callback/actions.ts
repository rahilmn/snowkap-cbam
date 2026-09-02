"use server";

import {
  getServerSupabaseClient,
} from "../../../src/infrastructure/supabase/server-client";

export type EstablishSessionResult =
  | { status: "ok" }
  | {
      status: "error";

      /**
       * 2026-09-03 (P14). GoTrue's own error code, carried out rather
       * than flattened away, so the callback can explain WHICH failure
       * happened. Until now every failure here rendered the single
       * sentence "This link is invalid or has expired.", which told a
       * user with a spent invitation link nothing they could act on --
       * the state a real invitee was left in on 2026-09-02. Null when
       * the error carries no code.
       */
      code: string | null;
    };

/**
 * Establishes the session Supabase Auth email links (invite, magic
 * link, password reset) deliver via an implicit-flow hash fragment
 * (#access_token=...&refresh_token=...) -- called from
 * app/auth/callback/page.tsx, a Client Component, since hash fragments
 * are never sent to the server and so must be read client-side first.
 *
 * Deliberately calls setSession() on the SERVER client
 * (getServerSupabaseClient), not the browser client, even though the
 * tokens originate client-side (P13 adversarial audit, live-reproduced
 * with a standalone cookie probe): once server-client.ts/proxy.ts
 * started writing the session cookie httpOnly (P13 security hardening),
 * a browser that already holds that httpOnly cookie silently refuses
 * any `document.cookie` script write of the same name -- exactly what
 * the browser client's own setSession() does internally. The write
 * appeared to succeed (setSession() resolved with no error) while the
 * cookie never actually changed, so a signed-in user clicking an invite
 * link for a DIFFERENT identity kept acting as their original session.
 * A Server Action's cookie mutations become real Set-Cookie response
 * headers, which the browser cannot refuse the way it refuses a script
 * write -- the same reason signInAction (app/(auth)/actions.ts) already
 * calls signInWithPassword on this same server client rather than the
 * browser one.
 */
export async function establishSessionAction(
  accessToken: string,
  refreshToken: string,
): Promise<EstablishSessionResult> {
  try {
    const supabase =
      await getServerSupabaseClient();

    const { error } =
      await supabase.auth.setSession(
        {
          access_token: accessToken,
          refresh_token: refreshToken,
        },
      );

    if (error) {
      return {
        status: "error",
        code: error.code ?? null,
      };
    }

    return {
      status: "ok",
    };
  } catch {
    return {
      status: "error",
      code: null,
    };
  }
}

/**
 * The PKCE counterpart to establishSessionAction above -- for the
 * `?code=...` query-param shape (live-confirmed via a real Mailpit-
 * captured email + network trace, P13 release-blocker remediation,
 * finding S4): app/(auth)/forgot-password/actions.ts's
 * resetPasswordForEmail call uses @supabase/ssr's PKCE flow by
 * default, which redirects here with a one-time authorization `code`
 * in the URL's QUERY STRING, not the access_token/refresh_token PAIR
 * in a HASH FRAGMENT that admin.inviteUserByEmail()'s fully server-
 * generated links produce. A query string, unlike a hash fragment, IS
 * sent to the server -- app/auth/callback/page.tsx reads it via
 * useSearchParams() and calls this action instead of
 * establishSessionAction when `code` is present.
 *
 * exchangeCodeForSession() needs the matching code_verifier
 * @supabase/ssr's SAME server client wrote as a cookie when
 * resetPasswordForEmail() originally ran (getServerSupabaseClient()
 * reads/writes the real request's cookie store either way) -- calling
 * it on this same server client, in the same browser session that
 * requested the reset, is what makes the exchange succeed.
 */
export async function exchangeCodeForSessionAction(
  code: string,
): Promise<EstablishSessionResult> {
  try {
    const supabase =
      await getServerSupabaseClient();

    const { error } =
      await supabase.auth.exchangeCodeForSession(
        code,
      );

    if (error) {
      return {
        status: "error",
        code: error.code ?? null,
      };
    }

    return {
      status: "ok",
    };
  } catch {
    return {
      status: "error",
      code: null,
    };
  }
}

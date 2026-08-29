"use server";

import {
  getServerSupabaseClient,
} from "../../../src/infrastructure/supabase/server-client";

export type EstablishSessionResult =
  | { status: "ok" }
  | { status: "error" };

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
      };
    }

    return {
      status: "ok",
    };
  } catch {
    return {
      status: "error",
    };
  }
}

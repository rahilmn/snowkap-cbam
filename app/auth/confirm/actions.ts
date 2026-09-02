"use server";

import {
  redirect,
} from "next/navigation";

import {
  getServerSupabaseClient,
} from "../../../src/infrastructure/supabase/server-client";

import {
  createInMemoryRateLimiter,
  type RateLimitConfig,
} from "../../../src/infrastructure/rate-limit/rate-limiter";

import {
  getClientIp,
} from "../../../components/shell/get-client-ip";

import {
  parseConfirmLink,
} from "./parse-confirm-link";

import {
  toAuthLinkKind,
} from "../auth-link-errors";

import type {
  ConfirmLinkActionState,
} from "./action-state";

/**
 * WHY THE TOKEN IS CONSUMED HERE AND NOT ON A GET.
 *
 * Supabase's own documented `/auth/confirm` example is a route handler
 * that calls verifyOtp during the GET. That is exactly the failure this
 * work exists to fix: a link opened by anything other than the human --
 * a corporate mail-security scanner, a link preview, a prefetch -- burns
 * the single-use token before the recipient ever clicks. It happened to a
 * real invitee on 2026-09-02: the token was consumed 76 seconds after
 * delivery by a Chromium client from an Azure address, and the human's
 * click found it spent.
 *
 * So the page is inert on GET and this Server Action, reached only by an
 * explicit form submission, is the only thing in the codebase that calls
 * verifyOtp. tests/architecture/auth-confirm-get-is-inert.test.ts pins
 * that property against the source, including the absence of any
 * auto-submit, because the guarantee is worth nothing if a later effect
 * quietly submits the form on mount.
 *
 * verifyOtp runs on the SERVER client for the same reason
 * establishSessionAction does (see its doc comment): a Server Action's
 * cookie writes become real Set-Cookie response headers, which a browser
 * cannot refuse the way it refuses a script write to an httpOnly cookie.
 */
const CONFIRM_EMAIL_LINK_RATE_LIMIT: RateLimitConfig =
  {
    limit: 30,
    windowMs: 10 * 60 * 1000,
  };

const confirmEmailLinkLimiter =
  createInMemoryRateLimiter(
    CONFIRM_EMAIL_LINK_RATE_LIMIT,
  );

export async function confirmEmailLinkAction(
  _previousState: ConfirmLinkActionState,
  formData: FormData,
): Promise<ConfirmLinkActionState> {
  const rateLimitResult =
    confirmEmailLinkLimiter.check(
      await getClientIp(),
      Date.now(),
    );

  if (!rateLimitResult.allowed) {
    return {
      status: "error",
      code: "over_request_rate_limit",
      kind: toAuthLinkKind(
        formData.get("type")?.toString(),
      ),
      signedInEmail: null,
    };
  }

  // Re-validated here, not trusted from the page: these are hidden form
  // fields, and a hidden field is client-controlled at POST time no
  // matter what the page rendered.
  const parsed =
    parseConfirmLink(
      {
        token_hash:
          formData.get("token_hash")?.toString(),
        type:
          formData.get("type")?.toString(),
        next:
          formData.get("next")?.toString(),
      },
    );

  if (parsed.status === "INVALID") {
    return {
      status: "error",
      code: null,
      kind: toAuthLinkKind(
        formData.get("type")?.toString(),
      ),
      signedInEmail: null,
    };
  }

  const supabase =
    await getServerSupabaseClient();

  const { error } =
    await supabase.auth.verifyOtp(
      {
        token_hash: parsed.tokenHash,
        type: parsed.type,
      },
    );

  if (error) {
    // A spent link in a browser that is ALREADY signed in is a real and
    // recoverable state -- typically the second click of an invitation
    // whose first click worked. Offer to carry on as that identity
    // rather than stranding the user, and name the identity so the offer
    // is never a silent switch.
    const {
      data: { user },
    } = await supabase.auth.getUser();

    return {
      status: "error",
      code: error.code ?? null,
      kind: parsed.type,
      signedInEmail: user?.email ?? null,
    };
  }

  // Outside the try/catch-free path above on purpose: redirect() signals
  // by throwing, so it must not sit anywhere its throw could be mistaken
  // for a failure.
  redirect(
    parsed.next,
  );
}

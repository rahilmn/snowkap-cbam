/**
 * One taxonomy for every way a Supabase Auth email link can fail, shared
 * by /auth/confirm (which consumes the token itself) and /auth/callback
 * (which handles the legacy link shapes still arriving in already-sent
 * mail).
 *
 * WHY THIS EXISTS. Until 2026-09-03 both surfaces rendered exactly one
 * sentence for every failure -- "This link is invalid or has expired." --
 * with no next step and no distinction between causes. A real invitee hit
 * that on 2026-09-02: their invitation token had been consumed by
 * something other than their own click 76 seconds after delivery, and the
 * page told them nothing they could act on. The invitation was still
 * valid; the auth link was not; and the product gave them no way to tell
 * those apart or to recover.
 *
 * Two rules this module keeps.
 *
 * 1. `error_description` from the URL is NEVER rendered. It is
 *    attacker-controllable text arriving on a trusted, branded origin,
 *    and rendering it would let a crafted link put arbitrary wording in
 *    front of a user who has every reason to believe it came from
 *    Snowkap. Only known codes map to copy written here.
 *
 * 2. Every failure offers a real next step. "Set a password" is the one
 *    that actually recovers an invited user: GoTrue's invite verification
 *    confirms the account without the invitee ever choosing a password,
 *    so once the emailed link is spent, a password reset to the same
 *    address is the route back in -- and the organization invitation is
 *    still sitting there, valid for its own seven days.
 */

export type AuthLinkKind =
  | "invite"
  | "signup"
  | "recovery"
  | "magiclink"
  | "email"
  | "email_change"
  | "unknown";

export interface AuthLinkErrorCta {
  label: string;
  href: string;
}

export interface AuthLinkErrorCopy {
  title: string;
  body: string;
  ctas: AuthLinkErrorCta[];
}

const SIGN_IN_CTA: AuthLinkErrorCta =
  {
    label: "Sign in",
    href: "/sign-in",
  };

const SET_PASSWORD_CTA: AuthLinkErrorCta =
  {
    label: "Set a password",
    href: "/forgot-password",
  };

/**
 * A link whose token was already used, or which sat unused past the
 * project's OTP expiry window. GoTrue reports both as `otp_expired`; it
 * does not distinguish them, and neither should the copy, because
 * guessing would be worse than saying what is actually known.
 */
function expiredCopy(
  kind: AuthLinkKind,
): AuthLinkErrorCopy {
  if (kind === "invite") {
    return {
      title: "This invitation link has already been used or has expired",
      body:
        "Email security scanners sometimes open links before you do, and " +
        "each link works only once. Your invitation itself is still " +
        "waiting. If you already have a password, sign in and open " +
        "Pending invitations. If you have not set one yet, set a password " +
        "using the address the invitation was sent to.",
      ctas: [SIGN_IN_CTA, SET_PASSWORD_CTA],
    };
  }

  if (kind === "recovery") {
    return {
      title: "This password reset link has already been used or has expired",
      body:
        "Each reset link works only once. Request a new one and open it " +
        "from the same message.",
      ctas: [SET_PASSWORD_CTA, SIGN_IN_CTA],
    };
  }

  if (kind === "signup") {
    return {
      title: "This confirmation link has already been used or has expired",
      body:
        "If you have already confirmed your email address, simply sign in. " +
        "Otherwise, set a password for the address you signed up with and " +
        "we will email you a fresh link.",
      ctas: [SIGN_IN_CTA, SET_PASSWORD_CTA],
    };
  }

  return {
    title: "This link has already been used or has expired",
    body:
      "Each link works only once. Request a new one, or sign in if you " +
      "already have a password.",
    ctas: [SIGN_IN_CTA, SET_PASSWORD_CTA],
  };
}

export function describeAuthLinkError(
  input: {
    code: string | null;
    kind: AuthLinkKind;

    /**
     * True when the failing link carried a PKCE `?code=` parameter. Those
     * links are bound to the browser that requested them, because the
     * matching code_verifier lives in that browser's cookie jar -- so
     * "you opened it somewhere else" is a genuine, and otherwise
     * completely invisible, explanation.
     */
    pkceCodeShape?: boolean;
  },
): AuthLinkErrorCopy {
  const differentDevice =
    input.pkceCodeShape
      ? " If you opened this link on a different device or browser from " +
        "the one you requested it in, request a new link and open it there."
      : "";

  if (input.code === "otp_expired") {
    const copy =
      expiredCopy(
        input.kind,
      );

    return {
      ...copy,
      body: `${copy.body}${differentDevice}`,
    };
  }

  if (
    input.code === "over_request_rate_limit" ||
    input.code === "over_email_send_rate_limit"
  ) {
    // Deliberately NOT phrased as an expired link. Telling a user their
    // link is invalid when the service is simply busy sends them to
    // request another one, which makes the rate limit worse and loses
    // them a link that would still have worked.
    return {
      title: "Too many attempts right now",
      body:
        "This is a temporary limit, not a problem with your link. Wait a " +
        "minute and select Continue again.",
      ctas: [SIGN_IN_CTA],
    };
  }

  if (
    input.code === "bad_code_verifier" ||
    input.code === "flow_state_not_found" ||
    input.code === "flow_state_expired"
  ) {
    return {
      title: "This link needs to be opened in the browser that requested it",
      body:
        "Password reset links carry a secret that stays in the browser " +
        "you requested them from. Request a new link and open it there, " +
        "or request one from this browser.",
      ctas: [SET_PASSWORD_CTA, SIGN_IN_CTA],
    };
  }

  return {
    title: "This link is invalid or has expired",
    body:
      "Request a new link, or sign in if you already have a password." +
      differentDevice,
    ctas: [SIGN_IN_CTA, SET_PASSWORD_CTA],
  };
}

/**
 * Narrows a raw `type` value from a URL to the kinds this module writes
 * copy for. Anything unrecognised becomes "unknown" and gets the generic
 * wording -- never an error, since the type is only ever used to pick
 * between sentences.
 */
export function toAuthLinkKind(
  value: string | null | undefined,
): AuthLinkKind {
  switch (value) {
    case "invite":
    case "signup":
    case "recovery":
    case "magiclink":
    case "email":
    case "email_change":
      return value;

    default:
      return "unknown";
  }
}

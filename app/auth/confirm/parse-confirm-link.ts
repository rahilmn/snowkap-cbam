import {
  isSafeRedirectPath,
} from "../callback/is-safe-redirect-path";

/**
 * The email-link `type` values this product's own templates emit and
 * verifyOtp accepts as a token_hash verification.
 *
 * This allowlist is load-bearing, not defensive. @supabase/auth-js types
 * EmailOtpType as `... | (string & {})`, which is structurally just
 * `string` -- so nothing in the type system stops an arbitrary `type`
 * from the URL reaching verifyOtp. This array is what stops it.
 */
export const CONFIRMABLE_TYPES =
  [
    "invite",
    "signup",
    "recovery",
    "magiclink",
    "email",
    "email_change",
  ] as const;

export type ConfirmableType =
  (typeof CONFIRMABLE_TYPES)[number];

export type ParsedConfirmLink =
  | {
      status: "OK";
      tokenHash: string;
      type: ConfirmableType;
      next: string;
    }
  | {
      status: "INVALID";
      reason: "MISSING_TOKEN_HASH" | "INVALID_TYPE";
    };

/**
 * Where each link type lands once its token is verified.
 *
 * `invite` deliberately routes to /reset-password rather than straight to
 * /accept-invitation. GoTrue's invite verification confirms the account
 * WITHOUT the invitee ever choosing a password, so an invitee who goes
 * straight to accepting has a working session now and no way back in
 * later -- which is exactly the state one real invited user is in today.
 * Setting a password first costs one screen and removes a dead end.
 *
 * The invite template carries no `next` of its own precisely so this
 * mapping is the single place that decision lives.
 */
export function defaultNextFor(
  type: ConfirmableType,
): string {
  switch (type) {
    case "invite":
      return "/reset-password?next=/accept-invitation";

    case "signup":
      return "/onboarding";

    case "recovery":
      return "/reset-password";

    default:
      return "/";
  }
}

/**
 * Resolves the post-verification destination.
 *
 * An `invite` link always uses its default, ignoring any `next` in the
 * URL: the set-password step is not optional, and letting a query
 * parameter skip it would reintroduce the dead end it exists to close.
 *
 * Every other type may carry a `next`, validated by the unchanged
 * isSafeRedirectPath (single leading slash, no scheme, no control
 * characters -- see that module for the open-redirect chain it closes).
 * An unsafe value falls back to the type's default rather than erroring:
 * the caller still gets signed in, just not sent somewhere
 * attacker-chosen.
 */
export function resolveNextPath(
  type: ConfirmableType,
  requested: string | undefined,
): string {
  if (type === "invite") {
    return defaultNextFor(
      type,
    );
  }

  if (requested && isSafeRedirectPath(requested)) {
    return requested;
  }

  return defaultNextFor(
    type,
  );
}

function firstValue(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

export function parseConfirmLink(
  params: Record<string, string | string[] | undefined>,
): ParsedConfirmLink {
  const tokenHash =
    firstValue(
      params.token_hash,
    )?.trim();

  const rawType =
    firstValue(
      params.type,
    );

  if (!tokenHash) {
    return {
      status: "INVALID",
      reason: "MISSING_TOKEN_HASH",
    };
  }

  const type =
    CONFIRMABLE_TYPES.find(
      (candidate) => candidate === rawType,
    );

  if (!type) {
    return {
      status: "INVALID",
      reason: "INVALID_TYPE",
    };
  }

  return {
    status: "OK",
    tokenHash,
    type,
    next:
      resolveNextPath(
        type,
        firstValue(
          params.next,
        ),
      ),
  };
}

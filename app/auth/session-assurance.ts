/**
 * How was this session established?
 *
 * 2026-09-04 (P14, AUTH-1). A session is not one thing. GoTrue records
 * the authentication method that produced it in the access token's
 * `amr` claim ("authentication method references", RFC 8176), and the
 * product treats two of those methods very differently:
 *
 *   - a session established by clicking an EMAIL LINK (password
 *     recovery, or an invitation's first-password leg) is proof that
 *     the holder controls the account's mailbox, and is the only thing
 *     /reset-password may accept -- that flow exists precisely because
 *     the user does NOT know the current password;
 *
 *   - a session established by SIGNING IN WITH A PASSWORD is proof of
 *     nothing beyond "this browser holds a cookie", because the cookie
 *     is exactly what an attacker steals. It must never be sufficient
 *     to set a new password.
 *
 * Measured against the real GoTrue v2.195.0 this project runs, rather
 * than assumed (scratchpad probe, 2026-09-04):
 *
 *   signInWithPassword       -> amr [{ method: "password" }]
 *   verifyOtp type=recovery  -> amr [{ method: "otp" }]
 *   verifyOtp type=invite    -> amr [{ method: "otp" }]
 *   recovery session, then refreshSession()
 *                            -> amr [{ method: "otp" }]   (survives)
 *
 * That last line is the load-bearing one: the marker is not laundered
 * by a token refresh, so it is a property of the SESSION and not just
 * of the first token minted for it. And it is carried in the signed
 * access token, so it is server-verifiable -- callers must read it
 * through `supabase.auth.getClaims()`, which validates the token
 * against the auth server (or its JWKS) before returning claims, never
 * by decoding a cookie client-side.
 *
 * An attacker holding a stolen password session cannot turn it into an
 * email-link session: doing so requires receiving a link at the
 * account's own mailbox.
 */

/**
 * Authentication methods that mean "the holder proved control of the
 * account's mailbox".
 *
 * Deliberately an ALLOWLIST, and the predicate below fails closed on
 * anything not in it -- an unrecognised method (a future GoTrue
 * spelling, a custom access-token hook, a stripped claim) must read as
 * "not proven", never as "probably fine". `otp` is the value this
 * GoTrue version actually emits for both recovery and invite; the rest
 * are the other spellings GoTrue uses for link/OTP-derived sessions
 * across versions, listed so an upgrade does not silently lock
 * legitimate users out of password recovery.
 *
 * `password` is not here, and that is the entire point.
 */
const EMAIL_LINK_METHODS: ReadonlySet<string> =
  new Set(
    [
      "otp",
      "email_otp",
      "emailotp",
      "magiclink",
      "recovery",
      "invite",
    ],
  );

interface NormalizedAuthMethod {
  method: string;
  timestamp: number | null;
}

/**
 * `amr` is typed `AMREntry[] | string[]` by auth-js: the detailed
 * object form (what this GoTrue emits) and the bare RFC-8176 string
 * form. Both are handled, because the claim is read from a live token
 * rather than from a type.
 */
function normalizeAuthMethods(
  amr: unknown,
): NormalizedAuthMethod[] {
  if (!Array.isArray(amr)) {
    return [];
  }

  const normalized: NormalizedAuthMethod[] = [];

  for (const entry of amr) {
    if (typeof entry === "string") {
      normalized.push(
        {
          method: entry,
          timestamp: null,
        },
      );

      continue;
    }

    if (
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { method?: unknown }).method === "string"
    ) {
      const timestamp =
        (entry as { timestamp?: unknown }).timestamp;

      normalized.push(
        {
          method: (entry as { method: string }).method,
          timestamp:
            typeof timestamp === "number" &&
            Number.isFinite(timestamp)
              ? timestamp
              : null,
        },
      );
    }
  }

  return normalized;
}

/**
 * True only when this session was established by following an emailed
 * link.
 *
 * Fails closed: no `amr`, an unparseable `amr`, an empty one, or a most
 * recent method that is not an email-link method all return false.
 *
 * Ordering: GoTrue appends to `amr` (a reauthentication or an MFA step
 * adds an entry), so the question is about the LATEST authentication,
 * not about whether a link appears anywhere in the session's history --
 * otherwise a session that started as a link and was later re-driven by
 * some other method would keep claiming mailbox control it no longer
 * has. When every entry carries a timestamp the latest is the one with
 * the greatest timestamp. When timestamps are absent (the bare-string
 * form, which cannot be ordered) the strictest reading applies: EVERY
 * method must be an email-link method.
 */
export function sessionWasEstablishedByEmailLink(
  claims: unknown,
): boolean {
  if (
    typeof claims !== "object" ||
    claims === null
  ) {
    return false;
  }

  const methods =
    normalizeAuthMethods(
      (claims as { amr?: unknown }).amr,
    );

  if (methods.length === 0) {
    return false;
  }

  const everyEntryIsTimestamped =
    methods.every(
      (entry) => entry.timestamp !== null,
    );

  if (!everyEntryIsTimestamped) {
    return methods.every(
      (entry) => EMAIL_LINK_METHODS.has(entry.method),
    );
  }

  const latest =
    methods.reduce(
      (mostRecent, entry) =>
        (entry.timestamp ?? 0) >= (mostRecent.timestamp ?? 0)
          ? entry
          : mostRecent,
    );

  return EMAIL_LINK_METHODS.has(latest.method);
}

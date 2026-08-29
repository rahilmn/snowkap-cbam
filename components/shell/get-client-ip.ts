import { headers } from "next/headers";

/**
 * Number of proxy hops between the real client and this process that
 * this deployment trusts to APPEND (never rewrite) their own address
 * onto `x-forwarded-for`. Railway (master plan §29) fronts every
 * request with exactly one edge proxy, so depth 1 means "trust only
 * the last entry -- the one the edge proxy itself appended." A future
 * deployment adding another trusted hop in front of this process (a
 * CDN, a second load balancer) must bump this constant to match, or
 * this function will trust an entry the new outer hop merely passed
 * through rather than the one it appended itself.
 *
 * 2026-08-29 (P11 mandatory security review, BLOCKING, finding #8 /
 * N1, independently confirmed live by two reviewers): this file
 * previously took the FIRST entry, reasoning (never verified) that an
 * *appending* proxy makes the first entry "the one closest to the
 * original client." That reasoning has it backwards for exactly the
 * appending case it describes -- an appending proxy adds its own hop
 * to the END of whatever it received, so the first entry is
 * whatever the ORIGINAL CLIENT sent, unmodified, and the LAST entry
 * is the one the nearest trusted hop actually appended. Reproduced
 * live: an unauthenticated caller sending
 * `X-Forwarded-For: <anything>` picked their own rate-limit bucket on
 * every limiter in the app (bypassing the limit entirely by rotating
 * the value), and -- worse -- could send a VICTIM's real IP as that
 * header value to burn the victim's own bucket and lock them out of
 * sign-in, a capability that did not exist before this rate limiter
 * was added. Taking the last entry (Nth-from-right at TRUSTED_PROXY_HOPS)
 * closes both: the value this function returns is always one Railway's
 * own edge appended, which a client cannot control by sending its own
 * `x-forwarded-for` (Railway appends after whatever the client sent,
 * it does not replace it).
 */
const TRUSTED_PROXY_HOPS = 1;

/**
 * Same next/headers pattern as get-preferred-org-id.ts (cookies) and
 * app/team/actions.ts's own getAppOrigin() (x-forwarded-host) --
 * reading a request-scoped value for Server Actions/Route Handlers to
 * key rate limiting on (src/infrastructure/rate-limit/rate-limiter.ts),
 * per docs/plans/MASTER_PLAN.md §28's "Rate limiting (P11) on auth,
 * mutation, import, and sharing endpoints."
 *
 * HONEST CAVEAT, unchanged by this fix: `x-forwarded-for` is exactly
 * as trustworthy as the network path in front of this process makes
 * it. Taking the TRUSTED_PROXY_HOPS-th entry from the right is correct
 * ONLY when exactly that many proxies sit between the real client and
 * this process, each one appending (never blindly forwarding) its own
 * hop. Run behind a different or misconfigured proxy topology (fewer
 * or more hops than TRUSTED_PROXY_HOPS, or a hop that forwards the
 * header verbatim instead of appending), or with no proxy at all
 * (e.g. `pnpm dev` reached directly, where there is no header to
 * trust at all), and this function's guarantee no longer holds. This
 * is the same class of "in-memory, single-process, honest interim
 * measure" limitation rate-limiter.ts's own header comment documents,
 * not silently assumed away here.
 *
 * Falls back to a fixed, non-empty string rather than "" so every
 * caller of createInMemoryRateLimiter.check() always gets a real key
 * -- development without a proxy (no x-forwarded-for at all, or fewer
 * entries than TRUSTED_PROXY_HOPS) shares one bucket across every
 * local request, which is an acceptable limitation for a header only
 * ever consulted for rate limiting, not for anything security-
 * sensitive like an audit trail.
 */
export async function getClientIp(): Promise<string> {
  const headerList =
    await headers();

  const forwardedFor =
    headerList.get(
      "x-forwarded-for",
    );

  if (!forwardedFor) {
    return "unknown";
  }

  const addresses =
    forwardedFor
      .split(",")
      .map((address) => address.trim())
      .filter((address) => address.length > 0);

  if (addresses.length === 0) {
    return "unknown";
  }

  // The TRUSTED_PROXY_HOPS-th entry counting from the right (index
  // length - TRUSTED_PROXY_HOPS): with exactly one trusted hop, that
  // is the last entry -- the one the nearest trusted proxy itself
  // appended, never a value the original client could have supplied
  // on its own. Clamped to the leftmost entry if the header somehow
  // carries fewer hops than trusted (defensive; still never worse
  // than the pre-fix behavior, which always trusted the leftmost
  // entry unconditionally).
  const trustedIndex =
    Math.max(
      addresses.length - TRUSTED_PROXY_HOPS,
      0,
    );

  const trustedAddress =
    addresses[trustedIndex];

  return trustedAddress && trustedAddress.length > 0
    ? trustedAddress
    : "unknown";
}

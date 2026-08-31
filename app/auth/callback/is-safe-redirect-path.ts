/**
 * 2026-08-29 (P13 audit finding, confirmed live -- open redirect +
 * session injection): the Auth email-link callback (page.tsx) passes
 * its `next` query param straight to router.replace() with no
 * validation. Next's app router hard-navigates off-origin for any
 * external href (isExternalURL: url.origin !== window.location.origin),
 * so an attacker-controlled `next` -- e.g.
 * `?next=https://evil.example` or the protocol-relative
 * `?next=//evil.example` -- sends the victim's browser to a different
 * origin immediately after setSession() has already written the
 * attacker's own session into the victim's cookies (session fixation).
 * The sole legitimate producer of this URL in the whole codebase
 * (app/team/actions.ts's invite email) only ever sends the literal
 * "/accept-invitation" -- an allowlist of "a single leading slash, not
 * two, no scheme" costs nothing and breaks no real use case.
 *
 * Only a plain, same-origin, root-relative path is safe: exactly one
 * leading "/" (never "//", which the browser resolves as
 * protocol-relative to a different host) and no backslash immediately
 * after it either (some browsers normalize a leading "/\" the same way
 * as "//" during URL resolution).
 *
 * ---------------------------------------------------------------
 * 2026-08-31 (P13 FINAL adversarial review): the allowlist above was
 * BYPASSABLE, and the bypass was reproduced end to end in a real browser
 * engine before this fix.
 *
 * The original pattern was `/^\/(?![\\/])/` -- "one leading slash, and
 * the next character is neither a slash nor a backslash". It says
 * nothing about what else may occupy that second position. The WHATWG
 * URL parser STRIPS every ASCII tab, LF and CR from a URL *before*
 * parsing it, so `/<TAB>//evil.example` -- which the old pattern
 * accepted, a tab being neither "/" nor "\" -- becomes `//evil.example`
 * at parse time: protocol-relative, off-origin.
 *
 * Observed, with the regex extracted from this very file:
 *   "/%09//evil.example"  -> "/\t//evil.example"  isSafe=true -> https://evil.example/
 *   "/%0A//evil.example"  -> "/\n//evil.example"  isSafe=true -> https://evil.example/
 *   "/%0D/evil.example"   -> "/\r/evil.example"   isSafe=true -> https://evil.example/
 *
 * So `?next=/%09//evil.example` re-opened precisely the redirect this
 * function exists to close, on an endpoint designed to be clicked from
 * an email -- a credible phishing primitive launched from the trusted
 * product origin.
 *
 * THE FIX is to stop blocklisting the two characters we happened to
 * think of, and instead require the entire value to consist only of
 * characters that are legal in a URL path/query/fragment AND cannot
 * change how a parser reads the URL. Every C0 control (tab, LF, CR
 * included), DEL, space, backslash and non-ASCII byte is excluded by
 * construction -- so a future parser quirk in that same family cannot
 * quietly reopen this the way the tab did.
 */
export function isSafeRedirectPath(
  next: string,
): boolean {
  // Exactly one leading slash, not followed by another slash or a
  // backslash. (Retained verbatim -- this half was always correct.)
  if (
    !/^\/(?![\\/])/.test(
      next,
    )
  ) {
    return false;
  }

  // ...and nothing anywhere in the string that could change how a parser
  // reads it. An ALLOWLIST of permitted characters, deliberately not a
  // blocklist of known-bad ones: RFC 3986 unreserved characters and
  // sub-delims, plus the path/query/fragment separators and "%" for
  // percent-encoding. Anything outside it is rejected rather than
  // reasoned about.
  return /^[A-Za-z0-9\-._~!$&'()*+,;=:@/?#%[\]]+$/.test(
    next,
  );
}

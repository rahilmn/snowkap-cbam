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
 */
export function isSafeRedirectPath(
  next: string,
): boolean {
  return /^\/(?![\\/])/.test(
    next,
  );
}

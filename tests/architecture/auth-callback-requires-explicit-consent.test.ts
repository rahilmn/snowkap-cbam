import {
  readFileSync,
} from "node:fs";

import {
  describe,
  expect,
  it,
} from "vitest";

/**
 * /auth/callback must never establish a session without the person
 * saying so (P14 owner decision 4).
 *
 * Until 2026-09-04 it did exactly that: a `useEffect` on page load read
 * `access_token` and `refresh_token` out of `window.location.hash` and
 * called `setSession()`. No click, no identity shown. Anyone who could
 * get a victim to open a link signed that victim into the ATTACKER'S
 * account, and the victim then entered shipments, emission data and
 * evidence into the attacker's organisation.
 *
 * Like tests/architecture/auth-confirm-get-is-inert.test.ts beside it,
 * this asserts against the source text, because the property is an
 * ABSENCE -- no adoption on the load path, no auto-submit, no hidden
 * fallback -- and an absence is not expressible in the type system. A
 * refactor could reintroduce it without a single unit test noticing,
 * and the regression would be silent by construction.
 */
const SOURCE_PATH =
  "app/auth/callback/page.tsx";

const source =
  readFileSync(SOURCE_PATH, "utf8");

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

const code =
  stripComments(source);

/** The body of the load-time effect, where adoption used to happen. */
function loadEffectBody(): string {
  const start =
    code.indexOf("useEffect(");

  expect(start).toBeGreaterThan(-1);

  // Up to the callback that runs on an explicit press.
  const end =
    code.indexOf("useCallback(");

  expect(end).toBeGreaterThan(start);

  return code.slice(start, end);
}

describe("/auth/callback establishes a session only on explicit consent", () => {
  it(
    "the load-time effect calls neither session action -- a GET, a prefetch, " +
      "a link scanner and a browser preload all leave the session untouched, " +
      "because none of them can press a button",
    () => {
      const body = loadEffectBody();

      expect(body).not.toContain("establishSessionAction");
      expect(body).not.toContain("exchangeCodeForSessionAction");
      expect(body).not.toContain("setSession");
    },
  );

  it("adoption is reachable only from an explicit press", () => {
    // Both actions are still used -- by the confirm handler.
    expect(code).toContain("establishSessionAction");
    expect(code).toContain("exchangeCodeForSessionAction");

    // And that handler is wired to a click, not to a lifecycle hook.
    expect(code).toMatch(/onClick=\{adopt\}/);
  });

  it(
    "there is no auto-submit that would make the press a formality",
    () => {
      for (const forbidden of [
        "requestSubmit",
        "form.submit",
        "autoFocus",
        "click()",
      ]) {
        expect(code).not.toContain(forbidden);
      }
    },
  );

  it(
    "the credential is taken out of the URL rather than left in history",
    () => {
      expect(code).toContain("history.replaceState");
    },
  );

  it(
    "no token is rendered: the confirmation screen names the KIND of link " +
      "and what continuing does, never the credential",
    () => {
      // The JSX must not interpolate the captured material.
      for (const rendered of [
        "{pending.accessToken}",
        "{pending.refreshToken}",
        "{pending.code}",
      ]) {
        expect(code).not.toContain(rendered);
      }
    },
  );

  it("no token reaches a log call", () => {
    for (const logged of [
      "console.log",
      "console.error",
      "console.warn",
      "console.debug",
    ]) {
      expect(code).not.toContain(logged);
    }
  });
});

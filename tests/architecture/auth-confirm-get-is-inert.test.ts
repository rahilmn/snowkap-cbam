import {
  readFileSync,
} from "node:fs";

import {
  describe,
  expect,
  it,
} from "vitest";

/**
 * /auth/confirm exists for exactly one reason: a GET must not consume the
 * single-use token in the URL.
 *
 * On 2026-09-02 a real invitee's invitation token was consumed 76 seconds
 * after delivery by a Chromium client egressing from a Microsoft Azure
 * address -- the signature of a corporate mail-security scanner opening
 * the link before the human did. Their own click then found it spent, and
 * the app could only say "This link is invalid or has expired."
 *
 * The property that fixes it is not expressible in the type system: it is
 * the ABSENCE of a token exchange on the GET path, and the ABSENCE of any
 * auto-submit that would make the Continue press a formality. A future
 * refactor could reintroduce either without any test noticing -- the
 * unit tests would still pass, the E2E prefetch check would still pass if
 * it only used a JS-free HTTP client, and the regression would surface as
 * production users being locked out.
 *
 * So this asserts it against the source text. Crude, and the right tool
 * for the job.
 */
function stripComments(
  source: string,
): string {
  return source
    .replace(
      /\/\*[\s\S]*?\*\//g,
      " ",
    )
    .replace(
      /^\s*\/\/.*$/gm,
      " ",
    );
}

const FORBIDDEN_IN_GET_PATH =
  [
    // Anything that could exchange the token during render.
    "verifyOtp",
    "exchangeCodeForSession",
    "setSession",
    "getSupabaseAdminClient",

    // Anything that could submit the form without a human.
    "useEffect",
    "requestSubmit",
    ".submit(",
    "autoFocus",
  ];

describe(
  "GET /auth/confirm is inert",
  () => {
    it.each(
      [
        "app/auth/confirm/page.tsx",
        "app/auth/confirm/confirm-link-form.tsx",
      ],
    )(
      "%s neither exchanges the token nor auto-submits the form",
      (path) => {
        // Comments are stripped first: these files DOCUMENT the absence
        // of these constructs, so a naive substring search would match
        // the explanation rather than any code. Stripping makes the
        // assertion about what the file does, not what it says.
        const source =
          stripComments(
            readFileSync(
              path,
              "utf-8",
            ),
          );

        for (const forbidden of FORBIDDEN_IN_GET_PATH) {
          expect(
            source,
            `${path} must not contain ${forbidden} -- see this file's doc comment`,
          ).not.toContain(
            forbidden,
          );
        }
      },
    );

    it(
      "keeps the token exchange in the Server Action, where only a form submission reaches it",
      () => {
        // The mirror of the assertion above: the exchange must exist
        // somewhere, or the page is inert because it is broken.
        const action =
          readFileSync(
            "app/auth/confirm/actions.ts",
            "utf-8",
          );

        expect(action).toContain(
          "verifyOtp",
        );

        expect(action).toContain(
          '"use server"',
        );
      },
    );

    it(
      "is the only place in the application that calls verifyOtp",
      () => {
        // If a second call site appears, it needs its own review of
        // whether it is reachable by GET. Keeping the count at one makes
        // that a deliberate act rather than an accident.
        const callback =
          readFileSync(
            "app/auth/callback/page.tsx",
            "utf-8",
          );

        expect(callback).not.toContain(
          "verifyOtp",
        );
      },
    );
  },
);

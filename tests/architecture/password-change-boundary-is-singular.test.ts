import {
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";

import {
  describe,
  expect,
  it,
} from "vitest";

/**
 * There is ONE way to set a password, and it asks for the current one
 * (P14, AUTH-1).
 *
 * The finding was not that some check was wrong. It was that holding a
 * session was, by itself, sufficient authority -- so the fix is only
 * worth anything while that stays true of EVERY reachable path. A
 * second `updateUser({password})` added later, in a route handler or a
 * new action, would reopen it in full without failing a single
 * behavioural test.
 *
 * Like tests/architecture/auth-callback-requires-explicit-consent.test.ts
 * beside it, this asserts against source text, because the property is
 * an absence: no other writer, no invented recency flag standing in for
 * the credential, and no second exported door into the same operation.
 */

const ROOTS = [
  "app",
  "src",
  "components",
];

const SKIP_DIRECTORIES =
  new Set(
    [
      "node_modules",
      ".next",
      "dist",
    ],
  );

function walk(
  directory: string,
): string[] {
  const found: string[] = [];

  for (
    const entry of readdirSync(directory)
  ) {
    if (SKIP_DIRECTORIES.has(entry)) {
      continue;
    }

    const path =
      `${directory}/${entry}`;

    if (statSync(path).isDirectory()) {
      found.push(
        ...walk(path),
      );

      continue;
    }

    if (/\.tsx?$/.test(entry)) {
      found.push(path);
    }
  }

  return found;
}

function stripComments(
  text: string,
): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

const sourceFiles =
  ROOTS.flatMap(
    (root) => walk(root),
  ).filter(
    (path) => !/\.test\.tsx?$/.test(path),
  );

describe(
  "the password-change boundary is the only way to set a password",
  () => {
    it(
      "only two files write a password, and each is gated -- one on a proven current password, the other on an emailed link",
      () => {
        const writers =
          sourceFiles.filter(
            (path) =>
              /updateUser\s*\(/.test(
                stripComments(
                  readFileSync(path, "utf8"),
                ),
              ),
          );

        // If this list grows, the new entry must carry its own proof of
        // authority -- and this test is the place that makes someone
        // say so out loud rather than inheriting a session's say-so.
        expect(writers.sort()).toEqual(
          [
            "app/(auth)/reset-password/actions.ts",
            "app/account/password/change-password.ts",
          ],
        );
      },
    );

    it(
      "the recovery path refuses a session that did not come from an emailed link",
      () => {
        const source =
          stripComments(
            readFileSync(
              "app/(auth)/reset-password/actions.ts",
              "utf8",
            ),
          );

        expect(source).toContain(
          "sessionWasEstablishedByEmailLink",
        );

        // Read from the signed, server-validated token rather than from
        // a cookie the caller controls.
        expect(source).toContain(
          "getClaims",
        );

        // The gate must precede the write, not follow it.
        expect(
          source.indexOf("sessionWasEstablishedByEmailLink"),
        ).toBeLessThan(
          source.indexOf("updateUser"),
        );
      },
    );

    it(
      "the change path verifies the current password before writing, and treats nothing else as proof",
      () => {
        const source =
          stripComments(
            readFileSync(
              "app/account/password/change-password.ts",
              "utf8",
            ),
          );

        expect(source).toContain(
          "verifyCurrentPassword",
        );

        expect(
          source.indexOf("verifyCurrentPassword"),
        ).toBeLessThan(
          source.indexOf("updateUser"),
        );

        // No invented assurance state. The brief names these three by
        // name; the wider patterns catch a rename of the same idea.
        for (
          const forbidden of [
            "hasConfirmedPassword",
            "recentlyAuthenticated",
            "isFresh",
            "session_age",
            "sessionAge",
            "created_at",
            "createdAt",
          ]
        ) {
          expect(source).not.toContain(
            forbidden,
          );
        }
      },
    );

    it(
      "the change-password action file exports exactly one function, so there is no second POST-reachable door",
      () => {
        // Every exported async function in a "use server" file is its
        // own endpoint. The helper that accepts a Supabase client lives
        // outside this file precisely so it is not one.
        const source =
          stripComments(
            readFileSync(
              "app/account/password/actions.ts",
              "utf8",
            ),
          );

        expect(source).toContain(
          '"use server"',
        );

        const exported =
          [
            ...source.matchAll(
              /export\s+(?:async\s+)?function\s+(\w+)/g,
            ),
          ].map(
            (match) => match[1],
          );

        expect(exported).toEqual(
          ["changePasswordAction"],
        );

        expect(source).not.toMatch(
          /export\s+const/,
        );
      },
    );

    it(
      "the verification client cannot become a general privileged client",
      () => {
        const source =
          readFileSync(
            "src/infrastructure/supabase/password-verification-client.ts",
            "utf8",
          );

        // Server-only, per CLAUDE.md's rule for every entry point that
        // touches Supabase.
        expect(source.trimStart()).toMatch(
          /^import "server-only";/,
        );

        // The anon key, never the service role: a password check has no
        // business holding RLS-bypassing rights.
        const code =
          stripComments(source);

        expect(code).toContain(
          "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        );

        expect(code).not.toContain(
          "SERVICE_ROLE",
        );

        // Never persists, so it cannot write the caller's session
        // cookies while checking a password.
        expect(code).toContain(
          "persistSession: false",
        );

        // Returns a verdict, not a session.
        expect(code).not.toMatch(
          /return\s+.*session/i,
        );
      },
    );
  },
);

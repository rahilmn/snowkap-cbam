import {
  describe,
  it,
  expect,
} from "vitest";

import {
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";

import {
  join,
} from "node:path";

import {
  fileURLToPath,
} from "node:url";

/**
 * SME Experience v2.1.1, S1: the experience-switcher cookie
 * (ACTIVE_EXPERIENCE_COOKIE, components/shell/experience-switcher-
 * constants.ts) is a presentation preference, never an authorization
 * input (get-preferred-experience.ts's own doc comment). This test is
 * the structural half of that guarantee: the constant, and the two
 * functions that read it (getPreferredExperience,
 * resolveExperience), may only be imported from components/shell/**
 * and app/page.tsx -- never from src/application/** (a service that
 * branched on it would make it an authorization input in practice,
 * whatever the doc comments say) and never from any route-group
 * layout (app/(importer)/layout.tsx, app/(producer)/layout.tsx must
 * keep gating on hasCapability alone).
 *
 * Same walk-and-grep pattern as
 * tests/architecture/verification-prose-scan.test.ts; comments are
 * stripped first so a reference inside an explanatory comment (like
 * this file's own header) never counts as a real import.
 */

const REPO_ROOT =
  fileURLToPath(
    new URL(
      "../..",
      import.meta.url,
    ),
  );

const SKIP_DIRECTORIES =
  new Set(
    [
      "node_modules",
      ".next",
      "dist",
    ],
  );

// Files allowed to import ACTIVE_EXPERIENCE_COOKIE, getPreferredExperience,
// or resolveExperience. resolveExperience is DEFINED in app-shell.tsx
// (not merely importing itself), which is why that file is in the list
// even though it doesn't "import" the symbol from elsewhere.
function isAllowedFile(
  relativePath: string,
): boolean {
  const normalized =
    relativePath.replace(
      /\\/g,
      "/",
    );

  if (normalized.startsWith("components/shell/")) {
    return true;
  }

  if (normalized === "app/page.tsx") {
    return true;
  }

  return false;
}

function stripComments(
  text: string,
): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

function walk(
  directory: string,
  out: string[],
): void {
  let entries;

  try {
    entries =
      readdirSync(
        directory,
      );
  } catch {
    return;
  }

  for (
    const entry of entries
  ) {
    if (SKIP_DIRECTORIES.has(entry)) {
      continue;
    }

    const fullPath =
      join(
        directory,
        entry,
      );

    const stat =
      statSync(
        fullPath,
      );

    if (stat.isDirectory()) {
      walk(
        fullPath,
        out,
      );

      continue;
    }

    if (/\.tsx?$/.test(entry)) {
      out.push(
        fullPath,
      );
    }
  }
}

const SCAN_ROOTS =
  [
    "app",
    "components",
    "src",
  ];

function listAllSourceFiles(): string[] {
  const files: string[] =
    [];

  for (
    const root of SCAN_ROOTS
  ) {
    walk(
      join(REPO_ROOT, root),
      files,
    );
  }

  return files;
}

const REFERENCE_PATTERN =
  /\b(ACTIVE_EXPERIENCE_COOKIE|getPreferredExperience|resolveExperience)\b/;

describe(
  "experience cookie scope (v2.1.1 §3 -- presentation only, never authorization)",
  () => {
    it(
      "ACTIVE_EXPERIENCE_COOKIE / getPreferredExperience / resolveExperience are referenced only under components/shell/** and app/page.tsx",
      () => {
        const files =
          listAllSourceFiles();

        expect(files.length).toBeGreaterThan(0);

        const violations: string[] =
          [];

        for (
          const file of files
        ) {
          const relativePath =
            file.replace(
              REPO_ROOT,
              "",
            ).replace(
              /^[\\/]/,
              "",
            );

          if (isAllowedFile(relativePath)) {
            continue;
          }

          const stripped =
            stripComments(
              readFileSync(file, "utf8"),
            );

          if (REFERENCE_PATTERN.test(stripped)) {
            violations.push(
              relativePath,
            );
          }
        }

        expect(
          violations,
          `Found reference(s) to the experience-cookie internals outside components/shell/** and app/page.tsx:\n${violations.join("\n")}`,
        ).toEqual(
          [],
        );
      },
    );

    it(
      "no src/application/** file references it",
      () => {
        const applicationFiles: string[] =
          [];

        walk(
          join(REPO_ROOT, "src/application"),
          applicationFiles,
        );

        for (
          const file of applicationFiles
        ) {
          const stripped =
            stripComments(
              readFileSync(file, "utf8"),
            );

          expect(
            REFERENCE_PATTERN.test(stripped),
            `${file} references the experience-cookie internals -- this would make a presentation preference into an authorization input`,
          ).toBe(
            false,
          );
        }
      },
    );

    it(
      "neither route-group layout (app/(importer)/layout.tsx, app/(producer)/layout.tsx) references it -- capability gating must stay hasCapability-only",
      () => {
        for (
          const layoutPath of [
            "app/(importer)/layout.tsx",
            "app/(producer)/layout.tsx",
          ]
        ) {
          const stripped =
            stripComments(
              readFileSync(
                join(REPO_ROOT, layoutPath),
                "utf8",
              ),
            );

          expect(
            REFERENCE_PATTERN.test(stripped),
            `${layoutPath} references the experience-cookie internals`,
          ).toBe(
            false,
          );
        }
      },
    );
  },
);

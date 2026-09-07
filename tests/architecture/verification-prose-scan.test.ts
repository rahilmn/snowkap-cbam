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

import {
  ALLOWED_VERIFICATION_PHRASES,
} from "../../src/domain/status-vocabulary/verification-phrases";

/**
 * Snowkap CBAM SME Experience v2.1.1 §3 Correction B: "verified" /
 * "verification" / "verify" must never describe internally-reviewed
 * emissions data, a dataset, a record, figures, a determination or an
 * evidence set. Internal review is a real product concept (a second
 * admin approving against the evidence) but it is not accredited
 * (Article 8) verification, and conflating the two is the plan's #1
 * release-blocking risk (independent Opus 5 adversarial review, F2).
 *
 * SCOPE. This scans only the route groups and shell components that
 * actually render emissions/provenance copy -- NOT every file under
 * app/**. A blanket tree-wide ban was tried first and produces false
 * positives against entirely unrelated, legitimate uses of the same
 * English word: app/account/password/** talks about password
 * re-verification ("Your current password could not be verified just
 * now"), app/auth/**+app/(auth)/** talk about GoTrue email-link/OTP
 * verification, and app/api/**, app/design/** and app/status/** are
 * technical/demo surfaces. None of those describe emissions data, so
 * none of them belong in this scan -- confirmed by grep across the
 * whole app/ tree before writing this test (2026-09-05).
 *
 * METHOD. This is a text scan, matching the established pattern in
 * tests/architecture/password-change-boundary-is-singular.test.ts, not
 * an AST walk. Comments are stripped first. Within what remains, only
 * QUOTED STRING/TEMPLATE LITERAL CONTENT and JSX TEXT NODES are
 * checked -- never bare code (identifiers, property accesses, type
 * names) -- because those are where a raw domain enum name
 * (VERIFICATION_PENDING, SUBMIT_FOR_VERIFICATION, a variable named
 * verificationStatus) legitimately lives and is not visible prose. A
 * quoted span is excluded from the check if it is entirely
 * SCREAMING_SNAKE_CASE (an enum/discriminant literal, e.g. "VERIFIED")
 * or contains a "/" (an import specifier, e.g.
 * "../regulatory-repository"). Every ALLOWED_VERIFICATION_PHRASES
 * phrase is removed before the final check, case-insensitively.
 */

const REPO_ROOT =
  fileURLToPath(
    new URL(
      "../..",
      import.meta.url,
    ),
  );

// Positive allowlist of roots, not "everything except X" -- see this
// file's own header comment for why. Adding a new route group that
// renders emissions/provenance copy means adding it here.
const SCAN_ROOTS: string[] =
  [
    "app/(importer)",
    "app/(producer)",
    "app/onboarding",
    "app/accept-invitation",
    "app/team",
    "components/shell",
    "components/guidance",
    // 2026-09-07 (S5 review round 6, finding S5R6-A-Y1). components/
    // guidance renders `item.title`/`item.reason` verbatim as JSX
    // expression containers -- the literal prose lives entirely in the
    // GuidanceItem-building domain modules under here (i19.ts,
    // producer-rejected-emission-data.ts, pipeline.ts, etc.), not in
    // the UI file itself, so listing components/guidance alone left
    // the actual source of that prose unscanned. Confirmed live on
    // /attention and the dashboard's guidance tile.
    "src/domain/guidance",
  ];

// A handful of single files outside the directory roots above.
const SCAN_FILES: string[] =
  [
    "app/page.tsx",
  ];

const SKIP_DIRECTORIES =
  new Set(
    [
      "node_modules",
      ".next",
      "dist",
    ],
  );

function isTestFile(
  path: string,
): boolean {
  return /\.test\.tsx?$/.test(
    path,
  );
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
    // The root does not exist yet (e.g. components/guidance is added
    // in S2) -- nothing to scan there yet, not a failure.
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

    if (
      /\.tsx?$/.test(entry) &&
      !isTestFile(entry)
    ) {
      out.push(
        fullPath,
      );
    }
  }
}

function listScannedFiles(): string[] {
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

  for (
    const file of SCAN_FILES
  ) {
    files.push(
      join(REPO_ROOT, file),
    );
  }

  return files;
}

/**
 * Strips /* block *\/ and // line comments. Matches
 * password-change-boundary-is-singular.test.ts's own stripComments --
 * good enough for this codebase's own source (no comment-shaped
 * content inside string literals that this scan cares about).
 */
function stripComments(
  text: string,
): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

// Double- or single-quoted strings (with escapes), or backtick
// templates (with escapes; does not attempt to skip ${...}
// interpolations specially -- an interpolation's own expression code
// is not prose and won't match VERIFICATION_WORD below anyway).
const QUOTED_STRING =
  /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g;

// JSX text nodes: content between `>` and the next `<`, with no `{`/`}`
// (an expression container) inside it, and at least one non-whitespace
// character.
const JSX_TEXT_NODE =
  />([^<>{}]*[^\s<>{}][^<>{}]*)</g;

const SCREAMING_SNAKE_ONLY =
  /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/;

const VERIFICATION_WORD =
  /\bverif(y|ies|ied|ication|ications)\b/i;

function escapeRegExp(
  text: string,
): string {
  return text.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
}

function stripAllowedPhrases(
  text: string,
): string {
  let sanitized =
    text;

  for (
    const phrase of ALLOWED_VERIFICATION_PHRASES
  ) {
    sanitized =
      sanitized.replace(
        new RegExp(
          escapeRegExp(phrase),
          "gi",
        ),
        "",
      );
  }

  return sanitized;
}

function unquote(
  raw: string,
): string {
  return raw.slice(
    1,
    -1,
  );
}

interface Violation {
  file: string;
  span: string;
}

function findViolations(
  filePath: string,
  source: string,
): Violation[] {
  const stripped =
    stripComments(
      source,
    );

  const candidates: string[] =
    [];

  for (
    const match of stripped.matchAll(QUOTED_STRING)
  ) {
    candidates.push(
      unquote(match[0]),
    );
  }

  for (
    const match of stripped.matchAll(JSX_TEXT_NODE)
  ) {
    candidates.push(
      match[1],
    );
  }

  const violations: Violation[] =
    [];

  for (
    const candidate of candidates
  ) {
    const trimmed =
      candidate.trim();

    if (trimmed.length === 0) {
      continue;
    }

    // Enum/discriminant literal (e.g. "VERIFIED",
    // "SUBMIT_FOR_VERIFICATION") -- not prose.
    if (SCREAMING_SNAKE_ONLY.test(trimmed)) {
      continue;
    }

    // An import specifier or file path (e.g.
    // "../../src/infrastructure/.../password-verification-client") --
    // not prose.
    if (trimmed.includes("/")) {
      continue;
    }

    if (!VERIFICATION_WORD.test(trimmed)) {
      continue;
    }

    if (!VERIFICATION_WORD.test(stripAllowedPhrases(trimmed))) {
      continue;
    }

    violations.push(
      {
        file: filePath,
        span: trimmed,
      },
    );
  }

  return violations;
}

describe(
  "verification prose scan (v2.1.1 §3 Correction B)",
  () => {
    it(
      "never renders \"verified\"/\"verification\"/\"verify\" for emissions data, a dataset, a record, figures, a determination or an evidence set, outside the allowed accreditation phrases",
      () => {
        const files =
          listScannedFiles();

        expect(files.length).toBeGreaterThan(0);

        const allViolations: Violation[] =
          [];

        for (
          const file of files
        ) {
          const source =
            readFileSync(
              file,
              "utf8",
            );

          allViolations.push(
            ...findViolations(
              file,
              source,
            ),
          );
        }

        const report =
          allViolations
            .map((v) => `${v.file.replace(REPO_ROOT, "")}: "${v.span}"`)
            .join("\n");

        expect(
          allViolations,
          `Found ${allViolations.length} verification-prose violation(s):\n${report}`,
        ).toEqual(
          [],
        );
      },
    );

    it(
      "STATUS_LABEL values pass the same check (drift guard against the domain module itself)",
      () => {
        // Imported and asserted in src/domain/status-vocabulary/
        // labels.test.ts too -- duplicated here (cheaply) so a
        // violation shows up under this scan's own report as well,
        // which is where a reviewer will look first.
        const violations =
          findViolations(
            "src/domain/status-vocabulary/labels.ts",
            readFileSync(
              join(REPO_ROOT, "src/domain/status-vocabulary/labels.ts"),
              "utf8",
            ),
          );

        expect(violations).toEqual(
          [],
        );
      },
    );
  },
);

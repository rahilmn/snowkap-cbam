import {
  describe,
  expect,
  it,
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
 * Snowkap CBAM SME Experience v2.1.1, S2 -- two of the guidance
 * engine's own hard rules, verified mechanically rather than left to
 * hold only by convention:
 *
 *  1. "Do not read audit events to determine guidance" -- guidance is
 *     derived from authoritative domain state (shipments,
 *     declarations, ...) directly, never from the audit trail, which
 *     records that something happened, not the current live state.
 *
 *  2. "Do not persist unresolved-reason state" -- guidance_dismissals
 *     (20260905160000) stores only a dismissal FINGERPRINT (item_key),
 *     never the item's own content, priority, or the reason a rule
 *     fired. A "reason" column on that table would be exactly the
 *     second, competing source of truth this rule forbids: the real
 *     reason always comes from re-deriving the item fresh, never from
 *     what was true when it was dismissed.
 */

const REPO_ROOT =
  fileURLToPath(
    new URL(
      "../..",
      import.meta.url,
    ),
  );

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
      !/\.test\.tsx?$/.test(entry)
    ) {
      out.push(
        fullPath,
      );
    }
  }
}

const AUDIT_IMPORT_PATTERN =
  /from\s+["'][^"']*\/audit(\/|["'])/;

describe(
  "guidance has no audit-event dependency (v2.1.1: \"do not read audit events to determine guidance\")",
  () => {
    it(
      "no file under src/domain/guidance or src/application/guidance imports from src/domain/audit or src/application/audit",
      () => {
        const files: string[] =
          [];

        walk(
          join(REPO_ROOT, "src/domain/guidance"),
          files,
        );

        walk(
          join(REPO_ROOT, "src/application/guidance"),
          files,
        );

        expect(files.length).toBeGreaterThan(
          0,
        );

        const violations =
          files.filter(
            (file) =>
              AUDIT_IMPORT_PATTERN.test(
                readFileSync(file, "utf8"),
              ),
          );

        expect(
          violations,
        ).toEqual(
          [],
        );
      },
    );
  },
);

describe(
  "guidance_dismissals persists no unresolved-reason state (v2.1.1: \"do not persist unresolved-reason state\")",
  () => {
    it(
      "the migration defines no reason/explanation column -- only a dismissal fingerprint (item_key) and who/when",
      () => {
        const migrationPath =
          join(
            REPO_ROOT,
            "supabase/migrations/20260905160000_sme_guidance_dismissals.sql",
          );

        const sql =
          readFileSync(
            migrationPath,
            "utf8",
          );

        // Extract just the `create table` column block, so this check
        // is about the SCHEMA (what's actually persisted), not the
        // prose comments explaining why it isn't -- those comments
        // legitimately use the word "reason" themselves.
        const createTableMatch =
          sql.match(
            /create table public\.guidance_dismissals\s*\(([\s\S]*?)\n\);/,
          );

        expect(
          createTableMatch,
          "expected to find guidance_dismissals' own CREATE TABLE block",
        ).not.toBeNull();

        const columnBlock =
          createTableMatch?.[1] ??
          "";

        const columnBlockWithoutComments =
          columnBlock
            .replace(/--[^\n]*/g, "")
            .replace(/\/\*[\s\S]*?\*\//g, "");

        // Deliberately NOT \breason\b -- underscore is a word
        // character in regex, so \b would not match the boundary in a
        // snake_case column name like "dismissal_reason" (confirmed:
        // this exact bug let a temporarily-added "dismissal_reason
        // text" column pass this check silently during this test's own
        // development). Plain substring match instead, so any column
        // NAMED with "reason" anywhere in it -- "reason",
        // "dismissal_reason", "reason_text" -- is caught.
        expect(
          /reason/i.test(
            columnBlockWithoutComments,
          ),
        ).toBe(
          false,
        );
      },
    );
  },
);

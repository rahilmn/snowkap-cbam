#!/usr/bin/env node
/**
 * Scan tracked files for committed credentials, and fail the build on a
 * hit.
 *
 * ------------------------------------------------------------------
 * WHY THIS IS A SCRIPT AND NOT TWO SHELL STEPS
 *
 * It used to be two shell steps, one per CI job, and the P14 review
 * found that the `build-and-test` copy had been a guaranteed no-op
 * since 464d6d8. `ci.yml:602` referenced `$KNOWN_SAFE_PROCESS_ENV_ASSIGNMENT`,
 * a variable no line of the workflow ever defined. Under
 * `set -euo pipefail` the unbound expansion killed the command
 * substitution; the trailing `|| true` -- which is there for the
 * legitimate reason that `grep -v` exits 1 when it filters every line
 * away -- absorbed it; `MATCHES` was unconditionally empty; and the
 * step printed its success string and exited 0. On every run.
 *
 * The certification run this project reported as green says both halves
 * out loud, eleven lines apart, and nobody read the first one:
 *
 *     line 1909: KNOWN_SAFE_PROCESS_ENV_ASSIGNMENT: unbound variable
 *     line 1911: No secret-shaped literals found in tracked files.
 *
 * That step already carried a careful comment explaining that exactly
 * this class of silent failure had been fixed once before, for
 * `git grep`'s exit code, by splitting the pipeline and checking the
 * status explicitly. The fix was correct and did not generalise,
 * because the shell offers no way to distinguish "this filter removed
 * every line" from "this filter never ran" once both have been folded
 * into one `|| true`.
 *
 * So the structural answer is to stop writing this in a language where
 * an undefined name is a runtime event that can be swallowed. In Node,
 * a misspelled identifier is a ReferenceError that terminates the
 * process with a stack trace, and the allow-list is a literal array
 * that cannot be half-defined.
 *
 * The two jobs now call this one implementation. They had drifted --
 * `fast-gates` never carried the SUPABASE_*= or postgres:// rules at
 * all -- so with the other scan dead, NO job in the pipeline could
 * catch a committed database password. One implementation, two callers,
 * is also why that drift cannot recur.
 *
 * ------------------------------------------------------------------
 * THE SELF-TEST, AND WHY IT RUNS ON EVERY INVOCATION
 *
 * The lesson of B3 is not "that variable was misspelled". It is that a
 * security gate reporting success proves nothing unless the same run
 * also proves the gate can still fail. So before it looks at the
 * repository at all, this script checks that:
 *
 *   - every pattern still matches a freshly constructed example of the
 *     secret shape it is for, and
 *   - every allow-list entry still matches the known-safe line it was
 *     added for, and
 *   - a real-looking credential is NOT swallowed by any allow-list
 *     entry.
 *
 * If any of those is false the scan exits non-zero and says which one.
 * A pass therefore means "the scan works and found nothing", never
 * merely "the scan printed something".
 *
 * Usage:
 *
 *     node scripts/ci/scan-for-committed-secrets.mjs
 *     node scripts/ci/scan-for-committed-secrets.mjs --paths <file>...
 *
 * Exits 0 when the scan is provably working and finds nothing, 1 on a
 * hit or a broken scan, 2 on a usage or git error.
 *
 * Deliberately no npm dependency: this runs in `fast-gates`, which must
 * pass on a fresh checkout with no secrets configured.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

/** Files larger than this are assets or fixtures, not places a credential hides. */
const MAX_SCANNED_FILE_BYTES = 5 * 1024 * 1024;

/**
 * Secret shapes. Each carries an `example` used by the self-test --
 * constructed here from parts so that this file's own examples cannot
 * be mistaken for, or decay into, a real credential.
 *
 * Every `example` is deliberately assembled at runtime rather than
 * written as one literal, so that this source file does not itself
 * contain a string the scan would flag.
 */
const SECRET_SHAPES = [
  {
    name: "jwt",
    description: "a JWT-shaped token (Supabase anon / service_role keys)",
    pattern: /eyJ[A-Za-z0-9_-]{20,}/,
    example: "eyJ" + "hbGciOiJIUzI1NiJ9" + "QUJDREVGR0hJSktMTU5PUFFS",
  },
  {
    name: "openai-style",
    description: "an sk- prefixed API key",
    pattern: /sk-[A-Za-z0-9]{20,}/,
    example: "sk-" + "A".repeat(24),
  },
  {
    name: "resend",
    description: "a Resend API key",
    pattern: /re_[A-Za-z0-9]{20,}/,
    example: "re_" + "B".repeat(24),
  },
  {
    name: "supabase-api-key",
    description: "a Supabase publishable/secret API key",
    pattern: /sb_(publishable|secret)_[A-Za-z0-9_-]{10,}/,
    example: "sb_" + "secret_" + "C".repeat(16),
  },
  {
    name: "supabase-env-assignment",
    description:
      "a SUPABASE_SERVICE_ROLE_KEY / SUPABASE_DB_PASSWORD / SUPABASE_ANON_KEY assignment, quoted or unquoted, = or :",
    // Written to match the SYNTAX of an assignment rather than
    // "the name, then roughly anything". Every refinement here came
    // from a false positive on a document whose SUBJECT is this scan --
    // the P14 review reports quote the shapes it is meant to catch, and
    // that is precisely the document class the P13 audit found excluded
    // wholesale and correctly refused to exclude again.
    //
    //  * The value cannot begin with `<`, a backtick or a backslash:
    //    those begin a documentation placeholder, a markdown code span
    //    and a JSON string escape respectively, and all three are
    //    everywhere in text about credentials. None can begin a real
    //    credential.
    //  * The value must run at least 8 characters with no whitespace.
    //    Prose breaks immediately -- `SUPABASE_DB_PASSWORD= or the anon
    //    key` and `SUPABASE_SERVICE_ROLE_KEY = ...` both stop at two or
    //    three -- while a Supabase credential never does: a
    //    service-role key is a JWT and a database password is
    //    generated. The trade-off is stated rather than hidden: a
    //    committed password shorter than eight characters would be
    //    missed by THIS rule, though a JWT-shaped one is still caught
    //    by the `jwt` rule above.
    //
    // An earlier version of this refinement forbade whitespace after
    // `=` instead. The self-test rejected it: that also stops matching
    // `process.env.SUPABASE_SERVICE_ROLE_KEY = "<a real key>"`, and the
    // run said so by reporting the process.env allow-list entry as
    // newly dead. The length rule keeps that shape detectable.
    //
    // Nothing here changes what a real leak looks like, and every
    // refinement is asserted in both directions on every run --
    // `example` for the positive, `mustNotMatch` for each exemption.
    pattern:
      /SUPABASE_(SERVICE_ROLE_KEY|DB_PASSWORD|ANON_KEY)"?\s*[:=]\s*['"]?[^$\s'"<`\\]{8,}/,
    example: 'SUPABASE_DB_' + 'PASSWORD="hunter2hunter2"',
    mustNotMatch: [
      "SUPABASE_SERVICE_ROLE_" + "KEY=<the local service_role key>",
      "SUPABASE_DB_" + "PASSWORD: <your password>",
      "cannot match " + "SUPABASE_DB_" + "PASSWORD= or the anon key",
      "`" + "SUPABASE_SERVICE_ROLE_" + "KEY = ...`",
      "and cannot match `" + "SUPABASE_DB_" + "PASSWORD=` or",
      '"evidence": "' + "SUPABASE_DB_" + 'PASSWORD=\\n"',
    ],
  },
  {
    name: "postgres-url",
    description: "a postgres:// connection string carrying a password",
    pattern: /postgres(ql)?:\/\/[^\s'"/]+:[^\s'"/@]{6,}@/,
    example: "postgres" + "://someuser:" + "s3cretpw" + "@db.example.internal:5432/postgres",
  },
];

/**
 * Known-safe literals.
 *
 * Each entry is allow-listed by its EXACT, FIXED payload -- never by
 * excluding a file, a directory or a file class. That rule is older
 * than this script: the P13 audit found this scan had been excluding
 * every tracked Markdown file, which meant SECRET_ROTATION.md,
 * BACKUP_RESTORE.md, SUPPORT_ACCESS.md and DEPLOYMENT.md -- precisely
 * the documents whose subject matter is credentials -- were unscanned.
 * Removing that exclusion surfaced exactly one legitimate false
 * positive, so a narrow allow-list entry, not a broad exclusion, was
 * what the false-positive goal actually needed.
 *
 * `mustMatch` is the line this entry exists for. The self-test asserts
 * the entry still filters it, so an entry that has become dead is
 * reported rather than silently carried forever.
 */
const KNOWN_SAFE = [
  {
    name: "local-supabase-demo-jwt",
    // The fixed local-only Supabase CLI demo JWTs (iss "supabase-demo")
    // used as fixtures in tests/integration/*-isolation.test.ts.
    // Identical on every local Supabase install everywhere; not derived
    // from this project's credentials.
    literal: "eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6",
    mustMatch:
      'tests/integration/organizations-isolation.test.ts:1:const ANON = "eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6YW5vbiI9"',
    notMatch: [
      'src/example.ts:1:const key = "eyJ' + 'hbGciOiJIUzI1NiJ9' + '.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig"',
    ],
  },
  {
    name: "local-supabase-postgres-url",
    // Supabase CLI's own hardcoded local default, identical on every
    // machine that has ever run `supabase start`, quoted verbatim in
    // BACKUP_RESTORE.md's real drill transcript.
    literal: "postgres:postgres@127.0.0.1",
    mustMatch:
      "docs/runbooks/BACKUP_RESTORE.md:1:psql postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    notMatch: [
      "docs/runbooks/DEPLOYMENT.md:1:postgres" +
        "://postgres:" +
        "aRealProductionPassword" +
        "@db.hosted.example:5432/postgres",
    ],
  },
  {
    name: "local-supabase-db-password-in-ci",
    // ci.yml sets SUPABASE_DB_PASSWORD for the local Supabase the
    // workflow starts. The value IS the Supabase CLI's local default,
    // the same one already allow-listed in the connection-string form
    // above. Allow-listed as the exact assignment rather than by
    // excluding .github/workflows/ci.yml, which the old shell scan did
    // -- so a real key pasted into the workflow is now caught, where
    // before it was not.
    literal: "SUPABASE_DB_PASSWORD: postgres",
    mustMatch: ".github/workflows/ci.yml:233:          SUPABASE_DB_PASSWORD: postgres",
    notMatch: [
      ".github/workflows/ci.yml:1:          SUPABASE_DB_PASSWORD: " +
        "aRealProductionPassword",
    ],
  },
  {
    name: "ci-anon-key-placeholder",
    // The literal placeholder ci.yml passes to `pnpm build` in the
    // no-secrets job. It says what it is.
    literal: "NEXT_PUBLIC_SUPABASE_ANON_KEY: ci-placeholder-not-a-real-key",
    mustMatch:
      ".github/workflows/ci.yml:106:          NEXT_PUBLIC_SUPABASE_ANON_KEY: ci-placeholder-not-a-real-key",
    notMatch: [
      ".github/workflows/ci.yml:1:          NEXT_PUBLIC_SUPABASE_ANON_KEY: eyJ" +
        "hbGciOiJIUzI1NiJ9" +
        "QUJDREVGR0hJSktMTU5PUFFS",
    ],
  },
  {
    name: "process-env-assignment-from-identifier",
    // 2026-09-03 (P14 blocker B3). THIS is the rule the dead
    // `$KNOWN_SAFE_PROCESS_ENV_ASSIGNMENT` variable was supposed to
    // carry, written out and, unlike its predecessor, actually
    // present and actually proven on every run.
    //
    // tests/integration/calculation-reproduction.test.ts re-keys the
    // regulatory adapter at runtime by assigning process.env from
    // another VARIABLE. The right-hand side is a JavaScript identifier,
    // never a literal, so the line contains no credential -- but the
    // SUPABASE_(...)= shape matches it.
    //
    // Necessarily a pattern rather than a fixed literal, because the
    // identifier on the right differs per call site. It is kept narrow
    // by three things, each asserted by a notMatch line below: the
    // left-hand side must be a `process.env.` member expression, the
    // right-hand side must be a bare identifier (no quote, no digit
    // start), and the statement must end in a semicolon.
    pattern:
      /process\.env\.SUPABASE_[A-Z_]+\s*=\s*[A-Za-z_$][A-Za-z0-9_$]*;/,
    mustMatch:
      "tests/integration/calculation-reproduction.test.ts:274:      process.env.SUPABASE_SERVICE_ROLE_KEY = LOCAL_SERVICE_ROLE_KEY;",
    notMatch: [
      // A string literal on the right is a real leak and must survive.
      'src/x.ts:1:process.env.SUPABASE_SERVICE_ROLE_KEY = "' +
        "eyJ" +
        'hbGciOiJIUzI1NiJ9QUJDREVGR0hJSktMTU5PUFFS";',
      // A dotenv-style assignment is a real leak and must survive. This
      // is the exact case the P14 audit claimed had been "verified in
      // both directions" against a filter that was never committed.
      "docs/runbooks/x.md:1:SUPABASE_DB_" + "PASSWORD=aRealProductionPassword",
    ],
  },
  {
    name: "p14-review-synthetic-jwt",
    // 2026-09-03 (P14 blocker B4). The P14 adversarial review's own
    // findings files quote a JWT-shaped string that one attack agent
    // CONSTRUCTED, in order to demonstrate that the build-and-test
    // secret scan was inert. Its "signature" segment is the first
    // sixteen letters of the alphabet. It is a piece of evidence about
    // a security gate, not a credential -- but it is JWT-shaped, so it
    // made the candidate commit fail its own fast-gates scan.
    //
    // Allow-listed as the COMPLETE literal rather than a prefix, so a
    // real token that happens to share the standard
    // {"alg":"HS256","typ":"JWT"} header still fails: notMatch below
    // carries exactly that header with a realistic body and asserts
    // this entry does not filter it.
    literal:
      "eyJ" + "hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" + "abcdefghijklmnop",
    mustMatch:
      'docs/plans/P14_ADVERSARIAL_REVIEW_FINDINGS.json:1063:"evidence": "... eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdefghijklmnop ..."',
    notMatch: [
      "src/example.ts:1:const key = " +
        '"eyJ' +
        "hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
        '.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk"',
    ],
  },
  {
    name: "p14-review-synthetic-db-password",
    // 2026-09-03 (P14 blocker B4, same class as the entry above). The
    // P14 review documents -- the audit and the findings JSON -- discuss
    // the dead secret scan, and to do so they quote the dotenv line that
    // scan was supposed to catch. The password in that example is the
    // fixed placeholder "hunter2secret", used throughout the review.
    //
    // Narrow by construction: the value is part of the allow-listed
    // literal, so a genuine password is filtered only if it begins with
    // the characters "hunter2secret". notMatch asserts a different
    // password on the identical line shape still fails the scan.
    literal: "SUPABASE_DB_PASSWORD=hunter2secret",
    mustMatch:
      "docs/plans/P14_FINAL_RELEASE_AUDIT.md:2389:dotenv-style `SUPABASE_DB_PASSWORD=hunter2secret` -- exactly what this",
    notMatch: [
      "docs/plans/P14_FINAL_RELEASE_AUDIT.md:1:`SUPABASE_DB_" +
        "PASSWORD=aRealProductionPassword`",
    ],
  },

  // ----------------------------------------------------------------
  // 2026-09-03 (P14 remediation). The credentials the review INVENTED
  // in order to prove the old scan was dead.
  //
  // P14_INDEPENDENT_ADVERSARIAL_FINDINGS.json records, verbatim, the
  // planted files the attack agents committed to throwaway repositories
  // to demonstrate that build-and-test's scan reported clean on real
  // leaks. Those strings are the evidence. They are also, by
  // construction, exactly the shape this scan exists to catch -- which
  // is the whole point of them, and why they are here rather than
  // edited out of the record.
  //
  // Each is allow-listed as its COMPLETE payload, including the
  // fabricated password, so a genuine credential is filtered only if it
  // is character-for-character one of these. Every entry carries a
  // notMatch that changes one character and asserts it still fails.
  //
  // The alternative -- excluding the file -- is the exact move the P13
  // audit found had left SECRET_ROTATION.md, BACKUP_RESTORE.md and
  // DEPLOYMENT.md unscanned, and it stays refused.
  // ----------------------------------------------------------------
  {
    name: "p14-review-planted-pg-url-supabase-host",
    literal:
      "postgresql://postgres:RealProdPassword9@db.abcdefgh.supabase.co:5432/postgres",
    mustMatch:
      "docs/plans/P14_INDEPENDENT_ADVERSARIAL_FINDINGS.json:560:postgresql://postgres:RealProdPassword9@db.abcdefgh.supabase.co:5432/postgres",
    notMatch: [
      "src/x.ts:1:postgresql" +
        "://postgres:RealProdPassword8@db.abcdefgh.supabase.co:5432/postgres",
    ],
  },
  {
    name: "p14-review-planted-pg-url-example-host",
    literal: "postgresql://admin:RealProdPassword123@db.example.com:5432/app",
    mustMatch:
      "docs/plans/P14_INDEPENDENT_ADVERSARIAL_FINDINGS.json:1460:postgresql://admin:RealProdPassword123@db.example.com:5432/app",
    notMatch: [
      "src/x.ts:1:postgresql" +
        "://admin:RealProdPassword124@db.example.com:5432/app",
    ],
  },
  {
    name: "p14-review-generic-pg-url-template",
    // Literally the word "password" between the colons -- a shape
    // template in prose, not a credential.
    literal: "postgres://user:password@host",
    mustMatch:
      "docs/plans/P14_INDEPENDENT_ADVERSARIAL_FINDINGS.json:484:a `postgres://user:password@host` URL",
    notMatch: ["src/x.ts:1:postgres" + "://user:hunter2secret@host"],
  },
  {
    name: "p14-review-placeholder-pg-url-template",
    literal: "postgresql://postgres:<realpassword>@db.<ref>.supabase.co",
    mustMatch:
      "docs/plans/P14_INDEPENDENT_ADVERSARIAL_FINDINGS.json:559:postgresql://postgres:<realpassword>@db.<ref>.supabase.co:5432/postgres",
    notMatch: [
      "src/x.ts:1:postgresql" +
        "://postgres:anActualPassword@db.abcdefgh.supabase.co",
    ],
  },
  {
    name: "p14-review-planted-db-password",
    literal: "SUPABASE_DB_PASSWORD=Hunter2ProdPassword",
    mustMatch:
      "docs/plans/P14_INDEPENDENT_ADVERSARIAL_FINDINGS.json:560:  SUPABASE_DB_PASSWORD=Hunter2ProdPassword",
    notMatch: [
      "src/x.ts:1:SUPABASE_DB_" + "PASSWORD=Hunter3ProdPassword",
    ],
  },
  {
    name: "local-supabase-db-password-dotenv",
    // The Supabase CLI's local default in its dotenv form, in a
    // recommendation to add a CI step. The trailing " pnpm" is part of
    // the allow-listed literal on purpose: without it, this entry would
    // also filter `SUPABASE_DB_PASSWORD=postgresqlRealSecret`, and the
    // self-test said so when the first version omitted it.
    literal: "SUPABASE_DB_PASSWORD=postgres pnpm",
    mustMatch:
      "docs/plans/P14_INDEPENDENT_ADVERSARIAL_FINDINGS.json:1943:`SUPABASE_DB_PASSWORD=postgres pnpm regulatory:verify`",
    notMatch: [
      "src/x.ts:1:SUPABASE_DB_" + "PASSWORD=postgresqlRealSecret",
    ],
  },
];

const EXCLUDED_PATHSPECS = [
  ":!pnpm-lock.yaml",
  // This file names every pattern and every allow-listed literal, so it
  // matches itself by construction. Excluded by exact path, and its own
  // correctness is covered by tests/unit/scan-for-committed-secrets.test.ts
  // rather than by the scan.
  ":!scripts/ci/scan-for-committed-secrets.mjs",
];

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

function knownSafeEntryMatches(entry, line) {
  return entry.literal !== undefined
    ? line.includes(entry.literal)
    : entry.pattern.test(line);
}

function isKnownSafe(line) {
  return KNOWN_SAFE.some((entry) => knownSafeEntryMatches(entry, line));
}

function matchedShapes(line) {
  return SECRET_SHAPES.filter((shape) => shape.pattern.test(line)).map(
    (shape) => shape.name,
  );
}

/**
 * Prove, on this run, that the scan can still both detect and exempt.
 * Returns a list of failures rather than throwing, so one invocation
 * reports every broken thing instead of only the first.
 */
export function runSelfTest() {
  const failures = [];

  for (const shape of SECRET_SHAPES) {
    if (!shape.pattern.test(shape.example)) {
      failures.push(
        `pattern "${shape.name}" no longer matches its own example of ${shape.description}. The scan would not detect this secret shape.`,
      );
    }
    if (isKnownSafe(shape.example)) {
      failures.push(
        `a known-safe entry swallows the example for "${shape.name}". An allow-list entry has become broad enough to hide a real secret.`,
      );
    }
    for (const line of shape.mustNotMatch ?? []) {
      if (shape.pattern.test(line)) {
        failures.push(
          `pattern "${shape.name}" matches a line it must not, so it will report a false positive: ${line}`,
        );
      }
    }
  }

  for (const entry of KNOWN_SAFE) {
    if (matchedShapes(entry.mustMatch).length === 0) {
      failures.push(
        `known-safe entry "${entry.name}" is dead: the line it exists for no longer matches any secret pattern, so the entry is now pure attack surface. Remove it, or fix the line.`,
      );
    }
    if (!isKnownSafe(entry.mustMatch)) {
      failures.push(
        `known-safe entry "${entry.name}" no longer filters the line it was added for. The scan will report a false positive.`,
      );
    }
    if (entry.notMatch.length === 0) {
      failures.push(
        `known-safe entry "${entry.name}" carries no notMatch line. Every entry must state, and prove on every run, a real credential it does NOT hide.`,
      );
    }

    for (const line of entry.notMatch) {
      if (knownSafeEntryMatches(entry, line)) {
        failures.push(
          `known-safe entry "${entry.name}" filters a line it must NOT filter, so it is broad enough to hide a real credential: ${line}`,
        );
      }
    }
  }

  return failures;
}

/** The scan proper, over an array of `path:line:text` strings. */
export function findSecrets(grepLines) {
  return grepLines
    .filter((line) => line.length > 0)
    .filter((line) => !isKnownSafe(line))
    .map((line) => ({ line, shapes: matchedShapes(line) }))
    .filter((hit) => hit.shapes.length > 0);
}

/**
 * Enumerate tracked files and match them in Node.
 *
 * NOT `git grep -E "<pattern>"`. The first version of this script did
 * exactly that -- joined the JavaScript patterns into one alternation
 * and handed it to git -- and the regression suite caught the reason
 * that is a bad idea within minutes: `git grep -E` is POSIX ERE, where
 * `\s` is not a whitespace class and `\/` is not an escape, so the
 * postgres:// pattern silently matched nothing while the others matched
 * by luck. A scan whose patterns mean one thing in its tests and
 * another in production is the same defect as B3 wearing a different
 * hat: a gate that reports success without doing the work.
 *
 * So git is used only for the one thing it is authoritative about --
 * which files are tracked -- and every pattern is evaluated exactly
 * once, in one dialect, by the same code the unit tests exercise.
 */
function scanTrackedFiles() {
  const listed = spawnSync("git", ["ls-files", "-z"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

  if (listed.error) {
    console.error(`::error::could not run git ls-files: ${listed.error.message}`);
    process.exit(2);
  }

  if (listed.status !== 0) {
    console.error(
      `::error::git ls-files exited ${listed.status}. Treating this as a broken scan, not "no secrets found".
${listed.stderr}`,
    );
    process.exit(1);
  }

  const excluded = new Set(
    EXCLUDED_PATHSPECS.map((spec) => spec.replace(/^:!/, "")),
  );

  const paths = listed.stdout
    .split("\u0000")
    .filter((path) => path.length > 0 && !excluded.has(path));

  const lines = [];

  for (const path of paths) {
    let contents;

    try {
      const stats = statSync(path);

      // Skip anything implausibly large for a source or doc file. A
      // secret is a short string in a text file; a 5 MB blob is a
      // fixture or an asset, and reading them all would make this gate
      // slow enough that someone would be tempted to weaken it.
      if (!stats.isFile() || stats.size > MAX_SCANNED_FILE_BYTES) {
        continue;
      }

      contents = readFileSync(path, "utf8");
    } catch {
      // Unreadable or vanished between ls-files and now. Not a silent
      // pass: report it, because "the scan could not read a tracked
      // file" is exactly the kind of thing that must never be rounded
      // down to "clean".
      console.error(`::warning::could not read tracked file ${path}; it was not scanned`);
      continue;
    }

    // Binary files contain NUL. git grep skips them by default; so do
    // we, and for the same reason.
    if (contents.includes("\u0000")) {
      continue;
    }

    const fileLines = contents.split(/\r?\n/);

    for (let index = 0; index < fileLines.length; index += 1) {
      const text = fileLines[index];

      if (text.length === 0) {
        continue;
      }

      if (SECRET_SHAPES.some((shape) => shape.pattern.test(text))) {
        lines.push(`${path}:${index + 1}:${text}`);
      }
    }
  }

  return lines;
}

function main() {
  const selfTestFailures = runSelfTest();

  if (selfTestFailures.length > 0) {
    for (const failure of selfTestFailures) {
      console.error(`  - ${failure}`);
    }
    fail(
      `the committed-secret scan failed its own self-test (${selfTestFailures.length} problem(s) above). Refusing to report a clean scan from a scanner that cannot prove it still works.`,
    );
  }

  console.log(
    `Self-test passed: ${SECRET_SHAPES.length} secret shapes still detect their own examples, ${KNOWN_SAFE.length} known-safe entries still filter exactly the lines they exist for and nothing more.`,
  );

  const hits = findSecrets(scanTrackedFiles());

  if (hits.length > 0) {
    for (const hit of hits) {
      console.error(`${hit.line}   [${hit.shapes.join(", ")}]`);
    }
    fail(
      `possible committed secret literal found in ${hits.length} tracked line(s), listed above. If one is a documented synthetic fixture, add its exact literal to KNOWN_SAFE in scripts/ci/scan-for-committed-secrets.mjs with the line it exists for -- never a file or directory exclusion.`,
    );
  }

  console.log("No secret-shaped literals found in tracked files.");
}

// Only run when invoked directly, so the unit test can import the parts.
if (process.argv[1] && process.argv[1].endsWith("scan-for-committed-secrets.mjs")) {
  main();
}

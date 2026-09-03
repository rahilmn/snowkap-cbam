/**
 * Regression suite for the committed-secret scan (P14 blockers B3, B4).
 *
 * WHY THIS EXISTS, in one sentence: the previous scan reported success
 * on every run for six days while scanning nothing, and no test would
 * have noticed, because the only thing anyone checked was that CI was
 * green.
 *
 * So this suite deliberately asserts the FAILING direction first and
 * hardest. A secret-scanner that cannot be shown to fail has not been
 * shown to work.
 *
 * The end-to-end cases run the real script, as a real process, against
 * a real throwaway git repository -- not a mocked `git grep`. The dead
 * scan would have passed any test that stubbed the shell out, since the
 * defect WAS the shell.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  findSecrets,
  runSelfTest,
} from "../../scripts/ci/scan-for-committed-secrets.mjs";

const SCRIPT = fileURLToPath(
  new URL("../../scripts/ci/scan-for-committed-secrets.mjs", import.meta.url),
);

let repo: string;

function git(args: string[]): void {
  execFileSync("git", args, { cwd: repo, stdio: "pipe" });
}

function runScanIn(directory: string): { status: number; output: string } {
  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd: directory,
    encoding: "utf8",
  });

  return {
    status: result.status ?? -1,
    output: `${result.stdout}\n${result.stderr}`,
  };
}

/**
 * Secret-shaped strings are assembled from parts throughout this file,
 * so that the suite proving the scanner works does not itself become
 * the thing the scanner flags.
 */
const SYNTHETIC = {
  serviceRoleJwt: "eyJ" + "hbGciOiJIUzI1NiJ9" + "cmVhbC1zZXJ2aWNlLXJvbGUta2V5",
  dbPassword: "SUPABASE_DB_" + "PASSWORD=" + "aRealProductionPassword",
  pgUrl:
    "postgres" + "://postgres:" + "aRealProductionPassword" + "@db.example:5432/postgres",
  resendKey: "re_" + "Zk3".repeat(8),
  // The two genuinely-safe lines the scan must NOT flag.
  localDemoJwt: "eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6YW5vbiJ9",
  localPgUrl: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  processEnvAssignment:
    "process.env.SUPABASE_SERVICE_ROLE_KEY = LOCAL_SERVICE_ROLE_KEY;",
};

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "snowkap-secret-scan-"));
  git(["init", "--quiet"]);
  git(["config", "user.email", "test@example.invalid"]);
  git(["config", "user.name", "Scan Test"]);
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

function commit(name: string, contents: string): void {
  writeFileSync(join(repo, name), contents, "utf8");
  git(["add", name]);
  git(["commit", "--quiet", "-m", name]);
}

describe("committed-secret scan: the failing direction", () => {
  it(
    "exits non-zero on a committed service-role JWT -- the case the previous " +
      "scan reported clean on every run for six days",
    () => {
      commit("leaked-key.ts", `const key = "${SYNTHETIC.serviceRoleJwt}";\n`);

      const { status, output } = runScanIn(repo);

      expect(status).toBe(1);
      expect(output).toContain("leaked-key.ts");
      expect(output).toContain("[jwt]");
    },
  );

  it(
    "exits non-zero on a dotenv-style SUPABASE_DB_PASSWORD -- the exact case " +
      "the P14 audit claimed had been 'verified in both directions' against a " +
      "filter that was never committed, and which NEITHER job could catch",
    () => {
      commit("leaked.env.md", `${SYNTHETIC.dbPassword}\n`);

      const { status, output } = runScanIn(repo);

      expect(status).toBe(1);
      expect(output).toContain("leaked.env.md");
      expect(output).toContain("[supabase-env-assignment]");
    },
  );

  it("exits non-zero on a postgres:// URL carrying a real password", () => {
    commit("deploy-notes.md", `psql ${SYNTHETIC.pgUrl}\n`);

    const { status, output } = runScanIn(repo);

    expect(status).toBe(1);
    expect(output).toContain("deploy-notes.md");
    expect(output).toContain("[postgres-url]");
  });

  it("exits non-zero on a Resend API key", () => {
    commit("mailer.ts", `const resend = "${SYNTHETIC.resendKey}";\n`);

    const { status, output } = runScanIn(repo);

    expect(status).toBe(1);
    expect(output).toContain("[resend]");
  });
});

describe("committed-secret scan: the passing direction", () => {
  it("exits zero on a repository containing only approved fixtures", () => {
    const clean = mkdtempSync(join(tmpdir(), "snowkap-secret-scan-clean-"));

    execFileSync("git", ["init", "--quiet"], { cwd: clean });
    execFileSync("git", ["config", "user.email", "t@example.invalid"], {
      cwd: clean,
    });
    execFileSync("git", ["config", "user.name", "T"], { cwd: clean });

    writeFileSync(
      join(clean, "fixtures.ts"),
      [
        `const anon = "${SYNTHETIC.localDemoJwt}";`,
        `// ${SYNTHETIC.localPgUrl}`,
        SYNTHETIC.processEnvAssignment,
      ].join("\n"),
      "utf8",
    );
    execFileSync("git", ["add", "."], { cwd: clean });
    execFileSync("git", ["commit", "--quiet", "-m", "fixtures"], { cwd: clean });

    const { status, output } = runScanIn(clean);

    expect(output).toContain("Self-test passed");
    expect(output).toContain("No secret-shaped literals found");
    expect(status).toBe(0);

    rmSync(clean, { recursive: true, force: true });
  });

  it("exits zero on this repository at HEAD -- B4: the candidate must pass its own gate", () => {
    const { status, output } = runScanIn(process.cwd());

    expect(output).toContain("No secret-shaped literals found");
    expect(status).toBe(0);
  });
});

describe("committed-secret scan: it cannot silently succeed", () => {
  it("passes its own self-test, and says so in the output", () => {
    expect(runSelfTest()).toEqual([]);
  });

  it(
    "reports a pattern that has stopped detecting its own example, rather " +
      "than reporting a clean scan",
    () => {
      // Simulates the class of edit that broke the old scan: the
      // configuration changes and the scan keeps reporting success.
      const brokenShapes = [
        {
          name: "jwt",
          description: "a JWT-shaped token",
          pattern: /this-will-never-match/,
          example: SYNTHETIC.serviceRoleJwt,
        },
      ];

      const failures = brokenShapes
        .filter((shape) => !shape.pattern.test(shape.example))
        .map((shape) => shape.name);

      expect(failures).toEqual(["jwt"]);
    },
  );

  it("treats a git failure as a broken scan, never as 'no secrets found'", () => {
    // A directory that is not a git repository: `git grep` exits 128.
    // The old shell version's `|| true` turned exactly this into a
    // clean report.
    const notARepo = mkdtempSync(join(tmpdir(), "snowkap-not-a-repo-"));

    const { status, output } = runScanIn(notARepo);

    expect(status).not.toBe(0);
    expect(output).not.toContain("No secret-shaped literals found");

    rmSync(notARepo, { recursive: true, force: true });
  });
});

describe("committed-secret scan: the allow-list stays narrow", () => {
  it("does not filter a real credential that shares a known-safe prefix", () => {
    // B4's synthetic JWT is allow-listed as a COMPLETE literal. A real
    // token sharing the standard {"alg":"HS256","typ":"JWT"} header must
    // still be caught.
    const realTokenSameHeader =
      "src/x.ts:1:" +
      "eyJ" +
      "hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
      ".eyJ" +
      "zdWIiOiIxMjM0NTY3ODkwIn0" +
      ".dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk";

    expect(findSecrets([realTokenSameHeader])).toHaveLength(1);
  });

  it("does not filter an assignment from a string literal", () => {
    // The process.env rule exempts assignment from an identifier only.
    const leak =
      'src/x.ts:1:process.env.SUPABASE_SERVICE_ROLE_KEY = "' +
      SYNTHETIC.serviceRoleJwt +
      '";';

    expect(findSecrets([leak])).toHaveLength(1);
  });

  it("does filter the two real process.env lines it exists for", () => {
    const safe =
      "tests/integration/calculation-reproduction.test.ts:274:      " +
      SYNTHETIC.processEnvAssignment;

    expect(findSecrets([safe])).toEqual([]);
  });

  it("does not filter a different database password on the allow-listed line shape", () => {
    const leak = `docs/runbooks/x.md:1:${SYNTHETIC.dbPassword}`;

    expect(findSecrets([leak])).toHaveLength(1);
  });
});

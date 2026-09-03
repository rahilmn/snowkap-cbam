#!/usr/bin/env node

/**
 * Refuses to let a deployable artifact carry the E2E rate-limit bypass.
 *
 * 2026-09-03 (P14). The invariant this enforces:
 *
 *   A test run must never leave a production-deployable artifact
 *   containing the E2E rate-limit bypass.
 *
 * next.config.ts already makes that structurally true by sending a
 * bypass build to a different directory (scripts/build/dist-dir.mjs).
 * This script is the gate that proves it stayed true -- because the
 * structural guarantee rests on one environment-variable name matching
 * in three files, and a rename would silently return every build to
 * `.next` while every existing test kept passing.
 *
 * It always checks the CONSTANT deployable directory, never the
 * env-resolved one. Two reasons, both deliberate:
 *
 *   - During an E2E build the resolved directory is `.next-e2e`, which
 *     is SUPPOSED to carry the bypass. Checking it would fail the
 *     harness for doing its job.
 *   - A `.next` left contaminated by a pre-fix run must still be
 *     caught. Checking the resolved directory would skip right past it.
 *
 * Three independent checks, because each catches something the others
 * miss:
 *
 *   1. server.js carries the build-time key, and it is not "true".
 *      Asserting PRESENCE as well as value matters: if the key vanished
 *      entirely, the build-time half of the two-key guard would have
 *      been deleted and every check for the string "true" would pass
 *      vacuously.
 *
 *   2. required-server-files.json says the same thing. It ships in the
 *      image too, and it serializes differently from server.js --
 *      compact `":""` in one, pretty `": ""` in the other -- so a
 *      single substring test would silently only ever examine one.
 *
 *   3. No file anywhere in the standalone tree mentions either bypass
 *      token. This is the strongest check and the one that actually
 *      discriminates: when the build-time conjunct folds to false, the
 *      bundler dead-code-eliminates the whole `&&` chain including the
 *      runtime lookup, so a clean tree contains the tokens ZERO times.
 *      When it folds true, the runtime read survives verbatim as a
 *      property key no minifier can rename.
 *
 *      `.map` files are skipped, and must be: rate-limiter.ts's own
 *      source contains both tokens in its comments and its code, so a
 *      shipped source map would false-positive on a perfectly clean
 *      build.
 *
 * Pass --require-artifact where the artifact must exist (the Docker
 * build stage, CI after a build step). Without it, a missing directory
 * is reported and tolerated -- which is correct for `postbuild` during
 * an E2E build, where `.next` legitimately may not exist at all.
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
} from "node:fs";

import {
  join,
} from "node:path";

import {
  PRODUCTION_DIST_DIR,
} from "./dist-dir.mjs";

const BUILD_TIME_KEY =
  "E2E_RATE_LIMIT_BYPASS_BUILD";

const RUNTIME_KEY =
  "DANGEROUSLY_DISABLE_RATE_LIMITS_FOR_E2E_TESTS";

const SOURCE_KEY =
  "NEXT_PUBLIC_E2E_RATE_LIMIT_BYPASS_BUILD";

const requireArtifact =
  process.argv.includes("--require-artifact");

const STANDALONE_DIR =
  `${PRODUCTION_DIST_DIR}/standalone`;

const SERVER_JS =
  `${STANDALONE_DIR}/server.js`;

const REQUIRED_SERVER_FILES =
  `${STANDALONE_DIR}/${PRODUCTION_DIST_DIR}/required-server-files.json`;

const failures =
  [];

function fail(
  message,
) {
  failures.push(message);
}

if (!existsSync(STANDALONE_DIR)) {
  if (requireArtifact) {
    fail(
      `${STANDALONE_DIR} does not exist, but --require-artifact was passed. ` +
        "A build that produced nothing deployable must not pass this gate.",
    );
  } else {
    console.log(
      `[assert-clean-production-artifact] ${STANDALONE_DIR} absent -- nothing to check.`,
    );
  }
} else {
  // --- 1. the inlined build-time flag in server.js --------------------
  if (!existsSync(SERVER_JS)) {
    fail(
      `${SERVER_JS} is missing.`,
    );
  } else {
    const serverJs =
      readFileSync(SERVER_JS, "utf8");

    if (!new RegExp(`"${BUILD_TIME_KEY}"\\s*:`).test(serverJs)) {
      fail(
        `${SERVER_JS} contains no "${BUILD_TIME_KEY}" key at all -- the ` +
          "build-time half of the two-key rate-limit guard appears to have " +
          "been removed from next.config.ts's env block.",
      );
    }

    if (new RegExp(`"${BUILD_TIME_KEY}"\\s*:\\s*"true"`).test(serverJs)) {
      fail(
        `${SERVER_JS} carries ${BUILD_TIME_KEY}="true".`,
      );
    }
  }

  // --- 2. the same fact, in the file the image also ships -------------
  if (!existsSync(REQUIRED_SERVER_FILES)) {
    fail(
      `${REQUIRED_SERVER_FILES} is missing.`,
    );
  } else {
    let parsed;

    try {
      parsed =
        JSON.parse(
          readFileSync(REQUIRED_SERVER_FILES, "utf8"),
        );
    } catch (error) {
      fail(
        `${REQUIRED_SERVER_FILES} is not valid JSON: ${String(error)}`,
      );
    }

    if (parsed) {
      const value =
        parsed.config?.env?.[BUILD_TIME_KEY];

      if (value === undefined) {
        fail(
          `${REQUIRED_SERVER_FILES}: config.env.${BUILD_TIME_KEY} is absent -- ` +
            "the build-time control appears to have been removed.",
        );
      } else if (value !== "") {
        fail(
          `${REQUIRED_SERVER_FILES}: config.env.${BUILD_TIME_KEY} is ` +
            `${JSON.stringify(value)}, expected "".`,
        );
      }
    }
  }

  // --- 3. no bypass token anywhere in the shipped tree -----------------
  const walk =
    (dir) => {
      for (
        const entry of readdirSync(dir, { withFileTypes: true })
      ) {
        const path =
          join(dir, entry.name);

        if (entry.isDirectory()) {
          walk(path);
          continue;
        }

        // Source maps legitimately contain both tokens, because
        // rate-limiter.ts's own text does.
        if (!entry.isFile() || path.endsWith(".map")) {
          continue;
        }

        let contents;

        try {
          contents =
            readFileSync(path, "utf8");
        } catch {
          continue;
        }

        if (contents.includes(RUNTIME_KEY) || contents.includes(SOURCE_KEY)) {
          fail(
            `${path} contains a rate-limit bypass token -- this build was ` +
              "made with the E2E bypass enabled.",
          );
        }
      }
    };

  walk(STANDALONE_DIR);
}

if (failures.length > 0) {
  console.error(
    "\nE2E RATE-LIMIT BYPASS CHECK FAILED\n",
  );

  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }

  console.error(
    `\nA deployable artifact must never carry the E2E rate-limit bypass.` +
      `\nIf this is a stale ${PRODUCTION_DIST_DIR} left by a pre-fix ` +
      `"pnpm test:e2e" run, delete it and rebuild:` +
      `\n\n  rm -rf ${PRODUCTION_DIST_DIR} && pnpm build\n`,
  );

  process.exit(1);
}

console.log(
  `[assert-clean-production-artifact] OK -- ${STANDALONE_DIR} carries no ` +
    "E2E rate-limit bypass.",
);

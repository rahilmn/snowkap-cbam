#!/usr/bin/env node
// Next.js's `output: "standalone"` (next.config.ts) produces a minimal
// .next/standalone/ folder with its own server.js and a pruned
// node_modules, but deliberately does NOT include .next/static/ or
// public/ -- those have to be copied in separately (this is Next's own
// documented pattern; see the warning `next start` prints against a
// standalone build). Cross-platform (fs.cpSync) rather than a
// POSIX `cp -r` in a package.json script, so this runs the same in a
// Windows dev shell and in the Linux Docker build.
import {
  cpSync,
  existsSync,
  readdirSync,
  rmSync,
} from "node:fs";

import {
  resolveDistDir,
} from "./dist-dir.mjs";

// 2026-09-03 (P14). Resolved, not hardcoded: a build carrying the E2E
// rate-limit bypass writes .next-e2e (see dist-dir.mjs).
//
// BOTH paths below depend on it, and that is easy to get wrong. Next
// names the INNER directory of the standalone tree after distDir too --
// the emitted server.js resolves its assets at
// <distDir>/standalone/<distDir>/static. Parameterising only the outer
// directory would leave every chunk, stylesheet and font 404ing under
// the E2E server, which surfaces as an unstyled, non-hydrating page and
// reads like flake rather than a build error.
const DIST_DIR =
  resolveDistDir();

const STANDALONE_DIR =
  `${DIST_DIR}/standalone`;

if (!existsSync(STANDALONE_DIR)) {
  throw new Error(
    `${STANDALONE_DIR} does not exist -- run "next build" first.`,
  );
}

cpSync(
  `${DIST_DIR}/static`,
  `${STANDALONE_DIR}/${DIST_DIR}/static`,
  { recursive: true },
);

if (existsSync("public")) {
  cpSync(
    "public",
    `${STANDALONE_DIR}/public`,
    { recursive: true },
  );
}

// ------------------------------------------------------------------
// 2026-09-03 (P14 remediation). Strip any env file Next traced into the
// deployable tree.
//
// `output: "standalone"` copies the project's `.env` into
// `<distDir>/standalone/.env`. On a developer machine that file holds
// the HOSTED project's URL and service-role key -- the setup docs say
// to put them there -- so `pnpm build` was producing a deployable
// directory containing a live production credential, and a scan of the
// artifact found exactly that.
//
// The production IMAGE was never affected: `.dockerignore` excludes
// `.env` and `.env.*`, and the Docker build runs `pnpm build` inside
// the image from a context that has neither. So this is a local
// hygiene defect, not a shipped one -- but "the artifact is only
// dangerous on the machines we trust" is not a property worth
// depending on, and the file is useless in the artifact anyway:
// production takes its configuration from platform environment
// variables, never from a copied file.
//
// Deleted rather than warned about, and asserted absent afterwards by
// assert-clean-production-artifact.mjs. The same reasoning as the E2E
// rate-limit bypass check that runs beside it: an artifact that must
// not contain something is a thing to enforce, not to document.
const strippedEnvFiles =
  readdirSync(STANDALONE_DIR)
    .filter(
      (entry) => entry === ".env" || entry.startsWith(".env."),
    );

for (const entry of strippedEnvFiles) {
  rmSync(
    `${STANDALONE_DIR}/${entry}`,
    { force: true },
  );
}

console.log(
  `Copied ${DIST_DIR}/static (and public/, if present) into ` +
    STANDALONE_DIR,
);

if (strippedEnvFiles.length > 0) {
  console.log(
    `Stripped ${strippedEnvFiles.length} env file(s) Next traced into ` +
      `${STANDALONE_DIR}: ${strippedEnvFiles.join(", ")} -- a deployable ` +
      "artifact must never carry credentials.",
  );
}

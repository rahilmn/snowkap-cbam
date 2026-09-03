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

console.log(
  `Copied ${DIST_DIR}/static (and public/, if present) into ` +
    STANDALONE_DIR,
);

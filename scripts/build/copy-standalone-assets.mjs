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

const STANDALONE_DIR =
  ".next/standalone";

if (!existsSync(STANDALONE_DIR)) {
  throw new Error(
    `${STANDALONE_DIR} does not exist -- run "next build" first.`,
  );
}

cpSync(
  ".next/static",
  `${STANDALONE_DIR}/.next/static`,
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
  "Copied .next/static (and public/, if present) into " +
    STANDALONE_DIR,
);

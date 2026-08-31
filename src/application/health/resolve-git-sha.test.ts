import {
  describe,
  expect,
  it,
} from "vitest";

import {
  resolveGitSha,
} from "./resolve-git-sha";

// 2026-08-31: written RED-first, from a real production observation.
//
// After the owner set GIT_SHA=${{RAILWAY_GIT_COMMIT_SHA}} in Railway,
// the live /api/health began reporting git_sha: "" -- an EMPTY string
// rather than the previous "unknown" fallback. That is diagnostic: the
// variable is now SET but resolving empty, and `process.env.GIT_SHA ??
// "unknown"` does not catch an empty string (?? only guards null and
// undefined). So the deployment reported an empty provenance string
// instead of either a real SHA or an honest "unknown".

describe(
  "resolveGitSha",
  () => {
    it(
      "returns GIT_SHA when it is a real value",
      () => {
        expect(
          resolveGitSha(
            { GIT_SHA: "9a5c301ba04b8eded21248ab77903d47e177707b" },
          ),
        ).toBe(
          "9a5c301ba04b8eded21248ab77903d47e177707b",
        );
      },
    );

    it(
      "treats an EMPTY GIT_SHA as unset rather than reporting an empty provenance string",
      () => {
        // The exact production symptom this helper exists for.
        expect(
          resolveGitSha(
            { GIT_SHA: "" },
          ),
        ).toBe("dev");
      },
    );

    it(
      "treats a whitespace-only GIT_SHA as unset",
      () => {
        expect(
          resolveGitSha(
            { GIT_SHA: "   " },
          ),
        ).toBe("dev");
      },
    );

    it(
      "falls back to RAILWAY_GIT_COMMIT_SHA, which Railway injects at runtime, when GIT_SHA is empty",
      () => {
        // The robust path: even if the GIT_SHA build-arg plumbing does
        // not deliver a value into the image, Railway still provides
        // RAILWAY_GIT_COMMIT_SHA in the running container -- so
        // deployment provenance works without depending on build args
        // resolving correctly.
        expect(
          resolveGitSha(
            {
              GIT_SHA: "",
              RAILWAY_GIT_COMMIT_SHA: "abc1234def5678",
            },
          ),
        ).toBe("abc1234def5678");
      },
    );

    it(
      "prefers an explicitly-set GIT_SHA over RAILWAY_GIT_COMMIT_SHA",
      () => {
        expect(
          resolveGitSha(
            {
              GIT_SHA: "explicit",
              RAILWAY_GIT_COMMIT_SHA: "railway",
            },
          ),
        ).toBe("explicit");
      },
    );

    it(
      "returns the caller's fallback when neither is set, never an empty string",
      () => {
        expect(
          resolveGitSha(
            {},
          ),
        ).toBe("dev");

        // ...and an explicit fallback is honoured.
        expect(
          resolveGitSha(
            {},
            "unknown",
          ),
        ).toBe("unknown");
      },
    );

    it(
      "trims a value that arrived with surrounding whitespace",
      () => {
        expect(
          resolveGitSha(
            { GIT_SHA: "  9a5c301  " },
          ),
        ).toBe("9a5c301");
      },
    );
  },
);

import type {
  NextConfig,
} from "next";

const nextConfig: NextConfig = {
  // Standalone output is what the Dockerfile (see repo root) copies into
  // the production image -- a minimal, self-contained server bundle
  // that doesn't need the full node_modules tree at runtime.
  output: "standalone",

  // GIT_SHA is baked in at build time (see Dockerfile) and surfaced on
  // the System/status screen and in structured logs for deployment
  // visibility (docs/plans/MASTER_PLAN.md §32).
  env: {
    NEXT_PUBLIC_GIT_SHA:
      process.env.GIT_SHA ??
      "dev",
  },
};

export default nextConfig;

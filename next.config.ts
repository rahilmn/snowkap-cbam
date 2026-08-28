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

  // Supabase's local Auth config (supabase/config.toml's site_url) uses
  // 127.0.0.1, not localhost -- browsing the dev server via 127.0.0.1
  // is therefore required for Auth email-link redirects (invite,
  // password reset, etc.) to land on an origin GoTrue's redirect
  // allowlist actually accepts. Without this, Next's dev-only
  // cross-origin protection silently blocks HMR and static chunk
  // requests from that origin, breaking client hydration everywhere
  // (not just on Auth screens) -- this is dev-only and has no
  // production effect (output: "standalone" never reads this).
  allowedDevOrigins: [
    "127.0.0.1",
  ],
};

export default nextConfig;

import type {
  NextConfig,
} from "next";

import {
  isE2eBypassBuild,
  resolveDistDir,
} from "./scripts/build/dist-dir.mjs";

/**
 * 2026-09-03 (P14). Whether this build carries the E2E rate-limit
 * bypass, decided ONCE and used twice below -- for `distDir` and for
 * the `env` block's inlined flag.
 *
 * Deliberately one const rather than two copies of the same
 * expression: two expressions that agree today are exactly how this
 * drifts into a build that writes the deployable directory while
 * carrying the bypass. See scripts/build/dist-dir.mjs, which also
 * explains why the variable read here is the NEXT_PUBLIC_ one and not
 * the key emitted below.
 */
const builtWithE2eRateLimitBypass =
  isE2eBypassBuild();

const isProduction =
  process.env.NODE_ENV === "production";

/**
 * 2026-08-29 (P13 adversarial security audit, finding #1, confirmed
 * live): no security response headers were emitted anywhere -- no
 * `headers()` here, no header-setting in proxy.ts, and no reverse-proxy
 * layer in front of the bare `node server.js` production run stage
 * (see railway.json / Dockerfile). `curl -D -` against any route
 * returned none of CSP, X-Frame-Options, Strict-Transport-Security,
 * X-Content-Type-Options, or Referrer-Policy. docs/plans/MASTER_PLAN.md
 * §38 item 21 ("CSP baseline headers") was a P2 deliverable that never
 * actually got built.
 *
 * `headers()` (this file) is the idiomatic Next.js mechanism for this
 * and applies to every route matched below, including static assets
 * and app/api/** route handlers -- a custom proxy.ts header-setting
 * layer is unnecessary here (proxy.ts's own job is session-cookie
 * refresh, not response headers) and was deliberately not introduced.
 *
 * ## Content-Security-Policy reasoning
 *
 * `script-src 'self' 'unsafe-inline'` (plus 'unsafe-eval' outside
 * production): this is *not* a placeholder -- it was arrived at after
 * checking what a real rendered page actually emits. Confirmed live
 * (`curl http://127.0.0.1:3000/sign-in`, `pnpm dev`): besides this
 * app's own external chunk <script src> tags, the page also carries
 * several inline, src-less <script> tags that Next.js's own App Router
 * runtime injects and controls -- a `self.__next_r=...` bootstrap tag
 * and one-or-more `self.__next_f.push([...])` tags carrying the
 * streamed RSC payload. That payload differs on every request (it's
 * the actual page data), so it cannot be pinned by a static SHA-256
 * hash the way this file's own single static inline script
 * (app/layout.tsx's THEME_INIT_SCRIPT, a fixed string) could be.
 * A nonce-based CSP (Next's documented alternative to 'unsafe-inline')
 * would cover Next's own inline scripts correctly, but it requires
 * generating a fresh nonce per request in proxy.ts and forcing every
 * route into dynamic rendering (nonces are only injected during SSR;
 * statically-generated pages never see one) -- a real app-wide
 * rendering/performance behavior change, out of proportion for a
 * header-hardening fix and explicitly out of scope for this change.
 * Mixing a hash for just the theme-init script with 'unsafe-inline' as
 * a fallback does not help either: per the CSP spec, any browser new
 * enough to support hash-sources also *ignores* 'unsafe-inline' the
 * moment a hash-source is present on the same directive -- so adding a
 * hash would silently break Next's own (unhashed) inline scripts on
 * every modern browser while doing nothing for older ones. Given that,
 * 'unsafe-inline' for script-src is the genuine, considered choice
 * here -- not an oversight -- matching Next's own documented "Without
 * Nonces" CSP pattern (node_modules/next/dist/docs/01-app/02-guides/
 * content-security-policy.md). 'unsafe-eval' is additionally required
 * in development only, because React's dev-mode error-stack
 * reconstruction uses `eval` (also per that same doc); it is dropped
 * in production, where neither React nor Next.js use it.
 *
 * `style-src 'self' 'unsafe-inline'`: components/ui/regulatory-status-
 * badge.tsx (the shared status-dot/badge component used across the
 * app) sets a per-instance `style={{ color, backgroundColor }}` inline
 * style attribute from data-driven tone colors. Nonces only attach to
 * <style>/<script> *tags* Next.js itself generates, never to a plain
 * `style=""` attribute on an arbitrary element, and the values here are
 * dynamic (data-driven), so hash-pinning isn't practical either --
 * 'unsafe-inline' is genuinely required for style-src too.
 *
 * `connect-src`: differs between dev and production, the same
 * NODE_ENV-conditioned pattern this codebase already uses for the
 * Supabase cookie `secure` flag (see src/infrastructure/supabase/
 * server-client.ts). Locally (`pnpm dev`, per .env.local) the app talks
 * to local Supabase at http://127.0.0.1:54321 (confirmed against the
 * running dev server); in production it talks to a real hosted
 * `https://<project-ref>.supabase.co` per NEXT_PUBLIC_SUPABASE_URL
 * (see .env.example) -- allowed via a `https://*.supabase.co` wildcard
 * rather than one hardcoded project ref, so this doesn't silently break
 * if the Supabase project ever changes.
 *
 * `img-src 'self' data: blob:`: `data:` and `blob:` are the standard
 * safe allowances for locally-generated image/content URIs (this app's
 * own client-side CSV export flow -- components/reporting/export-
 * period-csv-button.tsx, components/audit/export-audit-csv-button.tsx
 * -- already uses `URL.createObjectURL` for downloads).
 *
 * `font-src 'self'` only: both fonts (Inter, JetBrains Mono) are
 * self-hosted via next/font/google, which Next.js downloads and serves
 * from this app's own origin at build time -- confirmed live (the
 * `Link: rel=preload ... /_next/static/media/*.woff2` header on a real
 * response); no request to fonts.gstatic.com is ever made, so no
 * external font host needs to be allowed.
 *
 * `frame-ancestors 'none'` is set alongside the separate
 * X-Frame-Options: DENY header below (belt-and-suspenders -- CSP's
 * frame-ancestors is the modern replacement per MDN/Next's own docs,
 * X-Frame-Options covers older browsers that don't honor it).
 *
 * `upgrade-insecure-requests` is production-only, matching Strict-
 * Transport-Security below (meaningless, and potentially confusing in
 * a screenshot of dev headers, over plain http://localhost dev).
 */
const contentSecurityPolicy =
  [
    "default-src 'self'",

    `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,

    "style-src 'self' 'unsafe-inline'",

    "img-src 'self' data: blob:",

    "font-src 'self'",

    `connect-src 'self' ${
      isProduction
        ? "https://*.supabase.co"
        : "http://127.0.0.1:54321"
    }`,

    "object-src 'none'",

    "base-uri 'self'",

    "form-action 'self'",

    "frame-ancestors 'none'",

    ...(isProduction ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

/**
 * Applied to every route (including app/api/** and static assets --
 * there is no reason to exempt either; static assets in particular
 * benefit from X-Content-Type-Options just as much as HTML documents).
 */
const securityHeaders = [
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },

  // Superseded by CSP's frame-ancestors above for modern browsers, but
  // kept for older ones that don't parse frame-ancestors -- "both is
  // fine" per Next's own headers.md guidance.
  {
    key: "X-Frame-Options",
    value: "DENY",
  },

  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },

  // Production-only: Strict-Transport-Security is meaningless (and
  // simply ignored by browsers) over the plain http://localhost `pnpm
  // dev` runs on, and Railway (this app's deploy target -- see
  // railway.json) terminates TLS at its edge in front of the bare
  // `node server.js` run stage, so the app itself never receives a
  // "was this HTTPS" signal to condition on -- NODE_ENV is what's
  // actually reliable here, matching every other secure/production
  // conditional in this codebase.
  ...(isProduction
    ? [
      {
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains",
      },
    ]
    : []),

  {
    key: "Content-Security-Policy",
    value: contentSecurityPolicy,
  },
];

const nextConfig: NextConfig = {
  // 2026-08-29 (P13 audit finding #1): stop advertising the framework
  // via X-Powered-By -- a minor information-disclosure hardening, one
  // line, unrelated to the headers() mechanism below.
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },

  // Standalone output is what the Dockerfile (see repo root) copies into
  // the production image -- a minimal, self-contained server bundle
  // that doesn't need the full node_modules tree at runtime.
  output: "standalone",

  // 2026-09-03 (P14). A build carrying the E2E rate-limit bypass writes
  // .next-e2e, which is never deployed and which the Dockerfile does
  // not copy -- so a test run cannot leave a bypass-carrying artifact
  // in the deployable directory. See scripts/build/dist-dir.mjs for the
  // full reasoning, including the fail-closed property this gives the
  // Dockerfile's hardcoded COPY.
  distDir: resolveDistDir(),

  // GIT_SHA is baked in at build time (see Dockerfile) and surfaced on
  // the System/status screen and in structured logs for deployment
  // visibility (docs/plans/MASTER_PLAN.md §32).
  env: {
    // Mirrors src/application/health/resolve-git-sha.ts, inlined
    // because this config is loaded outside the app's module graph. Same
    // two fixes as that helper: an EMPTY GIT_SHA is treated as unset
    // (`??` guards only null/undefined, so a set-but-empty Railway
    // variable previously produced an empty provenance string), and
    // RAILWAY_GIT_COMMIT_SHA is used as a fallback.
    //
    // Note this value is baked at BUILD time. If neither variable is
    // available to the builder, this stays "dev" while the SERVER-side
    // /api/health still reports the real SHA at runtime -- the health
    // endpoint, not this client-visible constant, is the authoritative
    // deployment-provenance signal.
    NEXT_PUBLIC_GIT_SHA:
      process.env.GIT_SHA?.trim() ||
      process.env.RAILWAY_GIT_COMMIT_SHA?.trim() ||
      "dev",

    // 2026-08-31 (P13 final round). The E2E rate-limit bypass in
    // src/infrastructure/rate-limit/rate-limiter.ts must be impossible
    // to switch on at RUNTIME, or a single stray environment variable on
    // the production service disables rate limiting across every auth,
    // invitation and upload endpoint at once.
    //
    // This `env` block is Next's documented BUILD-TIME inlining
    // mechanism (the same one NEXT_PUBLIC_GIT_SHA above relies on): the
    // value is substituted into the bundle as a literal when the image
    // is built. A production build, which never has the source variable
    // set, therefore bakes in "" -- and no runtime variable can change
    // an already-compiled literal.
    //
    // Verified by inspecting the emitted chunk, not assumed: a plain
    // `NEXT_PUBLIC_`-prefixed read was tried FIRST and Turbopack left it
    // as a live `process.env` lookup in the server bundle, which would
    // have given exactly the false confidence this is meant to remove.
    E2E_RATE_LIMIT_BYPASS_BUILD:
      builtWithE2eRateLimitBypass
        ? "true"
        : "",
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

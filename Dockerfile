# syntax=docker/dockerfile:1

# Multi-stage build producing a minimal production image around
# Next.js's standalone output (next.config.ts: output: "standalone").
# See docs/plans/MASTER_PLAN.md §29 ("Railway"): pinned Node LTS,
# corepack-pinned pnpm, non-root user, standalone output.

ARG NODE_VERSION=22

# ---- deps: install dependencies with a frozen lockfile -------------------
FROM node:${NODE_VERSION}-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---- build: typecheck + build the app -------------------------------------
FROM node:${NODE_VERSION}-slim AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# GIT_SHA is passed as a build arg (set by the Railway/CI deploy step from
# the actual commit SHA) and baked into the image for deployment
# visibility (docs/plans/MASTER_PLAN.md §32) -- see next.config.ts, which
# surfaces it as NEXT_PUBLIC_GIT_SHA, and the /api/health route.
ARG GIT_SHA=unknown
ENV GIT_SHA=${GIT_SHA}
RUN pnpm build

# ---- run: minimal runtime image --------------------------------------------
FROM node:${NODE_VERSION}-slim AS run
WORKDIR /app
ENV NODE_ENV=production
ARG GIT_SHA=unknown
ENV GIT_SHA=${GIT_SHA}

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

# Standalone output already contains its own pruned node_modules and
# server.js; .next/static and public/ are copied in separately by
# scripts/build/copy-standalone-assets.mjs (run as part of `pnpm build`
# via the postbuild script), matching Next's documented standalone
# deployment pattern.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Railway's healthcheck hits /api/health (see railway.json and
# app/api/health/route.ts) -- not duplicated here as a Docker HEALTHCHECK
# to avoid two different health-check mechanisms disagreeing.
CMD ["node", "server.js"]

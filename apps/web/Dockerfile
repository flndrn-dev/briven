# syntax=docker/dockerfile:1.7
# Base = node:22-slim (Debian glibc), matching supabase/apps/studio/Dockerfile.
# Why not alpine: apps/studio depends on libpg-query@15.2.0, which (a) only has
# pre-built binaries for glibc-linux-x64 on supabase's S3 bucket (musl 404s),
# and (b) when source-compiled, runs script/buildAddon.sh which requires bash
# (alpine ships only busybox sh). Debian gives us glibc prebuilds AND bash.
FROM node:22-slim AS base
RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends \
      git python3 ca-certificates build-essential && \
    rm -rf /var/lib/apt/lists/* && \
    update-ca-certificates
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

FROM base AS build
WORKDIR /repo
# next.config.ts bakes the api-rewrite destination at build time, so the
# env var MUST be set here (not only at container runtime). For production
# it's always api.briven.tech; override at docker-build time if staging.
ARG BRIVEN_API_ORIGIN=https://api.briven.tech
ENV BRIVEN_API_ORIGIN=${BRIVEN_API_ORIGIN}
COPY . .
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
# Bound build heap so a runaway build OOMs itself instead of swap-killing the host (kvm4 16GB).
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN pnpm --filter @briven/web... build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN groupadd -r app && useradd -r -g app app
COPY --from=build --chown=app:app /repo /app
USER app
EXPOSE 3000
WORKDIR /app/apps/web
CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]

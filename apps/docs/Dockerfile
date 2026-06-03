# syntax=docker/dockerfile:1.7
# Base = node:22-slim (Debian) — see apps/web/Dockerfile for the libpg-query
# alpine-vs-debian rationale.
FROM node:22-slim AS base
RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends \
      git python3 ca-certificates build-essential && \
    rm -rf /var/lib/apt/lists/* && \
    update-ca-certificates
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

FROM base AS build
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
# Bound build heap so a runaway build OOMs itself instead of swap-killing the host (kvm4 16GB).
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN pnpm --filter @briven/docs... build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3002
ENV HOSTNAME=0.0.0.0
RUN groupadd -r app && useradd -r -g app app
COPY --from=build --chown=app:app /repo /app
USER app
EXPOSE 3002
WORKDIR /app/apps/docs
CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "3002"]

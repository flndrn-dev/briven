# syntax=docker/dockerfile:1.7
# Base = oven/bun:1.3 (Debian by default; the `-alpine` tag we previously used
# is musl + busybox sh, which breaks libpg-query's native build chain — see
# apps/web/Dockerfile for the full rationale).
FROM oven/bun:1.3 AS base
RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends \
      git python3 ca-certificates build-essential nodejs npm && \
    rm -rf /var/lib/apt/lists/* && \
    update-ca-certificates
RUN npm install -g pnpm@9.12.0

FROM base AS build
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM oven/bun:1.3 AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV BRIVEN_API_PORT=3001
# MinIO client (mc) — services/minio-admin.ts shells out to it to create
# per-project buckets + scoped service-account keys. Arch-matched binary.
# Placed BEFORE the build-identity ARG/ENV block below: those args (BUILD_SHA/
# BUILD_AT) change on every commit and would otherwise bust the cache for this
# heavy download+chmod on every build. Keeping it here lands it in a stable
# cached layer that only re-runs when the base image changes.
RUN apt-get update -qq && apt-get install -y --no-install-recommends curl ca-certificates && \
    ARCH="$(dpkg --print-architecture)" && \
    curl -fsSL "https://dl.min.io/client/mc/release/linux-${ARCH}/mc" -o /usr/local/bin/mc && \
    chmod +x /usr/local/bin/mc && \
    rm -rf /var/lib/apt/lists/*
# Optional build-time identity. Compose can pass these via:
#   build:
#     context: ../..
#     dockerfile: apps/api/Dockerfile
#     args:
#       BRIVEN_BUILD_SHA: ${BRIVEN_BUILD_SHA}
#       BRIVEN_BUILD_AT:  ${BRIVEN_BUILD_AT}
# When unset, /info just reports "dev" — never 500s.
ARG BRIVEN_BUILD_SHA=dev
ARG BRIVEN_BUILD_AT=dev
ENV BRIVEN_BUILD_SHA=${BRIVEN_BUILD_SHA}
ENV BRIVEN_BUILD_AT=${BRIVEN_BUILD_AT}
RUN groupadd -r app && useradd -r -g app app
COPY --from=build --chown=app:app /repo /app
USER app
EXPOSE 3001
WORKDIR /app/apps/api
CMD ["sh", "/app/apps/api/scripts/start.sh"]

# syntax=docker/dockerfile:1.7
# Base = oven/bun:1.3 (Debian) — see apps/web/Dockerfile for the libpg-query
# alpine-vs-debian rationale.
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
ENV BRIVEN_REALTIME_PORT=3004
RUN groupadd -r app && useradd -r -g app app
COPY --from=build --chown=app:app /repo /app
USER app
EXPOSE 3004
WORKDIR /app/apps/realtime
CMD ["bun", "run", "src/index.ts"]

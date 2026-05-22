# syntax=docker/dockerfile:1.7
FROM oven/bun:1.3-alpine AS base
# python3/make/g++ — see apps/web/Dockerfile for why (libpg-query node-gyp fallback
# runs during repo-root pnpm install).
RUN apk add --no-cache libstdc++ nodejs npm python3 make g++
RUN npm install -g pnpm@9.12.0

FROM base AS build
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM oven/bun:1.3-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV BRIVEN_RUNTIME_PORT=3003
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /repo /app
USER app
EXPOSE 3003
WORKDIR /app/apps/runtime
CMD ["bun", "run", "src/index.ts"]

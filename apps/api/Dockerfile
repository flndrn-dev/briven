# syntax=docker/dockerfile:1.7
FROM oven/bun:1.3-alpine AS base
RUN apk add --no-cache libstdc++ nodejs npm
RUN npm install -g pnpm@9.12.0

FROM base AS build
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM oven/bun:1.3-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV BRIVEN_API_PORT=3001
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /repo /app
USER app
EXPOSE 3001
WORKDIR /app/apps/api
CMD ["bun", "run", "src/index.ts"]

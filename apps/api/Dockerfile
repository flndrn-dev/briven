# syntax=docker/dockerfile:1.7
# Build apps/api (Hono on Bun). Unlike the Next.js apps this runs on Bun
# directly — no Node runtime image, just oven/bun.

FROM oven/bun:1.3-alpine AS base
RUN apk add --no-cache libstdc++
RUN bun --version

# Pnpm is still the package manager at the monorepo root, so we need both.
# Bun itself can execute the installed node_modules/ without re-resolving.
RUN apk add --no-cache nodejs npm && \
    npm install -g pnpm@9.12.0

FROM base AS deps
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/docs/package.json ./apps/docs/
COPY apps/api/package.json ./apps/api/
COPY apps/runtime/package.json ./apps/runtime/
COPY apps/realtime/package.json ./apps/realtime/
COPY apps/studio/package.json ./apps/studio/
COPY packages/config/package.json ./packages/config/
COPY packages/shared/package.json ./packages/shared/
COPY packages/ui/package.json ./packages/ui/
COPY packages/schema/package.json ./packages/schema/
COPY packages/cli/package.json ./packages/cli/
COPY packages/client-react/package.json ./packages/client-react/
COPY packages/client-vanilla/package.json ./packages/client-vanilla/
COPY packages/client-svelte/package.json ./packages/client-svelte/
COPY packages/client-vue/package.json ./packages/client-vue/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV BRIVEN_API_PORT=3001
RUN addgroup -S app && adduser -S app -G app
COPY --from=deps --chown=app:app /repo /app
COPY --chown=app:app . /app
USER app
EXPOSE 3001
WORKDIR /app/apps/api
CMD ["bun", "run", "src/index.ts"]

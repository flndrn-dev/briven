# syntax=docker/dockerfile:1.7
# Build apps/docs (Next.js 16 + Fumadocs). Same pattern as apps/web; the
# docker layers differ only in the --filter target.

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

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

FROM base AS build
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps ./apps
COPY --from=deps /repo/packages ./packages
COPY . .
RUN pnpm --filter @briven/docs... build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3002
ENV HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /repo /app
USER app
EXPOSE 3002
WORKDIR /app/apps/docs
CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "3002"]

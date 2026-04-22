# @briven/api — control plane

Hono on Bun. The control plane for briven: accounts, projects, billing, auth, CLI sessions, env vars, audit logs. Customer data queries never hit this service.

## dev

```bash
# from the repo root
pnpm install
pnpm --filter @briven/api dev
```

requires **bun 1.1+**. the dev script uses `bun --hot` for live reload.

## endpoints (phase 0)

| path | description |
|------|-------------|
| `GET /` | liveness + service identity |
| `GET /health` | process alive |
| `GET /ready` | dependencies reachable (stubs until phase 1) |

phase 1 adds auth, projects, deployments, api-keys — see `docs/BUILD_PLAN.md` §Phase 1.

## env

see `src/env.ts` for the full schema. all vars carry the `BRIVEN_` prefix per `CLAUDE.md §4`.

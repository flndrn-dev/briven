# infra/dokploy

dokploy templates for self-hosting briven-core. phase 0 uses the shared dokploy vps; phase 1 (may 2026+) moves briven cloud to a dedicated kvm4. phase 2 splits control plane to kvm2 + data plane to kvm4.

**status: empty.** phase 0 ships compose manifests for:

- `api` (hono on bun)
- `web` (next.js 16)
- `postgres` (pg17 + pgvector + pg_cron + pgmq)
- `redis`
- `minio`
- `grafana` + `loki` + `prometheus`

and a public dokploy-catalogue submission for self-hosters. see `docs/BUILD_PLAN.md` §Phase 0 and §Phase 4.

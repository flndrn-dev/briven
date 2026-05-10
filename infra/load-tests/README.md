# load tests

synthetic load harnesses for the briven control + data planes. each script is a single-file bun program — no external deps, no compose, no ci wiring required to run them locally.

## available

### `realtime-subs.ts`

opens N concurrent websocket subscriptions against `apps/realtime`, reports first-frame latency p50/p99 + max + failure counts.

phase 2 target: **1,000 concurrent subs on KVM4 with p99 first-frame latency under 500ms and zero connection failures**.

```bash
# point at a running realtime service + project
export BRIVEN_RUNTIME_SHARED_SECRET=...
bun run infra/load-tests/realtime-subs.ts \
  --url ws://localhost:3004/v1/subscribe \
  --project p_01HZ... \
  --function poolStats \
  --subs 1000 \
  --duration 60
```

stdout reports a json summary on completion. exit code is non-zero if any connection failed — usable in ci.

**caveat:** the harness conveys the runtime shared secret via `?bearer=…` in the ws url because the browser-style `WebSocket` constructor doesn't accept headers. the realtime service treats this as a load-test-only auth path; the production sdk sends a real `Authorization` header during the upgrade.

## what to add next

- **deploy-flood.ts** — POST `/v1/projects/:id/deployments` at the tier rate-limit ceiling to validate `RATE_LIMITS_BY_TIER.deploy` works as advertised
- **invoke-flood.ts** — same, against `/v1/projects/:id/functions/:name`
- **schema-stress.ts** — generate a 100-table schema, time end-to-end deploy + apply

these are tracked under TODO §Phase 2 §C "operations & infra".

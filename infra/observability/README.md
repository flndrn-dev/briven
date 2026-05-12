# observability stack

phase 0 close-out — grafana + loki + prometheus + promtail on a single dokploy compose project. lives on the same docker network as `apps/api`, `apps/runtime`, `apps/realtime` so prometheus scrapes container names directly. grafana is exposed via traefik behind cloudflare access; everything else is internal-only.

## what's here

```
infra/observability/
├── compose.yml                                   # the stack
├── loki/config.yaml
├── promtail/config.yaml
├── prometheus/
│   ├── prometheus.yml
│   └── rules/services.yml
├── grafana/
│   ├── grafana.ini
│   ├── provisioning/datasources/datasources.yaml
│   ├── provisioning/dashboards/dashboards.yaml
│   └── dashboards/
│       ├── api-requests.json
│       ├── runtime-invocations.json
│       ├── realtime-subs.json
│       └── postgres-health.json
└── README.md  (this file)
```

## what's emitted today vs. needed

prometheus scrape targets in `prometheus.yml`:

| service     | /metrics    | metrics emitted today                                                                                                                              | needed for full dashboards                                                                                            |
| ----------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `api`       | ✅ shipped  | `http_requests_total{method,status,route}`, `http_request_duration_ms_bucket{method,route,le}`                                                     | already covered — see `apps/api/src/lib/metrics.ts` + `apps/api/src/middleware/metrics.ts`                            |
| `runtime`   | ✅ shipped  | pool gauges, cold-start histogram, isolate kill counter                                                                                            | already covered — see `apps/runtime/src/metrics.ts`                                                                   |
| `realtime`  | ✅ shipped  | `briven_realtime_subscriptions_active`, `briven_realtime_channels_active`, `briven_realtime_notifies_total`, `briven_realtime_invokes_total{outcome}` | already covered — see `apps/realtime/src/metrics.ts`                                                                  |
| `postgres`  | ⚙️ template ready | none until deployed                                                                                                                                | merge `./postgres-exporter.compose.yml` into the data-plane compose project + create a `briven_metrics` role (`GRANT pg_monitor`) + set `POSTGRES_EXPORTER_DATA_SOURCE_NAME`. exporter binds to `postgres-exporter:9187`, already in `prometheus.yml`. |

dashboards reference these metric names and will show "no data" until the corresponding service starts emitting them. that's deliberate — the dashboards land first so adding a metric is a one-line change.

logs are scraped via promtail's docker_sd_configs; only containers with the `briven_logs=true` label are collected (so unrelated host containers don't pollute loki). add `labels: { briven_logs: "true" }` to each briven service in its dokploy compose.

## deploy on dokploy

```bash
# on the kvm running the briven docker network:
cd infra/observability
docker network create briven 2>/dev/null || true   # idempotent
docker compose up -d
```

verify:

```bash
curl -fsS http://localhost:9090/-/ready          # prometheus ready
curl -fsS http://localhost:3100/ready            # loki ready
docker compose ps                                 # all four containers up
```

then point cloudflare access at `grafana.briven.tech` (the traefik labels in `compose.yml` cover the rest).

## scale-out path

phase 0 ships single-binary loki + local-disk storage. when log ingest exceeds ~50gb/day or query latency degrades:

1. swap loki's `common.storage.filesystem` for `s3` (minio or cloudflare r2)
2. enable loki microservices mode (separate distributor / ingester / querier containers)
3. move prometheus to a clustered mode (vmagent → vmsingle, or thanos)

the dashboards and scrape configs don't change.

## alerting

`prometheus/rules/services.yml` defines `ServiceDown`, `HighErrorRate`, `PostgresConnectionsHigh`. they route through alertmanager → `benjojo/alertmanager-discord` bridge → discord:

- `severity=critical|warning` → `#briven-alerts` (page-worthy)
- everything else (info) → `#briven-deploys`

operator env on the dokploy project:

```
DISCORD_WEBHOOK_ALERTS=https://discord.com/api/webhooks/…
DISCORD_WEBHOOK_DEPLOYS=https://discord.com/api/webhooks/…
```

create the channels in your discord server, generate webhook URLs, paste into the dokploy env. each bridge instance holds one URL; rotation = update env + restart that one service. existing alert state lives in the `alertmanager_data` volume — keep it across redeploys so silences carry through.

smoke test (drop a rule's `for:` to 0s temporarily, observe a message land, revert):

```
docker compose exec prometheus promtool query instant 'up'
docker compose restart prometheus
# … wait for the rule to fire …
# then revert the rule edit and `docker compose restart prometheus` again.
```

## the four dashboards

uids stay stable across redeploys — bookmark them.

- `briven-api-requests` — request rate, p99 latency, 5xx error rate, recent error logs
- `briven-runtime-invocations` — invocations/sec by project, cold-start p50/p99, active isolates, kills by reason
- `briven-realtime-subs` — active subscriptions, LISTEN channels, NOTIFY rate, listener reconnect events
- `briven-postgres-health` — connections, transactions/sec, deadlocks, longest query, db size by schema

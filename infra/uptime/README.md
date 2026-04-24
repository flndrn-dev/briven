# `infra/uptime/` — Uptime Kuma deployment

Uptime Kuma runs as a Docker swarm service outside the main Dokploy
application layout — it's infra, not a briven app. This directory
captures the deploy commands + operational runbook lives at
`docs/runbooks/uptime-kuma.md` (local, gitignored minus
`MIGRATION.md`).

## Deploy from scratch

```bash
ssh root@<kvm> "
  docker volume create briven-uptime-kuma-data
  docker service create \
    --name briven-uptime-kuma \
    --network dokploy-network \
    --mount type=volume,source=briven-uptime-kuma-data,target=/app/data \
    --replicas 1 \
    louislam/uptime-kuma:1
"
```

Then drop `infra/traefik/uptime.yml` into `/etc/dokploy/traefik/dynamic/` and add the Cloudflare DNS record.

## Updating the image

```bash
ssh root@<kvm> "docker service update --image louislam/uptime-kuma:1 briven-uptime-kuma"
```

See the runbook for monitors to configure + backup considerations.

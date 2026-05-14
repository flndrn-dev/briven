# CLAUDE.md — `infra/`

> **Read `/CLAUDE.md` (project root) and `docs/DOCKER.md` before editing anything under `infra/`.** This file is the area-specific addendum: the rules that get violated most often when modifying compose files, observability configs, or runbooks.

---

## The single rule that gets violated most

**Every long-running service in every compose file must carry the project's logging cap.** Compose files in this tree define a YAML anchor near the top:

```yaml
x-logging: &briven-logging
  driver: json-file
  options:
    max-size: '10m'
    max-file: '3'
```

Every service that has `restart: unless-stopped` (or `restart: always`) must carry:

```yaml
restart: unless-stopped
logging: *briven-logging
```

If `restart: unless-stopped` is present without `logging: *briven-logging` immediately below it, the change is incomplete. This is non-negotiable per `docs/DOCKER.md` §7; without the cap, a single noisy container can fill the kvm4 host disk and take every project down with it.

One-shot containers (`restart: 'no'`, like `minio-init`) don't need the cap — they exit before accumulating logs. Everything else does.

---

## What you must never do under `infra/`

These come straight from `docs/DOCKER.md`. They're listed here so the rule fires at the level you're working at, not three layers up.

### Promtail / log shipping

- **No `docker_sd_configs`.** Promtail discovers via `__path__: /var/lib/docker/containers/*/*-json.log` with `static_configs`. See `infra/observability/promtail/config.yaml` for the working pattern.
- **No `unix:///var/run/docker.sock` host:` line.** That's the daemon. The daemon is shared.
- **No `/var/run/docker.sock` bind-mount.** The Promtail container only needs `/var/lib/docker/containers:/var/lib/docker/containers:ro`.

### Prometheus / metrics

- **No `docker_sd_configs` in Prometheus scrape configs.**
- **No scrape job targeting `unix:///var/run/docker.sock`.** The Docker daemon's `/metrics` endpoint is the daemon — don't.
- **Use `static_configs`** with service-name DNS (e.g. `briven-api:3001`) or, for host metrics, cAdvisor + node_exporter (which read cgroupfs and `/proc`, not the daemon).
- **Scrape intervals ≥30s** unless there's a specific reason to go lower.

### Auto-update / image management

- **No Watchtower.** No `restart: always` on a container whose job is to poll the registry.
- **No host-side image polling.** Pulls happen on deploy via Dokploy/Coolify/`docker compose pull && up -d`.
- **No production builds on the deploy host.** Builds happen in CI; the host pulls from GHCR.

### Operator scripts / runbooks

- **No `docker logs -f` in a long-running shell.** Use `tail -F /var/lib/docker/containers/<id>/<id>-json.log` or query Loki.
- **No polling loops over `docker ps` / `docker stats` / `docker inspect`.** Use cAdvisor, cgroupfs, `/proc`, or the container's own `/metrics` endpoint.
- **If a runbook step needs the daemon, justify it in the runbook comment**, and ensure the step exits cleanly (no leaked streaming connections).

---

## Compose file map

| File                                  | Purpose                                                                |
| ------------------------------------- | ---------------------------------------------------------------------- |
| `dokploy/compose.yml`                 | Standalone Docker / Coolify / plain compose                            |
| `dokploy/compose.dokploy.yml`         | Dokploy-managed (no container_name; uses external `dokploy-network`)   |
| `coolify/compose.yml`                 | Coolify-managed (no traefik labels — coolify owns routing)             |
| `observability/compose.yml`           | Grafana + Loki + Prometheus + Promtail (separate Dokploy project)      |

All four are checked by `python3 -c "import yaml; ..."` for syntax + cap coverage in the pre-merge audit; rerun it whenever you add or remove a service:

```bash
python3 -c "
import yaml
for f in ['infra/dokploy/compose.yml','infra/dokploy/compose.dokploy.yml','infra/coolify/compose.yml','infra/observability/compose.yml']:
  with open(f) as fh: d=yaml.safe_load(fh)
  missing=[s for s,c in d['services'].items() if c.get('restart')=='unless-stopped' and 'logging' not in c]
  print(f, '— missing log cap:', missing or 'none')
"
```

---

## Pre-merge checklist (run mentally before opening the PR)

- [ ] No new `docker_sd_configs` anywhere in the change
- [ ] No new `/var/run/docker.sock` bind-mount
- [ ] No new `docker logs -f` / `docker stats` / `docker inspect` polling loop in any script the operator runs on the host
- [ ] Every new long-running service has `logging: *briven-logging`
- [ ] Every new Prometheus scrape job uses `static_configs` or cAdvisor / node_exporter
- [ ] No image build on the deploy host

Anything that fails the checklist is a blocking issue, not a nit. The shared-daemon class of bug surfaces as host-wide slowness across unrelated projects; revert is the right response if the violation made it to production.

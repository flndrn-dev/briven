# CLAUDE.md — briven (project root)

> **This file is the load-bearing rulebook for any LLM-driven change in this repo.** It is loaded automatically into every Claude Code conversation. The authoritative deep-dive is `docs/CLAUDE.md`; everything below is the front-loaded summary plus the rules that get violated most.

---

## 0. Before touching anything — the three docs you must respect

- **`docs/CLAUDE.md`** — full project spec (tech stack, conventions, security, architecture). Always wins on code-level decisions.
- **`docs/DOCKER.md`** — shared-Docker-host hygiene. **This is the rule that gets ignored most often. Read it before any infra/compose/observability/log-shipping work.**
- **`docs/BRAND.md`** — naming, colour, type, CLI output. Read before any visible-surface change.

---

## 1. Docker host hygiene — the rule we keep breaking

The kvm4 VPS that hosts briven also hosts other projects. The Docker daemon is a single Go process; every API call goes through internal locks. Code that "just polls a little" multiplies across 30+ services on the shared box and burns the host's CPU headroom. When the headroom is gone every site on the host slows together — and because the failure is correlated, it never looks like your bug when it bites.

**These rules apply on the dev machine, in the kvm4 server, in compose files, and in any agent action that touches the box.** If you are reaching for the Docker socket or Docker API to solve a problem, stop.

### Hard rules (lifted verbatim from `docs/DOCKER.md`)

1. **Never collect logs via the Docker API.** No `docker_sd_configs` in Promtail / Vector / Fluentbit / Filebeat. No `docker logs --follow` in cron loops, sidecars, or interactive operator sessions. No log shippers holding streaming connections against the daemon. Read JSON log files directly from `/var/lib/docker/containers/*/*-json.log` with file-based discovery.
2. **Never collect metrics via the Docker API.** No Prometheus jobs scraping `unix:///var/run/docker.sock`. No `docker_sd_configs`. Use cAdvisor (cgroupfs) or node_exporter. Scrape intervals ≥30s unless justified.
3. **Don't poll `docker stats` / `docker ps` / `docker inspect` in a loop.** Each call hits the daemon. If a script needs container state more than once per minute, use cgroupfs, the container's own metrics endpoint, or `/proc`.
4. **Don't auto-update images by polling the registry from the host.** No Watchtower. Pull on deploy, not on a timer.
5. **Don't build production images on the deploy host.** Build in CI, push to a registry, pull on deploy.
6. **Don't bind-mount `/var/run/docker.sock` into a container** unless absolutely required. Keep its use narrow and short-lived if you must.
7. **Cap per-container log volume.** **Every service in every compose file must set:**

   ```yaml
   logging:
     driver: json-file
     options:
       max-size: '10m'
       max-file: '3'
   ```

   The compose files in `infra/dokploy/` and `infra/coolify/` define a YAML anchor `x-logging: &briven-logging` near the top of the file. Every new service must include `logging: *briven-logging` immediately after `restart:`. If you add a service without it, the change is incomplete.

8. **Prefer `restart: unless-stopped`** over `restart: always` for non-critical services.

### Pre-merge checklist for any infra change (must all be true)

- [ ] No `docker_sd_configs` anywhere
- [ ] No loops calling `docker logs -f` / `docker stats` / `docker inspect`
- [ ] No new bind-mount of `/var/run/docker.sock`
- [ ] Every new long-running service has `logging: *briven-logging`
- [ ] Image builds happen in CI, not on the deploy host
- [ ] Any new Prometheus scrape job uses cAdvisor / node_exporter / static_configs, not the Docker API

### Server-side treatment — when working over SSH on kvm4

The same rules apply when you (or an agent) SSH into the host and run commands. **In particular:**

- Don't open `docker logs -f <container>` in a long-lived session — it's a streaming connection against the daemon that other operator tools see contention against. To follow logs, `tail -F /var/lib/docker/containers/<id>/<id>-json.log` instead, or query Loki.
- Don't run polling loops like `watch docker ps` or `while true; do docker stats …; done`. Use cAdvisor (already deployed) or read `/sys/fs/cgroup`.
- Don't run `docker pull` from the host on a timer or as a cron. Pulls happen on deploy.
- Don't run `docker compose up -d` from inside a script that also tails the daemon socket — leave the daemon alone after the up.
- Don't build images on the host. If a Dockerfile changed, build in CI and push; the host only `pull`s.

If a host-level alternative exists for what you're about to do, use it first. Preference order: **filesystem → cgroupfs → `/proc` → the container's own metrics endpoint → the Docker API (last resort, with explicit justification in the PR)**.

---

## 2. The other rules that get violated

(Quick hits — full text in `docs/CLAUDE.md`.)

- **Lowercase brand.** `briven`, always. Not `Briven`. Not `BRIVEN`. Even at the start of a sentence.
- **No emails / IPs in logs, dashboards, or CLI output.** Redact at the boundary.
- **Every DB query scoped by `project_id`.** Defense in depth on top of schema-per-tenant.
- **No `eval()` / `Function()` / dynamic import of user-provided strings** in control-plane code.
- **No raw URLs / IPs hardcoded** — all routing goes through env or config.
- **`BRIVEN_` prefix on every env var briven owns.** Never `DATABASE_URL`, always `BRIVEN_DATABASE_URL`.
- **No code outside `apps/`, `packages/`, or `infra/`.** If you think you need to, update `docs/CLAUDE.md` first.
- **Drizzle ORM is the one allowed exception** for the control-plane meta-DB. Customer code uses the briven schema DSL.
- **Customer functions can't reach private IPs.** IPv4 deny list at the Deno isolate; IPv6 blocked at the host firewall.

---

## 3. When in doubt

1. Re-read `docs/CLAUDE.md` (full spec)
2. Re-read `docs/DOCKER.md` (host hygiene)
3. Re-read `docs/BRAND.md` (visible-surface rules)
4. If still unclear, open an ADR under `docs/ADR/` first, then implement

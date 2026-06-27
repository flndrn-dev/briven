---
title: "Dolt SQL Reference — Server (operational reference)"
scope: >
  Operational SQL-server reference for running DoltGres in production. Source docs
  describe Dolt (MySQL-flavored). Server-ops concepts (config, access management,
  branch permissions, backups, garbage collection, metrics, replication, hardware
  sizing, troubleshooting) carry over to DoltGres and are tagged [CORE]. Wire-protocol
  / SQL-dialect / privilege-model specifics are MySQL-flavored in these docs; DoltGres
  serves the Postgres wire protocol and uses Postgres equivalents — those points are
  flagged with ⟦DoltGres note⟧ for verification.
source_urls:
  - https://www.dolthub.com/docs/sql-reference/server/
  - https://www.dolthub.com/docs/sql-reference/server/configuration/
  - https://www.dolthub.com/docs/sql-reference/server/access-management/
  - https://www.dolthub.com/docs/sql-reference/server/branch-permissions/
  - https://www.dolthub.com/docs/sql-reference/server/backups/
  - https://www.dolthub.com/docs/sql-reference/server/garbage-collection/
  - https://www.dolthub.com/docs/sql-reference/server/metrics/
  - https://www.dolthub.com/docs/sql-reference/server/replication/
  - https://www.dolthub.com/docs/sql-reference/server/hardware-requirements/
  - https://www.dolthub.com/docs/sql-reference/server/troubleshooting/
fetched: 2026-06-28
---

# Dolt SQL Reference → Server

> These pages document **Dolt (MySQL-flavored)** server operation. The target platform is
> **DoltGres (Postgres-flavored)**. Server-operations concepts carry over almost entirely
> and are marked **[CORE]**. Anything tied to the MySQL wire protocol, MySQL SQL dialect,
> or the MySQL privilege model is flagged with a `⟦DoltGres note⟧` to verify against the
> Postgres equivalent before relying on it.

---

## Overview — running the SQL server
**URL:** https://www.dolthub.com/docs/sql-reference/server/
**Relevance:** [CORE]

Dolt has two ways to run SQL:
- `dolt sql-server` — launches a **MySQL-compatible** server that clients connect to over the network.
- `dolt sql` — executes queries directly from the shell, no server process.

### Starting the server
`dolt sql-server` prints its effective config at startup, e.g.:

```
Starting server with Config HP="localhost:3306"|U="root"|P=""|T="28800000"|R="false"|L="info"
```

Default configuration:
- Host/Port: **localhost:3306**
- User: **root**
- Password: empty
- Timeout (T): **28800000** ms
- Replication (R): **false**
- Log level (L): **info**

All of these are overridable via command-line flags or a config file (see Configuration section).

### Stopping the server
Responds to standard Unix signals: `SIGHUP`, `SIGQUIT`, `SIGABRT`, `SIGKILL`. Stop it by:
- `Ctrl-C` in the running shell, or
- `kill -QUIT [PID]`.

### `dolt sql` (no server)
- Interactive shell: `dolt sql`
- One-off query: `dolt sql -q "query"`
- Batch from a file: `dolt sql < file.sql`

> ⟦DoltGres note⟧ MySQL-flavored: the server here speaks the **MySQL wire protocol** and the
> default port is **3306**. DoltGres serves the **PostgreSQL wire protocol** (Postgres default
> port is 5432) and the launching command is the DoltGres binary, not `dolt sql-server` — verify
> the exact command, default port, and default user for DoltGres.

---

## Configuration
**URL:** https://www.dolthub.com/docs/sql-reference/server/configuration/
**Relevance:** [CORE]

Primary mechanism: a YAML config file passed with `dolt sql-server --config=config.yaml`.

### Full YAML template
```yaml
log_level: info
log_format: text

behavior:
  read_only: false
  autocommit: true
  disable_client_multi_statements: false
  dolt_transaction_commit: false
  event_scheduler: "ON"
  auto_gc_behavior:
    enable: false
    archive_level: 0
  branch_activity_tracking: false

listener:
  host: localhost
  port: 3306
  max_connections: 1000
  back_log: 50
  max_connections_timeout_millis: 60000
  read_timeout_millis: 28800000
  write_timeout_millis: 28800000
  ca_cert: null
  tls_key: null
  tls_cert: null
  require_client_cert: null
  require_secure_transport: null
  allow_cleartext_passwords: null

max_logged_query_len: 0

data_dir: .
cfg_dir: .doltcfg
privilege_file: .doltcfg/privileges.db
branch_control_file: .doltcfg/branch_control.db

metrics:
  labels: {}
  host: null
  port: -1

remotesapi:
  port: null
  read_only: null

mcp_server:
  port: 7007
  user: root
  password: ""
  database: ""

system_variables: {}

user_session_vars: []

jwks: []
```

### Logging
- **`log_level`** (default `info`) — one of `trace, debug, info, warning, error, fatal`; each level includes lower levels.
- **`log_format`** (default `text`) — `text` or `json`.
- **`max_logged_query_len`** (default `0`) — truncate logged query strings; `0` = no truncation.

### `behavior`
- **`read_only`** (default `false`) — block all writes when true.
- **`autocommit`** (default `true`) — auto-commit each statement; false requires explicit `COMMIT`/`ROLLBACK`.
- **`disable_client_multi_statements`** (default `false`) — reject multi-statement (semicolon-delimited) queries.
- **`dolt_transaction_commit`** (default `false`) — create a Dolt commit automatically on each transaction commit (auto-generated message).
- **`event_scheduler`** (default `"ON"`) — `"ON"`/`"OFF"`; enables MySQL `CREATE EVENT` scheduling (main branch only).
- **`branch_activity_tracking`** (default `false`) — enable `dolt_branch_activity` system table; has a performance cost.
- **`auto_gc_behavior.enable`** (default `false`) — background garbage collection on growing databases.
- **`auto_gc_behavior.archive_level`** (default `1`; template shows `0`) — `0` or `1`; level `1` gives ~30% compression, `0` for legacy-client compatibility.

### `listener` (transport)
- **`host`** (default `localhost`) — `localhost`, an IPv4, or IPv6 address.
- **`port`** (default `3306`) — range 1024–49151.
- **`max_connections`** (default `1000`) — range 0–100,000; `0` = unlimited.
- **`back_log`** (default `50`) — queued connections before rejection.
- **`max_connections_timeout_millis`** (default `60000`) — wait for a connection slot.
- **`read_timeout_millis`** (default `28800000`) — timeout on inactive client reads.
- **`write_timeout_millis`** (default `28800000`) — timeout on server→client writes.
- **`ca_cert`** (default `null`) — `.pem` to validate client certs.
- **`tls_key`** / **`tls_cert`** (default `null`) — `.pem` TLS key / cert.
- **`require_secure_transport`** (default `null`) — `true` forces TLS/SSL.
- **`require_client_cert`** (default `null`) — `true` mandates client certs.
- **`allow_cleartext_passwords`** (default `false`) — needed for JWT (`mysql_clear_password` plugin) auth without encryption.

### Paths
- **`data_dir`** (default `.`) — root directory for database storage.
- **`cfg_dir`** (default `.doltcfg`) — config dir relative to `data_dir`.
- **`privilege_file`** (default `.doltcfg/privileges.db`) — user/grant storage.
- **`branch_control_file`** (default `.doltcfg/branch_control.db`) — branch-permission storage.

### `metrics`
- **`metrics.host`** (default `null`) — host for Prometheus-format metrics (requires a port).
- **`metrics.port`** (default `-1`) — metrics HTTP port; range 1024–49151.
- **`metrics.labels`** (default `{}`) — label pairs applied to all metrics.

### `remotesapi` (clone/push/pull protocol)
- **`remotesapi.port`** (default `null`) — enable the Dolt remote protocol; range 1024–49151.
- **`remotesapi.read_only`** (default `null`) — `true` blocks pushes.

### `mcp_server` (AI agent integration)
- **`mcp_server.port`** (default `7007`), **`mcp_server.user`** (default `root`), **`mcp_server.password`** (default `""`), **`mcp_server.database`** (default `""`).

### Variables
- **`system_variables`** (default `{}`) — global system variable map, e.g. `{"dolt_show_system_tables": 1}`.
- **`user_session_vars`** (default `[]`) — per-user variables:
  ```yaml
  user_session_vars:
  - name: "username"
    vars:
      "variable_name": value
  ```
- **`jwks`** (default `[]`) — JSON Web Key Set for JWT auth (Hosted Workbench).

### Per-session config
System variables can also be set per session, e.g.:
```sql
SET @@dolt_transaction_commit = 1;
```

> ⟦DoltGres note⟧ MySQL-flavored specifics: default `listener.port: 3306`, default user `root`,
> the `event_scheduler`/`CREATE EVENT` feature, `disable_client_multi_statements`, the
> `mysql_clear_password` plugin, and `@@`-style session-variable syntax are MySQL conventions.
> DoltGres uses the Postgres wire protocol (default 5432), Postgres roles, and Postgres
> `SET`/`SHOW` syntax — verify which of these YAML keys DoltGres honors and their DoltGres defaults.
> The structural keys (log_level, behavior, listener.host, timeouts, max_connections, data_dir,
> cfg_dir, metrics, remotesapi, auto_gc_behavior) are operational and expected to carry over.

---

## Access management
**URL:** https://www.dolthub.com/docs/sql-reference/server/access-management/
**Relevance:** [CORE] (model is MySQL-flavored — see note)

- Dolt handles access management **like MySQL**, using grant tables (`mysql.user`, `mysql.db`, etc.). Enabled by default.
- Privileges stored in **`.doltcfg/privileges.db`** by default. Override via:
  - CLI: `--privilege-file="PATH"`
  - YAML: `privilege_file: PATH`
- **Root superuser:** when the privileges DB isn't yet initialized at startup, a `root@localhost`
  superuser is auto-created — scoped to `localhost`, **no password**; can be modified or deleted like any user.

### User management
```sql
CREATE USER user1@'%' IDENTIFIED BY 'pass1';
GRANT ALL ON *.* to user1@'%';
```

### Support status
- **Fully supported:** `CREATE ROLE`, `DROP ROLE`, `DROP USER`, `SHOW PRIVILEGES`
- **Partially supported:** `CREATE USER` (basic `mysql_native_password` only), `GRANT`, `REVOKE`, `SHOW GRANTS`
- **Not yet supported:** `ALTER USER`, `RENAME USER`, `SET PASSWORD`, `SET ROLE`, column-level privileges, stored-procedure permissions

### Update behavior
Privilege changes take effect immediately. `CREATE USER`/`GRANT`/`REVOKE` persist to the privilege
file immediately; direct table `INSERT`/`UPDATE` updates the live state but does **not** persist to disk.

> ⟦DoltGres note⟧ MySQL-flavored: the `user@'host'` identity model, `mysql.*` grant tables,
> `mysql_native_password`, and `GRANT ... ON *.*` syntax are MySQL. DoltGres uses Postgres roles
> and Postgres `GRANT`/`CREATE ROLE` semantics — verify how DoltGres stores/authenticates users and
> whether the `privilege_file` mechanism and the auto-created superuser apply.

---

## Branch permissions
**URL:** https://www.dolthub.com/docs/sql-reference/server/branch-permissions/
**Relevance:** [CORE] (Dolt-specific version-control feature; high value for DoltGres)

Branch permissions govern how users interact with branches when running `dolt sql-server`. Two tables:
- **`dolt_branch_control`** — controls branch *modification*.
- **`dolt_branch_namespace_control`** — controls branch *creation* (naming).

> Important: enforced **only** for clients connecting to a running server **with a username and
> password**. Local CLI commands bypass branch permissions entirely.

### `dolt_branch_control`
Columns: `database`, `branch`, `user`, `host`, `permissions` (SET type).
Pattern matching on all columns:
- `_` matches a single character
- `%` matches zero or more characters
- `\` escapes special characters

### `dolt_branch_namespace_control`
Same structure but **no `permissions` column**. Restricts allowed branch names on creation.

### Permission types
| Permission | Effect |
|---|---|
| **admin** | All capabilities, plus write access to the branch-control system-table entries matching the database/branch scope |
| **write** | Branch modification in all forms (rename, delete, etc.) |
| **merge** | Merge via `dolt_merge` without arbitrary write access |
| **read** | Informational only; all users always have read access (irrevocable) |

### Defaults
- `dolt_branch_control` initializes with:
  ```sql
  INSERT INTO dolt_branch_control VALUES ('%', '%', '%', '%', 'write');
  ```
  (universal branch modification allowed by default)
- `dolt_branch_namespace_control` starts empty → all branch names permitted.

### Matching mechanics
- **Longest-match rule:** only the most-specific matching entries are considered.
- **Pattern folding:** `%%` → `%`; `%_` → `_%` for consistency.
- **Branch creation:** if matching `dolt_branch_namespace_control` entries exist for the database/branch,
  the user must also match or creation is rejected. New branches automatically get an **admin** entry in
  `dolt_branch_control` for their creator.

### Storage
Branch-control data lives in `branch_control.db` under `.doltcfg`. A binlog tracks all modifications
(for future audit/correction; currently inaccessible).

> ⟦DoltGres note⟧ The `database`/`branch`/`user`/`host`/`permissions` table model is Dolt's
> version-control feature and should carry over conceptually. The `user`+`host` identity pairing and
> the requirement of "username and password" connections reflect the MySQL model — verify the table
> names, columns, and identity semantics in DoltGres (Postgres roles have no `host` component).

---

## Backups
**URL:** https://www.dolthub.com/docs/sql-reference/server/backups/
**Relevance:** [CORE]

### Backup strategies
- **Recommended: point-in-time block-device snapshots** (e.g., AWS EBS) — simplest and safest; works
  while the server runs and gives consistency guarantees.
- **File-system copy** requires stopping all Dolt processes — no safety/consistency guarantees otherwise.
  ("you **cannot** rely on the same safety and consistency guarantees at the file system layer.")

### Pushing to remotes (limited backup)
Remotes only back up the **current commit of a branch** — not the working set or other branches.
```bash
dolt remote add backup https://doltremoteapi.dolthub.com/timsehn/backup-example
dolt remote -v
```
```sql
call dolt_add('test');
call dolt_commit('-m', "Created table and inserted values to be backed up");
call dolt_push('backup', 'main');
```

### `dolt backup` command (full state, incl. uncommitted, all branches)
```bash
# add
dolt backup add local-backup file:///Users/timsehn/liquidata/dolt/backups/backup-example
# sync (incremental; overwrites remote state entirely)
dolt backup sync local-backup
# restore
dolt backup restore file:///Users/timsehn/liquidata/dolt/backups/backup-example backup-restore
```
Supports filesystem, AWS S3, GCS, and DoltHub targets. Sync via SQL:
```sql
call dolt_backup('sync', 'local-backup');
```
Note: backups are configured **per-database**.

### Also back up (beyond the database files)
- SQL server YAML config file (unless version-controlled)
- Global Dolt config — `HOME/.dolt` or `DOLT_ROOT_PATH`
- The `mysql` system database (users + grants) — use `mysqldump`
- Per-database `.dolt/config.json`
- Per-database `.dolt/repo_state.json` (metadata incl. remote config)
- Branch-permission tables `dolt_branch_control` and `dolt_branch_namespace` — back up manually via `mysqldump`

### Hosted Dolt
Managed deployments take automatic backups, no config needed.

> ⟦DoltGres note⟧ MySQL-flavored: the `mysql` system database and `mysqldump` for users/grants and
> branch-control tables are MySQL tooling. DoltGres equivalents would be Postgres-side (e.g.,
> `pg_dump`) — verify. The block-device snapshot, `dolt backup add/sync/restore`, remote push, and
> the "what else to back up" list are operational and expected to apply (confirm command names for DoltGres).

---

## Garbage collection
**URL:** https://www.dolthub.com/docs/sql-reference/server/garbage-collection/
**Relevance:** [CORE]

### What it does
GC removes unreferenced data chunks. Garbage accumulates from transactions without a corresponding
Dolt commit, after large imports, and when branches with unique chunks are deleted. Writes rewrite
multiple chunks of the prolly tree, so uncommitted writes / branch deletes leave orphaned data.

### Automatic GC
As of **v1.75**, GC runs automatically in both `dolt sql-server` and `dolt sql`.
- Disable in server: `auto_gc_behavior: { enable: false }` in config.
- Disable in `dolt sql`: `--disable-auto-gc` flag.

### Manual GC
- **Offline:** run `dolt gc` in the database directory with no server running. CPU- and memory-intensive.
- **Online:** `call dolt_gc()` via a SQL client. This **breaks all open connections** to the running
  server; in-flight queries may fail, and the executing connection becomes unusable afterward (must reconnect).

### Limitation
Online GC on cluster replicas in standby mode is unsupported and fails when automatic GC is disabled.

(No `--shallow` flag is mentioned on this page.)

> ⟦DoltGres note⟧ GC is core storage-engine behavior and carries over. Verify the exact procedure
> name in DoltGres (`dolt_gc()` is MySQL-dialect call syntax; Postgres would use `SELECT dolt_gc();`
> or `CALL`), the config key, and the auto-GC version baseline.

---

## Metrics
**URL:** https://www.dolthub.com/docs/sql-reference/server/metrics/
**Relevance:** [CORE]

### Enable Prometheus metrics
Add a `metrics` section to the YAML config:
```yaml
metrics:
  labels: {}
  host: localhost
  port: 11228
```
Metrics then served at `http://localhost:11228/metrics`.

### Exposed metrics
**Dolt SQL server** (prefix `dss_`):
- `dss_concurrent_connections` — active client connections
- `dss_concurrent_queries` — queries currently executing
- `dss_query_duration_bucket` — histogram of query latencies
- `dss_is_replica` — replication status indicator (when enabled)
- `dss_replication_lag` — replica lag in ms (when enabled)

**Go runtime** (prefix `go_`):
- `go_gc_duration_seconds` — GC pause duration histogram
- `go_gc_duration_seconds_count` — total GC seconds
- `go_memstats_alloc_bytes` — currently-allocated bytes

### Prometheus scrape config
```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: "dolt-sql-server"
    static_configs:
    - targets: ["localhost:11228"]
```
Datadog and other Prometheus-format consumers also work.

> ⟦DoltGres note⟧ Metrics are operational and carry over. The metric names are `dss_*`
> (Dolt SQL Server) — DoltGres may emit different prefixes/names; verify the exact metric names,
> the config key for the metrics port, and the endpoint path for DoltGres.

---

## Replication
**URL:** https://www.dolthub.com/docs/sql-reference/server/replication/
**Relevance:** [CORE]

Three modes:
1. **Remote-based** — a remote acts as middleman between primary and read replicas, triggered on Dolt
   commits. Simplest; no hot-standby.
2. **Direct-to-standby (cluster)** — primary replicates all writes directly to configured standby servers,
   no intermediate remote. Replicates on every SQL transaction commit; enables HA failover.
3. **MySQL/binlog** — Dolt as a read replica of MySQL (consuming binlog), or Dolt as primary with MySQL
   as replica (CDC / data-warehouse).

### Remote-based system variables
| Variable | Purpose | For |
|---|---|---|
| `@@dolt_replicate_to_remote` | remote name to push to on commit/tag update | primary |
| `@@dolt_read_replica_remote` | remote name to pull from at transaction start | replica |
| `@@dolt_replicate_heads` | comma-separated branches (supports `*` wildcard) | replica |
| `@@dolt_replicate_all_heads` | pull all branches/tags when `1` | replica |
| `@@dolt_replication_remote_url_template` | URL template with `{database}` token for new DBs | optional |
| `@@dolt_skip_replication_errors` | replication errors → warnings (default `0`) | optional |
| `@@dolt_transaction_commit` | every transaction becomes a Dolt commit (default `0`) | optional |
| `@@dolt_async_replication` | eventually-consistent async pushes (default `0`) | optional |

```sql
set @@persist.dolt_replicate_to_remote = 'origin';
set @@persist.dolt_read_replica_remote = 'origin';
set @@persist.dolt_replicate_heads = 'main';
set @@persist.dolt_transaction_commit = 1;
set @@persist.dolt_async_replication = 1;
```

### Direct-to-standby cluster YAML
Primary (`dolt-1.db`):
```yaml
cluster:
  standby_remotes:
    - name: standby
      remote_url_template: http://dolt-2.db:50051/{database}
  bootstrap_role: primary
  bootstrap_epoch: 1
  remotesapi:
    port: 50051
```
Standby (`dolt-2.db`):
```yaml
cluster:
  standby_remotes:
    - name: standby
      remote_url_template: http://dolt-1.db:50051/{database}
  bootstrap_role: standby
  bootstrap_epoch: 1
  remotesapi:
    port: 50051
```
- Each server's `remote_url_template` points to its peers; `remotesapi.port` must match the template port.
- `bootstrap_role` designates primary vs standby; `bootstrap_epoch` prevents config conflicts.

### Cluster role management
```sql
CALL dolt_assume_cluster_role('standby', 2);   -- demote: becomes read-only, conns terminate, replication finishes first
CALL dolt_assume_cluster_role('primary', 2);   -- promote: becomes read-write, conns reset, applies immediately
```
Monitor:
```sql
select @@GLOBAL.dolt_cluster_role, @@GLOBAL.dolt_cluster_role_epoch;
select * from dolt_cluster.dolt_cluster_status;
-- columns: database, standby_remote, role, epoch, replication_lag_millis, last_update, current_error
```
Auto-transitions can occur from peer communication or incoming replication at a higher epoch. If two
servers both detect primary at the same epoch, both adopt `detected_broken_config` (read-only).

### Cluster TLS (optional `remotesapi`)
```yaml
remotesapi:
  address: "127.0.0.1"
  port: 50051
  tls_key: "remotesapi_key.pem"
  tls_cert: "remotesapi_chain.pem"
  tls_ca: "standby_cas.pem"
  server_name_urls:
    - "https://standby_replica_one.svc.cluster.local"
    - "https://standby_replica_two.svc.cluster.local"
  server_name_dns:
    - "standby_replica_one.svc.cluster.local"
```

### What replicates / what doesn't
- **Replicates:** all SQL transactions, branch HEAD updates, newly created databases, branch deletes.
- **Does NOT replicate:** `DROP DATABASE` (run manually on all servers); user/grant statements (run separately on all servers).

### Remote vs direct comparison (highlights)
- Failover: remote = no auto-promotion; direct = controlled lossless failover.
- Write latency: remote higher (push to remote storage); direct lower.
- Scalability: remote better for many read replicas; direct limited by primary replication load.
- Security default: remote = none; direct = ephemeral key signing + optional TLS.

### Quick setup
```bash
# remote-based primary
dolt remote add origin timsehn/example
dolt sql -q "set @@persist.dolt_replicate_to_remote = 'origin'"
dolt commit -m "trigger replication"

# remote-based replica
dolt clone timsehn/example read_replica
cd read_replica
dolt sql -q "set @@persist.dolt_read_replica_remote = 'origin'"
dolt sql -q "set @@persist.dolt_replicate_heads = 'main'"

# stop replication
dolt sql -q "set @@persist.dolt_replicate_to_remote = ''"
```

> ⟦DoltGres note⟧ MySQL-flavored: `@@`/`@@persist`/`@@GLOBAL` variable syntax, `CALL dolt_...`, and
> the MySQL-binlog replication mode are MySQL-specific. DoltGres uses Postgres `SET`/`SHOW` syntax and
> would have a Postgres-protocol equivalent (logical replication) rather than MySQL binlog — verify the
> variable names, persistence syntax, cluster YAML support, and whether mode 3 exists for DoltGres.
> The remote-based and direct-to-standby concepts and cluster YAML structure are expected to carry over.

---

## Hardware requirements
**URL:** https://www.dolthub.com/docs/sql-reference/server/hardware-requirements/
**Relevance:** [CORE]

### RAM
Provision **10–20% of database size**. Example: a 104 GB database used ~2 GB at startup, ~4.6 GB during
full table scans. Push toward 20% for active working sets, heavy concurrent reads, or large in-memory
sorts. Bulk imports need extra headroom beyond steady state.

### Disk
Dolt uses more storage than equivalent MySQL for two reasons:
- **Version history** — each commit retains chunks to reconstruct prior states; updates/inserts add
  roughly `4 KB × indexes × log(table_size) / 2` of extra data.
- **Import amplification** — row-by-row inserts can produce ~**10× more garbage** than bulk inserts.

A single HEAD footprint is below equivalent MySQL (prolly-tree compression); growth budget is mainly
for historical versions.

### CPU
"CPU is rarely Dolt's scale-limiting axis." No Dolt-specific guidance; size like a comparable MySQL
workload and prioritize RAM.

### Network
"Similar to MySQL." Remote clone/fetch benefits from more bandwidth.

### Disk type
No specific SSD/NVMe recommendation on this page.

> ⟦DoltGres note⟧ These are Dolt storage-engine sizing characteristics (prolly trees, version history,
> import amplification) and should carry over to DoltGres since it shares the storage engine. The
> "vs MySQL" baselines become "vs Postgres" for DoltGres — verify exact ratios. Note: the
> troubleshooting page gives concrete RAM floors (2/4/8 GB) — see below.

---

## Troubleshooting
**URL:** https://www.dolthub.com/docs/sql-reference/server/troubleshooting/
**Relevance:** [CORE]

### Diagnostics basics
- **Version:** `select dolt_version()` — verify you're on latest; update by replacing the binary and restarting.
- **Resources:** check CPU/memory/disk; Dolt uses all three. Scale up or add read replicas if starved.
- **Verbose logging:** start with `dolt sql-server --loglevel=debug` or set `log_level: debug` in
  `config.yaml` — surfaces executed queries, results, and latency.
- **Query analysis:** use `EXPLAIN PLAN` (not `EXPLAIN`) to inspect execution and optimize joins/index use.

### Common scenarios
- **High disk usage:** auto-GC is default since v1.75; trigger manually via `call dolt_gc()` (online) or
  `dolt gc` (offline). Avoid random primary keys and schema churn (fragments storage).
- **Memory growth:** suggested minimums **2 GB** baseline, **4 GB** larger DBs, **8 GB** typical production.
  Some queries grow memory unboundedly — restart clears it; leaks persisting across restarts → file a GitHub issue.
- **CPU saturation:** for high read concurrency, deploy read replicas + load balancing; a single query
  pinning CPU is rare but reportable.
- **Write bottleneck:** the transaction model serializes writes (~**300 writes/sec** typical max); throughput
  drops as concurrent writers rise. Architectural limit, under active development.

### Reporting
File detailed GitHub issues with schema, reproducible queries, and ideally a DoltHub clone.

> ⟦DoltGres note⟧ MySQL-flavored: `EXPLAIN PLAN`, `call dolt_gc()`, and `select dolt_version()` are
> MySQL-dialect calls — DoltGres uses Postgres `EXPLAIN`/`SELECT dolt_version()` equivalents; verify.
> The resource-sizing floors, GC guidance, log_level/`--loglevel=debug`, and the write-serialization
> (~300 writes/sec) limit reflect the shared engine and are expected to apply to DoltGres.

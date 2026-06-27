---
title: Dolt Reference — Introduction, Installation & Getting Started
scope: Distilled from Dolt's (MySQL-flavored) docs as source material for the DoltGres docs section. DoltGres = the Postgres-flavored, version-controlled "Git for your data" DB that Briven runs as its data plane.
sources:
  - https://www.dolthub.com/docs/introduction/what-is-dolt/
  - https://www.dolthub.com/docs/introduction/installation/
  - https://www.dolthub.com/docs/introduction/installation/linux/
  - https://www.dolthub.com/docs/introduction/installation/windows/
  - https://www.dolthub.com/docs/introduction/installation/mac/
  - https://www.dolthub.com/docs/introduction/installation/source/
  - https://www.dolthub.com/docs/introduction/installation/application-server/
  - https://www.dolthub.com/docs/introduction/installation/docker/
  - https://www.dolthub.com/docs/introduction/installation/upgrading/
  - https://www.dolthub.com/docs/introduction/getting-started/
  - https://www.dolthub.com/docs/introduction/getting-started/database/
  - https://www.dolthub.com/docs/introduction/getting-started/git-for-data/
  - https://www.dolthub.com/docs/introduction/getting-started/versioned-mysql-replica/
relevance_tags:
  - "[CORE] = applies to the DoltGres DB platform now"
  - "[LATER: DoltGit] = git-for-data depth"
  - "[LATER: DoltLab] = hosting/DoltHub features"
---

# Dolt Reference — Introduction, Installation & Getting Started

> **GLOBAL DoltGres note:** Every page below documents **Dolt**, the **MySQL-flavored** sibling. **DoltGres** is **Postgres-flavored**: it speaks the Postgres wire protocol, ships its own binary named **`doltgres`** (not `dolt`), and uses Postgres SQL syntax/types and a `psql`-style client instead of `mysql`. The universal version-control concepts (commit, branch, merge, diff, time-travel, replica) carry over directly. MySQL-specific SQL, types, ports (3306), and CLI quirks shown here must be translated to their Postgres equivalents — flagged inline as `⟦DoltGres note⟧`. Do not assume exact DoltGres syntax from these pages; verify against DoltGres' own docs.

---

## What is Dolt
**Source:** https://www.dolthub.com/docs/introduction/what-is-dolt/
**Relevance:** [CORE] (concept), with [LATER: DoltLab] for the ecosystem products

Dolt is "a SQL database you can fork, clone, branch, merge, push and pull just like a Git repository." It is a version-controlled database combining a Git workflow with MySQL-compatible SQL.

**Three ways to characterize it:**
1. **Version Controlled Database** — a SQL database with version control exposed through *system tables, functions, and procedures* (e.g. `dolt_log`, `dolt_status`, `dolt_commit()`).
2. **Git for Data** — the CLI matches Git exactly: `dolt add`, `dolt commit`, etc. Versioning target is **tables** instead of files.
3. **Versioned MySQL Replica** — deploy as a MySQL-compatible replica to gain version control without migrating off MySQL.

**Technical features:** versions tables (Git versions files); MySQL-compatible connections for SQL; CLI for importing CSVs, committing, pushing to remotes, merging; all standard Git commands behave identically.

**Ecosystem products:**
- **Hosted Dolt** — cloud-deployed instances with configurable server/disk; connect via MySQL clients. *[LATER: DoltLab]*
- **DoltHub** — web platform to share Dolt databases; editing, pull-request review, production deploy. *[LATER: DoltLab]*
- **DoltLab** — self-hosted DoltHub for private networks. *[LATER: DoltLab]*

> ⟦DoltGres note⟧ "MySQL-compatible" → DoltGres is Postgres-wire-compatible. The version-control system tables/functions exist in DoltGres too, but exact names/signatures should be verified.

---

## Installation — Overview
**Source:** https://www.dolthub.com/docs/introduction/installation/
**Relevance:** [CORE]

Dolt is "extremely simple to install" — a single ~100 MB program you download or compile and add to your `PATH`. Free and open source.

**Installation methods (template for DoltGres docs):**
1. **Linux** — install script
2. **Windows** — MSI / package managers
3. **Mac** — script / Homebrew / MacPorts
4. **Build from Source** — for unreleased features/bugfixes
5. **Application Server** — run as a MySQL-compatible server on Linux
6. **Docker** — containerized deployment
7. **Upgrading**

> ⟦DoltGres note⟧ This whole install structure is the right **template** for DoltGres docs, but the actual binary is **`doltgres`** with its **own** releases/install steps. The Dolt commands below install `dolt`, not `doltgres` — DoltGres install differs (verify DoltGres' release assets and any install script). Treat all install commands here as the *shape* to mirror, not literal DoltGres commands.

---

## Installation — Linux
**Source:** https://www.dolthub.com/docs/introduction/installation/linux/
**Relevance:** [CORE]

Official method — install script:
```bash
sudo bash -c 'curl -L https://github.com/dolthub/dolt/releases/latest/download/install.sh | sudo bash'
```
- Script detects architecture, downloads the right binary, and places it in `/usr/local/bin`.
- Requires `sudo` (system-path install).
- The script "can be examined before executing" — review before running.

Only the automated script is documented in this section (no package-manager or manual-download instructions on this page).

> ⟦DoltGres note⟧ MySQL-flavored binary (`dolt`). For DoltGres, use the `doltgres` release/install — different URL/binary; verify.

---

## Installation — Windows
**Source:** https://www.dolthub.com/docs/introduction/installation/windows/
**Relevance:** [CORE]

Package managers:
```powershell
winget install dolt
choco install dolt      # Chocolatey
scoop install dolt      # Scoop
```
Manual:
- **MSI installer** ("the easiest way to install Dolt on Windows") — download from the GitHub latest-release assets.
- **ZIP archive** — download zipped executables from the same release assets and extract.

No verification steps or system requirements listed on this page.

> ⟦DoltGres note⟧ Installs `dolt`. DoltGres Windows availability/packages may differ — verify (DoltGres is newer and may not have all package-manager channels).

---

## Installation — Mac
**Source:** https://www.dolthub.com/docs/introduction/installation/mac/
**Relevance:** [CORE]

Three methods:
```bash
# 1. Install script (curl) -> /usr/local/bin (works on macOS since OSX is *nix)
sudo bash -c 'curl -L https://github.com/dolthub/dolt/releases/latest/download/install.sh | bash'

# 2. Homebrew (compiles from source; symlinks into /usr/local/bin)
brew install dolt

# 3. MacPorts (community-managed)
sudo port install dolt
```
Verify:
```bash
ls -ltr $(which dolt)
```
Notes: Homebrew publishes a new formula per release; MacPorts is community-managed (not official).

> ⟦DoltGres note⟧ `brew install dolt` installs the MySQL-flavored binary. Check whether a `doltgres` Homebrew formula exists before documenting it.

---

## Installation — Build from Source
**Source:** https://www.dolthub.com/docs/introduction/installation/source/
**Relevance:** [CORE]

Prerequisite: Go installed (no minimum version stated on the page).
```bash
git clone git@github.com:dolthub/dolt.git
cd dolt/go && go install ./cmd/dolt
```
- Produces a `dolt` binary at `~/go/bin/dolt` (unless `$GO_HOME` is set elsewhere).
- Assumes SSH access to GitHub. No explicit PATH/verification steps documented.

> ⟦DoltGres note⟧ For DoltGres, clone `github.com/dolthub/doltgresql` (verify repo name) and build its own `cmd` entrypoint — the build path/binary name differ.

---

## Installation — Application Server
**Source:** https://www.dolthub.com/docs/introduction/installation/application-server/
**Relevance:** [CORE] (this is how Briven would run DoltGres as a data plane)

Install binary:
```bash
sudo bash -c 'curl -L https://github.com/dolthub/dolt/releases/latest/download/install.sh | sudo bash'
```
Create a dedicated system user:
```bash
sudo useradd -r -m -d /var/lib/doltdb dolt
```
Configure commit identity (Git-style, required so commits have an author):
```bash
cd /var/lib/doltdb
sudo -u dolt dolt config --global --add user.email doltServer@company.com
sudo -u dolt dolt config --global --add user.name "Dolt Server Account"
```
Initialize a database directory:
```bash
cd /var/lib/doltdb
sudo -u dolt mkdir -p databases/my_db
cd databases/my_db
sudo -u dolt dolt init
```
systemd service (`/etc/systemd/system/doltdb.service`):
```ini
[Unit]
Description=dolt SQL server
After=network.target

[Install]
WantedBy=multi-user.target

[Service]
User=dolt
Group=dolt
ExecStart=/usr/local/bin/dolt sql-server
WorkingDirectory=/var/lib/doltdb/databases/my_db
KillSignal=SIGTERM
SendSIGKILL=no
```
Enable & start:
```bash
sudo chown root:root doltdb.service
sudo chmod 644 doltdb.service
sudo mv doltdb.service /etc/systemd/system
sudo systemctl daemon-reload
sudo systemctl enable doltdb.service
sudo systemctl start doltdb
```
Connect (default port **3306**, default superuser `root@localhost`, no password):
```bash
mysql -h 127.0.0.1 -u root -p''
```
- Use `-P` to change port if 3306 is taken.
- Manage accounts with standard SQL: `CREATE USER`, `ALTER USER`, `GRANT`.

> ⟦DoltGres note⟧ DoltGres serves the **Postgres** wire protocol — default port is **5432** (not 3306), the launch command and client are Postgres-flavored (`psql -h 127.0.0.1 -U postgres` rather than `mysql ... -u root`), and the server subcommand name may differ. The systemd/user/`config user.email`/`init` pattern still applies. Verify DoltGres' exact server command and default port.

---

## Installation — Docker
**Source:** https://www.dolthub.com/docs/introduction/installation/docker/
**Relevance:** [CORE]

Two official images (linux/amd64 + linux/arm64), updated per release.

**CLI image** — `dolthub/dolt`:
```bash
docker pull dolthub/dolt:latest
docker run dolthub/dolt:latest version
docker pull dolthub/dolt:1.4.2
docker run dolthub/dolt:1.4.2 version
```

**SQL-server image** — `dolthub/dolt-sql-server` (equivalent to `dolt sql-server --host 0.0.0.0 --port 3306`):
```bash
docker run dolthub/dolt-sql-server:latest --help
```

Environment variables:
- `DOLT_ROOT_PASSWORD` — root account password
- `DOLT_ROOT_HOST` — root connection host (`%` = any host)

Key directories (volume mounts):
- `/etc/dolt/servercfg.d/` — single `.yaml` server config
- `/etc/dolt/doltcfg.d/` — single `.json` dolt config
- `/var/lib/dolt/` — data storage
- `/docker-entrypoint-initdb.d/` — `.sh`/`.sql` files run after server startup

Example:
```bash
docker run -e DOLT_ROOT_PASSWORD=secret2 -e DOLT_ROOT_HOST=% -p 3307:3306 \
  -v /path/to/server:/etc/dolt/servercfg.d \
  -v /path/to/dolt:/etc/dolt/doltcfg.d \
  -v /path/to/databases:/var/lib/dolt \
  dolthub/dolt-sql-server:latest
```
Port mapping: `-p HOST_PORT:3306`.

Kubernetes liveness/readiness probe:
```bash
dolt --host 127.0.0.1 --port 3306 --no-tls sql -q "select current_timestamp();"
```

> ⟦DoltGres note⟧ DoltGres has its own image(s) (verify name, e.g. a `doltgres` image) and uses port **5432**. The probe query (`select current_timestamp();`) is standard SQL but the client invocation is Postgres-flavored. Verify image names and env-var names for DoltGres.

---

## Installation — Upgrading
**Source:** https://www.dolthub.com/docs/introduction/installation/upgrading/
**Relevance:** [CORE]

Check version:
```bash
dolt version              # CLI
```
```sql
select dolt_version();    -- inside SQL server
```
Compare against the GitHub releases page.

**Upgrade:** download the latest binary for your platform and replace the `dolt` binary on your `PATH`. Re-running the platform install process does this for you.

**Gotcha:** if running a server, you must **restart the server** to use the new binary.

This page does *not* cover storage-format migrations (`dolt migrate`), per-version breaking changes, or package-manager upgrade commands.

> ⟦DoltGres note⟧ `dolt_version()` → DoltGres equivalent likely `doltgres_version()` or similar; verify. Upgrade-by-replacing-binary + restart-server pattern carries over.

---

## Getting Started — Overview
**Source:** https://www.dolthub.com/docs/introduction/getting-started/
**Relevance:** [CORE]

Three paths, each with its own page:
1. **Version Controlled Database** — "Run Dolt like you would MySQL or Postgres."
2. **Git for Data** — "Use the Dolt Command Line Interface like you would the Git Command Line Interface." *[LATER: DoltGit]*
3. **Versioned MySQL Replica** — "Use Dolt as a replica to your primary MySQL server to get version control features without migrating."

---

## Getting Started — As a Database
**Source:** https://www.dolthub.com/docs/introduction/getting-started/database/
**Relevance:** [CORE] (primary platform path) + [LATER: DoltGit] for branch/merge depth

**Setup & launch server:**
```bash
cd ~ && mkdir dolt && cd dolt
dolt sql-server                 # launches on port 3306
```
Connect from another terminal:
```bash
mysql --host 127.0.0.1 --port 3306 -u root
```

**Create database + schema** (MySQL types/syntax):
```sql
create database getting_started;
use getting_started;

create table employees (
    id int,
    last_name varchar(255),
    first_name varchar(255),
    primary key(id));

create table teams (
    id int,
    team_name varchar(255),
    primary key(id));

create table employees_teams(
    team_id int,
    employee_id int,
    primary key(team_id, employee_id),
    foreign key (team_id) references teams(id),
    foreign key (employee_id) references employees(id));

show tables;
```
> ⟦DoltGres note⟧ MySQL-flavored: `varchar(255)`, `int`, `use <db>`, `show tables` are MySQL idioms. DoltGres/Postgres equivalents: `\c <db>` or connect-time db selection, `\dt` to list tables, types like `integer`/`varchar`/`text`. Verify exact DoltGres syntax.

**Version control via stored procedures / system tables:**
```sql
call dolt_add('teams', 'employees', 'employees_teams');
call dolt_commit('-m', 'Created initial schema');
select * from dolt_log;          -- commit history
```

**Populate + query:**
```sql
insert into employees values
    (0,'Sehn','Tim'),(1,'Hendriks','Brian'),(2,'Son','Aaron'),(3,'Fitzgerald','Brian');
select * from employees where first_name='Brian';

insert into teams values (0,'Engineering'),(1,'Sales');

insert into employees_teams(employee_id, team_id) values
    (0,0),(1,0),(2,0),(0,1),(3,1);

select first_name, last_name, team_name from employees
    join employees_teams on (employees.id=employees_teams.employee_id)
    join teams on (teams.id=employees_teams.team_id)
    where team_name='Engineering';
```

**Inspect changes & commit:**
```sql
select * from dolt_status;       -- which tables changed
select * from dolt_diff_employees;
call dolt_commit('-am', 'Populated tables with data');
select * from dolt_diff;
```

**Recovery — undo an accidental drop:**
```sql
drop table employees_teams;
call dolt_reset('--hard');
show tables;
```

**Branching (in-SQL):**
```sql
call dolt_checkout('-b','modifications');
update employees SET first_name='Timothy' where first_name='Tim';
insert INTO employees (id, first_name, last_name) values (4,'Daylon','Wilkins');
insert into employees_teams(team_id, employee_id) values (0,4);
delete from employees_teams where employee_id=0 and team_id=1;
call dolt_commit('-am', 'Modifications on a branch');

select * from dolt_branches;
select active_branch();
select * from employees as of 'modifications';                 -- query a branch
select * from dolt_diff('main', 'modifications', 'employees');  -- compare branches
```

**Schema change on a branch:**
```sql
call dolt_checkout('-b', 'schema_changes');
alter table employees add column start_date date;
update employees set start_date='2018-09-08';
update employees set start_date='2021-04-19' where last_name='Fitzgerald';
call dolt_commit('-am', 'Added start_date column to employees');
```

**Merge:**
```sql
call dolt_checkout('main');
call dolt_merge('schema_changes');
call dolt_merge('modifications');
```

**Audit / lineage:**
```sql
-- full row history across commits
select * from dolt_history_employees where id=0 order by commit_date;

-- find commits where a specific cell changed
select to_commit, from_first_name, to_first_name from dolt_diff_employees
    where (from_id=0 or to_id=0)
      and (from_first_name <> to_first_name or from_first_name is NULL)
    order by to_commit_date;
```
> ⟦DoltGres note⟧ The `dolt_*` system tables/procedures (`dolt_log`, `dolt_status`, `dolt_diff*`, `dolt_history_*`, `call dolt_add/commit/checkout/merge/reset(...)`, `as of`, `active_branch()`) are the core version-control surface. DoltGres exposes equivalents but names/casing/calling convention may differ (Postgres uses `CALL`/functions differently; `as of` and system-table naming need verification). Preserve the *concepts*; verify exact identifiers.

---

## Getting Started — Git for Data (CLI)
**Source:** https://www.dolthub.com/docs/introduction/getting-started/git-for-data/
**Relevance:** [LATER: DoltGit] (CLI git-for-data depth) — core concept is [CORE]

Key concept: "Dolt is Git for Data. The Dolt command line works exactly like the Git command line except the versioning target is tables instead of files."

**Identity:**
```bash
dolt config --global --add user.name "Tim Sehn"
dolt config --global --add user.email "tim@dolthub.com"
```
**Init + history:**
```bash
mkdir git_for_data && cd git_for_data
dolt init
dolt log
```
**Import CSV (infer schema, set PK) + query:**
```bash
dolt table import --create-table --pk id employees employees.csv
dolt sql -q "show tables"
dolt sql -q "describe employees"
dolt sql -q "select * from employees"
```
**Stage / commit:**
```bash
dolt status
dolt add employees
dolt commit -m "Added new employees table containing the founders of DoltHub"
dolt commit -am "Added Daylon. Make Tim Timothy."   # combined add+commit
```
**Modify + diff:**
```bash
dolt sql -q "insert into employees values (3, 'Daylon', 'Wilkins')"
dolt sql -q "update employees set first_name='Timothy' where first_name='Tim'"
dolt diff
dolt diff main
```
**Rollback a table to HEAD:**
```bash
dolt checkout employees
```
**Branches (CLI + in-server SQL):**
```bash
dolt branch                 # list
dolt checkout modifications # switch
```
```sql
call dolt_checkout('-b','modifications');
insert INTO employees values (5,'Taylor', 'Bantle');
call dolt_commit('-am', 'Modifications on a branch');
```
**Server mode:**
```bash
dolt sql-server
```
**Merge + delete branch:**
```bash
dolt checkout main
dolt merge modifications
dolt branch -d modifications
```
> ⟦DoltGres note⟧ DoltGres CLI is `doltgres` and `dolt sql -q "..."` runs MySQL-flavored SQL; the embedded SQL strings (`show tables`, `describe`, types) need Postgres equivalents. The Git-style CLI verbs (init/add/commit/log/status/diff/branch/checkout/merge) are the universal model — verify they exist identically in DoltGres' CLI.

---

## Getting Started — Versioned MySQL Replica
**Source:** https://www.dolthub.com/docs/introduction/getting-started/versioned-mysql-replica/
**Relevance:** [CORE] for the *pattern*, but MySQL-specific — for DoltGres this becomes a **Postgres replica** pattern

Dolt can run as a MySQL replica: it replicates writes from a primary MySQL server and creates a **commit per transaction**, giving time-travel, lineage, and rollback on the replica.

**Primary MySQL prerequisites:**
- `BINLOG_FORMAT` = `ROW` (default in MySQL 8.0)
- `LOG_BIN` = `ON` (default in MySQL 8.0)
- `SERVER_ID` = any positive integer (default 1)

Enable GTIDs on the primary:
```sql
SET @@GLOBAL.ENFORCE_GTID_CONSISTENCY = ON;
SET @@GLOBAL.GTID_MODE = OFF_PERMISSIVE;
SET @@GLOBAL.GTID_MODE = ON_PERMISSIVE;
SET @@GLOBAL.GTID_MODE = ON;
```
Verify:
```sql
SHOW VARIABLES WHERE Variable_Name LIKE '%gtid_mode'
  OR Variable_Name LIKE '%enforce_gtid_consistency'
  OR Variable_Name LIKE '%binlog_format'
  OR Variable_Name LIKE 'server_id';
```
**Install Dolt + start server on a non-default port:**
```bash
sudo bash -c 'curl -L https://github.com/dolthub/dolt/releases/latest/download/install.sh | sudo bash'
mkdir dolt_replica && cd dolt_replica
dolt sql-server -P 1234 --loglevel=debug
```
**Configure the replica (connect to Dolt server):**
```bash
mysql -h 127.0.0.1 -P 1234 -u root
```
```sql
SET @@GLOBAL.SERVER_ID=2;
CHANGE REPLICATION SOURCE TO SOURCE_HOST='localhost', SOURCE_USER='root', SOURCE_PORT=3306;
START REPLICA;
```
Replication starts immediately; each transaction becomes a commit with the GTID in the message.

**Version-control usage on the replica:**
```sql
SELECT * FROM dolt_log;                                   -- commit per transaction
SELECT * FROM dolt_diff('commit_hash_1','commit_hash_2','table_name');
SELECT * FROM dolt_diff WHERE table_name='salaries' LIMIT 10;  -- find bad changes

CALL dolt_checkout('-b', 'revert_bad_change');
CALL dolt_revert('commit_hash');
SELECT * FROM dolt_patch('HEAD^', 'HEAD');                -- generate SQL to fix the primary
```
Combine the `dolt_patch` statements and apply to the primary MySQL to re-sync both systems.

> ⟦DoltGres note⟧ This entire flow is **MySQL binlog/GTID replication** — it does NOT translate directly to DoltGres. The DoltGres analogue would be **Postgres logical replication** (publications/subscriptions, WAL, replication slots), not `CHANGE REPLICATION SOURCE`/`START REPLICA`/GTID. Keep the *concept* (a version-controlled replica that commits per transaction) but the entire setup mechanism must be re-specified for Postgres. Do NOT carry these MySQL commands into DoltGres docs. Verify whether DoltGres currently supports a Postgres-replica mode at all.

---

### Cross-cutting gotchas captured
- Dolt commits need an author identity (`dolt config --global user.name/user.email`) — a server with no identity can't commit.
- Server must be **restarted** after a binary upgrade.
- `dolt_reset('--hard')` recovers from accidental drops/edits before commit.
- Branch/merge/diff are available both via **CLI** and via **in-SQL** `dolt_*` procedures/system tables — important for app-server (no shell) usage.

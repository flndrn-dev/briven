---
title: Dolt RDBMS + DoltHub — Concepts
source_urls:
  # Concepts → Dolt → RDBMS  [CORE — DoltGres runs as a server too]
  - https://www.dolthub.com/docs/concepts/dolt/rdbms/
  - https://www.dolthub.com/docs/concepts/dolt/rdbms/server/
  - https://www.dolthub.com/docs/concepts/dolt/rdbms/backups/
  - https://www.dolthub.com/docs/concepts/dolt/rdbms/replication/
  # Concepts → DoltHub  [LATER: DoltLab — collaboration model template]
  - https://www.dolthub.com/docs/concepts/dolthub/
  - https://www.dolthub.com/docs/concepts/dolthub/permissions/
  - https://www.dolthub.com/docs/concepts/dolthub/prs/
  - https://www.dolthub.com/docs/concepts/dolthub/issues/
  - https://www.dolthub.com/docs/concepts/dolthub/forks/
scope: >
  Source material for a future DoltGres docs section. The RDBMS pages document Dolt
  running as a SQL server (CORE — DoltGres runs as a server too). The DoltHub pages
  document the hosted collaboration service (LATER: DoltLab stage — DoltLab is the
  self-hostable DoltHub). Upstream docs describe Dolt (MySQL-flavored) + DoltHub;
  ⟦DoltGres note⟧ callouts flag where DoltGres uses the Postgres equivalent.
fetched: 2026-06-28
fetch_failures: none (all 9 pages fetched successfully)
---

# Dolt RDBMS + DoltHub — Concepts (source material for DoltGres docs)

> Upstream docs cover **Dolt (MySQL-compatible)** and **DoltHub** (the hosted service).
> Our target is **DoltGres (Postgres-flavored)**. RDBMS pages are tagged **[CORE]** because
> DoltGres also runs as a server. DoltHub pages are tagged **[LATER: DoltLab]** — they are
> the template for the future self-hosted DoltLab collaboration stage.

---

## 1. Dolt as a Relational Database (RDBMS) — [CORE]
Source: https://www.dolthub.com/docs/concepts/dolt/rdbms/

Dolt is a full RDBMS, not just a version-control tool for data. It ships a built-in
MySQL-compatible SQL server. You get a normal SQL database **plus** Git-style version
control over the data.

- **Access:** start the server with `dolt sql-server`, then run standard SQL.
- **MySQL compatibility:** existing MySQL clients and workflows work unchanged — Dolt
  speaks the MySQL protocol and dialect.
- **Backups (two mechanisms):**
  1. Remote-based — pushing to a remote backs up only *committed* changes (Git-like).
  2. Native `dolt backup` — also captures *uncommitted* changes (more complete).
  Both available via CLI (`dolt backup`) or the `dolt_backup()` SQL procedure.
- **Replication:** uses Git-style remotes. Primary does "push on write"; replicas do
  "pull on read." Version-control principles carry into replication.

> ⟦DoltGres note⟧ This whole page is MySQL-flavored. DoltGres is the **PostgreSQL**
> equivalent: it speaks the Postgres wire protocol and dialect instead of MySQL.
> The RDBMS-plus-version-control concept is identical; the SQL flavor differs.

---

## 2. Running Dolt as a SQL Server — [CORE]
Source: https://www.dolthub.com/docs/concepts/dolt/rdbms/server/

A SQL server lets multiple local and remote clients share one database over the network —
typical for backing application instances.

- **Start it:** `dolt sql-server`. Startup prints config (host, port, timeout, log level).
- **Defaults:** host `localhost`, port `3306` (same as MySQL), root user access.
- **Connect (MySQL client):**
  `mysql --host 127.0.0.1 --port 3306 -uroot`
- **Behaves like `mysqld`:** the server emits MySQL protocol headers and identifies
  itself as `"5.7.9-Vitess"`, so any MySQL-compatible client works.
- **Multi-client:** many clients connect simultaneously; server handles auth + connections.
- **Branch-based connections (distinctive Dolt feature):** you can connect to a specific
  **branch** via the connection string. All clients on the same branch see the same data
  state — version control is wired directly into connectivity.

> ⟦DoltGres note⟧ MySQL-flavored. DoltGres runs as a **Postgres** server instead:
> default port **5432** (not 3306), connect with `psql` (not the `mysql` CLI), and it
> presents itself over the Postgres wire protocol rather than identifying as a MySQL/Vitess
> server. The branch-in-connection-string concept carries over to DoltGres.

---

## 3. Backups — [CORE]
Source: https://www.dolthub.com/docs/concepts/dolt/rdbms/backups/

A backup is a copy of your database; you can restore the database to its state at backup time.

- **Use cases:** primarily disaster recovery (store backups on a separate host). Also handy
  for copying a DB for dev, test, and analytics.
- **Built-in history:** because Dolt keeps full commit history, the database is inherently
  somewhat self-backing — to restore a prior state on a live server you check out the DB
  at the desired commit.
- **Backups vs. remotes (two complementary strategies):**
  - **Remotes** — back up only *committed* changes (`dolt remote`, `dolt push`).
  - **Backups** — capture *committed and uncommitted* changes (`dolt backup`), so you can
    preserve in-progress/uncommitted work (e.g. for debugging).
- **Core commands:**
  - Add:     `dolt backup add backup1 file://../backups/backup1`
  - Sync:    `dolt backup sync backup1`
  - Restore: `dolt backup restore file://./backups/backup1 repo2`
- **Programmatic:** trigger via the `dolt_backup()` SQL procedure (automate on conditions).
- **MySQL backup methods:** Dolt does **not** support MySQL backup methods *except*
  `mysqldump`. You can produce dumps via `dolt dump` or by running `mysqldump` against a
  live Dolt server.

> ⟦DoltGres note⟧ MySQL-flavored. The `dolt backup` / remotes model is Dolt-native and
> should carry to DoltGres, but the SQL-dump interop is Postgres-flavored: expect
> `pg_dump`/`pg_restore`-style tooling rather than `mysqldump`. (Confirm exact DoltGres
> dump command/procedure names against current DoltGres docs — do not assume MySQL names.)

---

## 4. Replication — [CORE]
Source: https://www.dolthub.com/docs/concepts/dolt/rdbms/replication/

Replication synchronizes a primary (reads + writes) with read replicas (read-only).
Supports disaster recovery and horizontal read scaling.

- **Mode A — Remote-based replication:** primary and replicas share a Git-style remote.
  Primary = "push on write" (auto-syncs changes to the remote); replicas = "pull on read."
  Only **branch heads** replicate, so a new Dolt **commit** is what triggers replication.
- **Mode B — Direct-to-standby replication:** multiple `sql-server` instances replicate all
  writes directly to each other. One server is the write primary; others are read-only standbys.
- **Key config variables:**
  - `sqlserver.global.dolt_replicate_to_remote` — remote the primary pushes to.
  - `sqlserver.global.dolt_read_replica_remote` — remote a replica pulls from.
  - `sqlserver.global.dolt_replicate_heads` — which branches the replica syncs.
- **Setup:** clone the primary to create replicas, then set the remote + heads variables to
  establish the sync pattern.
- **MySQL binlog interop:** Dolt can **consume** MySQL binary-log replication (act as a
  replica for a MySQL/MariaDB primary). Dolt does **NOT** create binary logs and can **NOT**
  act as a primary for binlog replication.

> ⟦DoltGres note⟧ MySQL-flavored on the binlog interop only. The Dolt-native remote-based
> and direct-to-standby modes are the version-control mechanism and should carry to DoltGres.
> The MySQL/MariaDB binlog-consumer detail does not apply to a Postgres world — the Postgres
> equivalent would be logical/streaming replication interop (verify against DoltGres docs;
> do not assume it exists).

---

## 5. DoltHub — the hosted collaboration service — [LATER: DoltLab]
Source: https://www.dolthub.com/docs/concepts/dolthub/

DoltHub is a web interface to **share, discover, and collaborate on** Dolt databases —
positioned as "GitHub for data."

- **Problem it solves:** stop emailing CSVs back and forth; establish **one source of truth**.
  Users clone, modify, and open pull requests to merge into the main branch.
- **Collaboration model (GitHub paradigm):** fork or branch a database, propose changes via
  pull requests; maintainers review **diffs** and discuss in integrated forums.
- **Accessibility:** non-SQL users can edit data via table-interface buttons that generate the
  SQL for them (teaches SQL while they work).
- **Transparency & safety:** every cell change is a timestamped commit with author attribution
  — easy to audit history and find bad edits; branching/forking is low-risk with easy rollback.
- **DoltLab:** the self-hosted, on-premises version — same features, "data never leaves your
  control," runs via Docker Compose on your own infrastructure.

> ⟦Stage note⟧ This is the template for our **LATER: DoltLab** stage. DoltLab is the
> self-hostable DoltHub — that is the path to offering this collaboration layer on Briven's
> own infrastructure rather than a third-party host.

---

## 6. Permissions — [LATER: DoltLab]
Source: https://www.dolthub.com/docs/concepts/dolthub/permissions/

Tiered access control, keyed to account type. Databases default to **public** (anyone can view).
DoltHub Pro accounts can create **private** databases ("free up to 1GB/month, $50/month after").

- **Permission levels:**
  - **Read** — view tables, run read-only SQL, clone, fork, create issues and pull requests.
  - **Write** — edit table data + docs, merge PRs, run SQL, import files, push changes.
    *Cannot* change database settings or manage collaborators.
  - **Admin** — full control; edit any data or settings in a database.
- **Collaborator management:**
  - User-owned DBs: only explicitly added collaborators (via settings form) can access private DBs.
  - Organization-owned DBs: all org members get read on public + private DBs; org owners get admin
    on all org DBs.
- **Org-based control:** teams can be made collaborators on specific databases for granular
  permissions — "an extra layer of control even within your organization."

> ⟦Stage note⟧ The role model (read / write / admin) + org/team collaborators is the access-control
> blueprint to replicate in DoltLab. Pricing tiers are DoltHub-the-hosted-product specifics, not
> structural — ignore for the self-hosted design.

---

## 7. Pull Requests (on data) — [LATER: DoltLab]
Source: https://www.dolthub.com/docs/concepts/dolthub/prs/

PRs propose database modifications. "Pull requests are created from a branch with new changes
that a user would like to make to another branch (commonly the `main` or `master` branch)."

- **Create:** make changes on a branch or fork → open the PR form → pick a base branch.
  Title required; description optional.
- **Review:** reviewers examine the **diff** and discuss improvements before approval.
- **Merge:** on approval the base branch takes the feature branch's changes; commits join main history.
- **Data-focused diffs (vs GitHub code diffs):** DoltHub "compares changes to data tables" rather
  than files. Big diffs are normal for data ("rare to have a PR on GitHub with a file containing
  thousands of line changes, while this is much more common for data tables"). Reviewers can focus
  on one table at a time and **filter by added / deleted / modified rows**.
- **Worked example:** the docs use `dolthub/us-schools` — fork, branch, modify via SQL, commit,
  push to DoltHub, open PR, review, merge.

> ⟦Stage note⟧ The data-aware diff (per-table, filter by added/deleted/modified rows) is the
> standout collaboration feature to carry into DoltLab — it's what makes "PRs on data" meaningful.

---

## 8. Issues — [LATER: DoltLab]
Source: https://www.dolthub.com/docs/concepts/dolthub/issues/

Issues track bugs, ask questions, and document data nuances — for "tracking future work" and
"open and transparent communication with database owners."

- **Primary uses:** track upcoming work; transparent dialogue between contributors and maintainers;
  collaboratively find and fix data problems.
- **Vs GitHub issues (currently simpler):** GitHub's cross-referencing issues↔PRs, auto-close on
  merge, user assignment, and labels are noted as "on our DoltHub roadmap" — not yet present.
- **Workflow:** a contributor spots an inconsistency and opens an issue; another user fixes it via a
  PR and comments on the issue to notify everyone. Comments trigger notifications to the issue creator
  and participants — transparent discussion + a permanent record of problems and solutions in the repo.

> ⟦Stage note⟧ Minimal issue tracker (create, comment, notify) is enough for an MVP DoltLab stage;
> labels/assignment/auto-close are nice-to-haves to defer.

---

## 9. Forks — [LATER: DoltLab]
Source: https://www.dolthub.com/docs/concepts/dolthub/forks/

A fork is a copy of a database under your namespace, letting you control who can modify your data and
what gets merged back. "You can continue to pull changes from the database that you forked from, and
you can submit pull requests back to it."

- **Use cases:**
  1. Propose changes to a DB where you lack write permission.
  2. Experiment with / adopt someone else's DB without touching the original.
- **Workflow:**
  - Click **Fork** to copy a DB into your namespace.
  - Clone locally: `dolt clone [username]/[database-name]`.
  - Modify on DoltHub or via CLI.
  - To propose changes, open a PR linking your fork back to the original.
- **PR integration:** PRs bridge fork → upstream — submit for the base owner's review, request changes
  before merge, and pull upstream changes into your fork via the PR form.
- **Relationship to GitHub:** "GitHub forks are very similar to DoltHub forks in both purpose and
  practice."

> ⟦Stage note⟧ Fork + upstream-PR is the open-contribution model for DoltLab. Note `dolt clone`
> is Dolt-native CLI and carries over; ⟦DoltGres note⟧ confirm the DoltGres clone command name
> against current DoltGres docs (likely the same `dolt`-family CLI, but verify).

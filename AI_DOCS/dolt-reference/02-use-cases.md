---
title: Dolt / DoltGres Use Cases
group: Use cases
purpose: Source material for the DoltGres docs "Use cases" section. Distilled from DoltHub's Dolt (MySQL-flavored) use-case docs; captures the WHY/WHEN of each use case for our Postgres-flavored DoltGres data plane (Briven).
scope: |
  These pages document Dolt (MySQL-flavored). Our target is DoltGres (Postgres-flavored). Use cases are
  product-agnostic — the value proposition (branch/diff/merge/clone for a SQL database) is identical. Where a
  page references MySQL-specific behavior or SQL, it is flagged with a DoltGres note. Relevance tags:
  [CORE] = applies to DoltGres now; [LATER: DoltGit] = depends on a Git-platform layer; [LATER: DoltLab] =
  depends on a self-hosted review/PR platform.
source_urls:
  - https://www.dolthub.com/docs/introduction/use-cases/
  - https://www.dolthub.com/docs/introduction/use-cases/data-sharing/
  - https://www.dolthub.com/docs/introduction/use-cases/data-and-model-quality/
  - https://www.dolthub.com/docs/introduction/use-cases/manual-data-curation/
  - https://www.dolthub.com/docs/introduction/use-cases/vc-your-app/
  - https://www.dolthub.com/docs/introduction/use-cases/versioned-replica/
  - https://www.dolthub.com/docs/introduction/use-cases/audit/
  - https://www.dolthub.com/docs/introduction/use-cases/configuration-management/
  - https://www.dolthub.com/docs/introduction/use-cases/offline-first/
fetched: 2026-06-28
---

# Dolt / DoltGres — Use Cases

> Cross-cutting note for the whole section: every use case below rests on the same primitives —
> a SQL database you can **branch, diff, merge, clone, push, and pull** like Git. Dolt's pitch is
> "anything you can build with MySQL or Postgres you can build with Dolt." For DoltGres the equivalent
> is: anything you build on Postgres, you build on DoltGres — plus version control.
>
> ⟦DoltGres note⟧ All Dolt pages assume MySQL wire protocol and MySQL SQL dialect. DoltGres speaks the
> Postgres wire protocol and Postgres SQL dialect, so wherever a page says "MySQL-compatible" read
> "Postgres-compatible," and any MySQL-specific SQL must be translated to its Postgres equivalent.

---

## Overview — Use Cases index
URL: https://www.dolthub.com/docs/introduction/use-cases/
Relevance: **[CORE]** (the framing applies directly to DoltGres)

The overview lists eight use cases and frames Dolt as a drop-in versioned SQL database. The core
differentiator: Dolt shines whenever a database benefits from Git-style **branches, merges, diffs, or
clones**. Tagline: "anything you can build with MySQL or Postgres you can build with Dolt."

The eight use cases:

1. **Data Sharing** — the original design purpose; collaborative distribution of datasets.
2. **Data and Model Quality Control** — build reproducibility into ML models via versioned data/artifacts.
3. **Manual Data Curation** — ensure data quality with a pull-request review workflow.
4. **Version Control for your Application** — Git-style branch/merge/diff at the database layer of an app.
5. **Versioned MySQL Replica** — keep a replica of MySQL with full version history (not just point-in-time recovery).
6. **Audit** — an immutable, queryable audit log of every change.
7. **Configuration Management** — manage complex config (e.g., video-game config) as versioned tables.
8. **Offline First** — local writes offline, synced (with conflict detection) when connectivity returns.

> ⟦DoltGres note⟧ Page #5 names "MySQL Replica" specifically — for DoltGres this becomes a
> **versioned Postgres replica** (depends on Postgres logical replication support; see that section).

No SQL examples on this page.

---

## Data Sharing
URL: https://www.dolthub.com/docs/introduction/use-cases/data-sharing/
Relevance: **[CORE]** for clone/push/pull/diff; **[LATER: DoltGit]** for the hosted fork/permissions/review layer (DoltHub equivalent)

**Why / what problem it solves.** Distributing data to customers or consuming data from vendors is hard:
- Consumers need **visibility into what changed** between versions.
- Teams want to **actively choose** when to switch versions, not be surprised by silent updates.
- It's hard to keep **quality** of scraped or vendor-supplied data high.
- Shared data needs **automated testing/validation** before it's trusted.
- Need a **rollback** path when a new version turns out to be bad.

**When to use it.**
- Distributing data to customers, offering version options for fast- vs. slow-moving adopters.
- Importing vendor data that must be **inspected before** it reaches production.
- Treating data dependencies the way you treat software dependencies (pin, review, upgrade deliberately).

**How Dolt's features enable it.**
- **Git-style version control:** every party gets their own read/write copy; collaboration is decentralized and asynchronous.
- **DoltHub coordination:** permissions, human review, forks, and distributed collaboration tooling. *(This is the hosted-platform layer — DoltGit/DoltLab equivalent for DoltGres.)*
- **Diff examination:** review changes "either with the human eye or programmatically, before putting the data into production."
- **Branch/merge workflow:** import data on a branch, examine the diff, merge only after validation — or roll back if a problem appears after deployment.
- **Schema preserved on exchange:** unlike file exports, Dolt carries the schema including constraints, triggers, and views.

**Named adopters:** Bitfinex, KAPSARC.

No literal SQL/CLI examples were present on the page.

---

## Data and Model Quality (Control)
URL: https://www.dolthub.com/docs/introduction/use-cases/data-and-model-quality/
Relevance: **[CORE]** for branches/commits/tags/diffs; **[LATER: DoltLab]** for the PR review workflow (DoltHub/DoltLab/Hosted Workbench)

**Why / what problem it solves.** Teams building data and ML models need to:
- Apply human or automated **review** to data changes.
- Guarantee **model reproducibility** across versions.
- Run **parallel work** on different versions of the data.
- Manage **long-running projects** with concurrent modifications.
- **Query or instantly roll back** to previous data states.

**How Dolt solves it (four capabilities).**
1. **Model reproducibility:** tag a commit and reference that tag in model metadata. Because "Dolt shares storage between versions," you can keep many more copies of the data than copying full snapshots to S3.
2. **Data quality through review:** pull-request workflows (in DoltHub, DoltLab, Hosted Workbench) gate data changes before production; roll back instantly if a bad change lands.
3. **Parallel data projects:** branches let long-running feature work proceed without touching production pipelines. Quote: "Companies use Dolt branches to increase the number of parallel data projects by an order of magnitude."
4. **Model insights:** use commits, logs, and diffs to explain model behavior — e.g., "Did Thursday's model perform better than Tuesday's but had the same model weights? Inspect the data diff to see what changed."

**What it replaces.**
- **Cloud-storage snapshot copies** (S3, etc.) — Dolt's delta/shared storage is far more space-efficient.
- **Plain databases** (MySQL, Postgres, MongoDB) — same querying, plus versioning/branching/merge.

No literal SQL/CLI examples were present on the page.

---

## Manual Data Curation
URL: https://www.dolthub.com/docs/introduction/use-cases/manual-data-curation/
Relevance: **[CORE]** for branch/diff/clone/server; **[LATER: DoltLab]** for PR mechanism + spreadsheet/web editor UI (DoltHub/DoltLab equivalent)

**Why / what problem it solves.** Teams curating production data in spreadsheets ("Are you using
spreadsheets to curate production data?") hit:
- Hard-to-manage merged changes and reviews across a team.
- Production incidents caused by bad manual edits.
- No real **human-review** mechanism for cell-level changes.

**How Dolt solves it.**
- **Branch-based workflow:** isolate changes on a branch before review.
- **Pull requests** for data changes (via DoltHub/DoltLab).
- **Human-readable data diffs** to inspect every change.
- **CI/CD** to validate data modifications automatically.
- **Concurrent contributions** from multiple people.
- **Three editing surfaces** for technical and non-technical users: SQL queries, CSV upload, and a spreadsheet-style editor.
- **Low-friction production deploy:** because Dolt is a MySQL-compatible database, you clone the repo and run a server for developer access.
  > ⟦DoltGres note⟧ MySQL-flavored here; DoltGres is Postgres-compatible — clone and run a Postgres-wire server instead.

**What it replaces.** Excel / Google Sheets for manual curation — adds versioning, async collaboration,
and structured review while staying usable by non-technical contributors.

**Named adopters:** Annalise, Briya, Aktify, Blonk Sustainability (and others; an Aktify case study exists).

No literal SQL/CLI examples were present on the page.

---

## Version Control Your Application
URL: https://www.dolthub.com/docs/introduction/use-cases/vc-your-app/
Relevance: **[CORE]** — this is the headline DoltGres use case (version control as a database feature your app calls)

**Why / what problem it solves.** Applications increasingly need, for their *data*, the things Git gives
*code*:
- Customer-facing **branches and merges** inside the app.
- **Change review** before deployment, plus **pull requests**.
- **Audit logging** and **rollback**.

**How Dolt solves it.** Provides "branch, diff, and merge at the database layer," accessed programmatically:
- **SQL procedures, functions, and system tables** to drive version-control operations alongside normal SQL.
  > ⟦DoltGres note⟧ MySQL-flavored; DoltGres exposes the Postgres equivalents (e.g., functions/procedures and `dolt_*` system tables in Postgres syntax).
- **Standard RDBMS features:** replication, backups, hot standby, failover (like MySQL/Postgres).
- **Hosted option:** cloud deployment via Hosted Dolt.

**What it replaces (two common app patterns).**
- **Soft deletes:** instead of flagging rows invalid, Dolt's non-destructive writes remove the need — "queries against soft deleted rows become Dolt history queries."
- **Slowly Changing Dimension (SCD):** instead of adding versioning columns, "Dolt is slowly changing dimension on every table by default." Custom merge logic moves out of app code into the database layer.

**Named adopters:** Threekit, Network To Code, FJA, Idearoom (case studies: Nautobot, Turbine).

No literal SQL/CLI examples were present on the page.

---

## Versioned Replica (Versioned MySQL Replica)
URL: https://www.dolthub.com/docs/introduction/use-cases/versioned-replica/
Relevance: **[CORE]** as a concept (a versioned read replica of your primary); replication mechanism is **MySQL-specific** and needs a Postgres equivalent for DoltGres

**Why / what problem it solves.** Production primaries are exposed to:
- **Data loss** from operator error with weak safeguards.
- **Slow recovery** — a bad query/script/deploy can mean hours or days of downtime to restore.
- **Backup uncertainty** — is the backup actually good?
- **Audit requirements** — need an immutable, queryable change log.
- **Data accessibility** — hard to copy production for analytics/dev/debugging.

**How it works.** "Because Dolt is MySQL-compatible, you can set Dolt up as a versioned replica of your
MySQL primary." Each transaction on the primary becomes **a Dolt commit** on the replica, giving you:
- A **full, queryable audit trail** of every cell.
- **Transaction-level diffs**.
- **Targeted rollback:** find the bad transaction and "produce a SQL patch" to apply back to production.
- **Conflict detection** surfaced for manual resolution.
- **Read-only serving** in the MySQL replica serving path.

> ⟦DoltGres note⟧ This use case is built on **MySQL binlog replication** (Dolt consumes the primary's
> binlog). For DoltGres the equivalent would be consuming **PostgreSQL logical replication / WAL** from a
> Postgres primary. Treat the *concept* as CORE but the *replication transport* as not-yet-equivalent —
> verify DoltGres's Postgres-replica support before promising it.

**Advantages over alternatives.**
- **vs. backups + transaction logs:** avoids the long reinstall-and-replay recovery; roll back a single transaction instead.
- **vs. Change Data Capture (CDC):** consumes the replication log like CDC but is simpler to operate.

**Related resources referenced:** Binlog Replication docs, Getting Started guide, Hosted Dolt.

No literal SQL/CLI examples were present on the page.

---

## Audit
URL: https://www.dolthub.com/docs/introduction/use-cases/audit/
Relevance: **[CORE]** — built-in queryable audit log is a native DoltGres capability

**Why / what problem it solves.** Organizations must track **who changed what, when, and why** for
compliance and accountability:
- **Immutable** history from the database's inception.
- Audit logs **queryable as ordinary tables**.
- **Efficient storage** of long-term change history.
- **Compliance** documentation.

**How Dolt solves it.** Dolt is "a built-in, queryable audit log of every cell in your database." Each
commit automatically records: user identity, timestamp, optional commit message, and the changed data.
Storage is efficient because "only the differences are stored between versions of the data," enabling
long retention.

**How you query it.** Audit data is reachable "using standard SQL using custom Dolt system tables and
functions," filterable and joinable with your other tables.
> ⟦DoltGres note⟧ MySQL-flavored system tables/functions (e.g. `dolt_log`, `dolt_history_*`, `dolt_diff_*`,
> `dolt_blame_*`). DoltGres exposes the Postgres-dialect equivalents.

**Alternative without migrating your primary.** Run Dolt as a **versioned replica** of MySQL to get "a
queryable log of every cell" — but you lose the user/commit-message metadata that native commits carry.

**Compared solutions.**
- **Soft deletes:** weaker — they mark data inactive instead of versioning it; Dolt's commit-based log is harder to alter retroactively.
- **CDC:** CDC tools consume replication logs for auditing; Dolt makes it a built-in feature when it's your production database, removing the need for a separate audit system.

No literal SQL/CLI examples were present on the page (system tables/functions named only).

---

## Configuration Management
URL: https://www.dolthub.com/docs/introduction/use-cases/configuration-management/
Relevance: **[CORE]** for modeling config as versioned tables + diffs; **[LATER: DoltLab]** for PR-based human review

**Why / what problem it solves.** Configuration management struggles when:
- Config is "too big and complex for files" and behaves more like code than static data.
- Changes have large production impact and need rigorous **review**.
- **Merging** multiple config changes is hard.
- Standard VCS handles **unordered formats** (YAML/JSON) poorly.

**How Dolt solves it.** Model configuration **as tables** instead of text files:
- **Structural fit:** tables are unordered — semantically right for config; JSON columns hold loosely-typed sections when needed.
- **Version-control features:** "branches, diffs, and human review via pull requests," now applied to structured data; tables give "large fine-grained diffs" that text formats can't produce reliably.
- **Queryable:** config in tables is queryable, and a **build process** can emit "whatever format your game needs" at deploy time.

**What it replaces.** Config files in Git or git-lfs. git-lfs hides diffs for large files; Dolt restores
diff visibility and adds query capability.

**Context / adopters:** Especially popular in **video games** (mechanics and balance parameters as config
data). Named adopters: Scorewarrior, PhanXgames.

No literal SQL/CLI examples were present on the page.

---

## Offline First
URL: https://www.dolthub.com/docs/introduction/use-cases/offline-first/
Relevance: **[CORE]** — clone/fetch/push/pull + merge/conflict model are native; peer/remote sync depends on a remotes endpoint

**Why / what problem it solves.** Offline-capable apps must:
- Write data **locally while disconnected**.
- **Synchronize** those writes to a central server or peer when back online.
- **Detect conflicting writes**.
- **Resolve conflicts**.

**How Dolt solves it.** Applies Git's decentralized model to SQL: "Just like Git is ideal in no
connectivity environments when dealing with files, Dolt is ideal in low connectivity environments when
dealing with tables."

Key capabilities:
1. **Disconnected writes** — full SQL offline, identical to a centralized deployment.
2. **Efficient sync** — "Dolt computes the difference between what you have and what a peer database has and only sends these differences both ways."
3. **Git workflow** — clone, fetch, push, pull replace custom sync code.
4. **Conflict detection & resolution** — conflicts "are surfaced quickly and an operator or software can take additional action to resolve."
5. **Complete audit trail** — every user/peer keeps a "synchronized view with complete, auditable edit history."

**What it replaces.** Custom synchronization logic, which is "complicated and hard to get right."

No SQL examples or specific CLI commands were present on the page.

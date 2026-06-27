---
title: DoltGres Truth (authoritative facts for beta-v1 docs)
scope: DoltGres's OWN (Postgres-flavored) reality — NOT the MySQL Dolt reference. Every fact marked CONFIRMED (with source) or UNCONFIRMED.
fetched: 2026-06-28
sources_actually_fetched:
  - https://raw.githubusercontent.com/dolthub/doltgresql/main/README.md  (DoltGres GitHub README, repo = dolthub/doltgresql)
  - https://www.doltgres.com/docs/reference/version-control/dolt-sql-functions  (official docs; docs.doltgres.com 301-redirects here)
  - https://www.doltgres.com/docs/reference/version-control/dolt-system-tables
  - https://www.doltgres.com/docs/reference/version-control/querying-history
  - https://www.doltgres.com/docs/reference/sql-support/supported-types/
  - https://www.dolthub.com/blog/2025-04-16-doltgres-goes-beta/   (Beta launch, Apr 2025)
  - https://www.dolthub.com/blog/2025-10-16-state-of-doltgres/    (State of DoltGres, Oct 2025 — freshest)
  - https://www.dolthub.com/blog/2024-07-30-re-introducing-dolt-functions/  (calling-convention rationale)
note: A few doc pages copy MySQL-Dolt examples verbatim (e.g. a `postgres://...:3306/...` connection string still shows MySQL's port). Where that happens it is flagged inline; the verified DoltGres port is 5432.
---

# 1. DoltGres in one paragraph

DoltGres (repo name **`dolthub/doltgresql`**, product name "DoltgreSQL" / "Doltgres") is the **Postgres-flavored version of Dolt** — a SQL database that you can "branch and merge, fork and clone, push and pull just like a Git repository," but speaking the **PostgreSQL wire protocol and SQL dialect** instead of MySQL's. It is built by the same team (DoltHub) on the same versioned storage engine as Dolt, but it is a **separate, younger product**: Dolt is GA/production-grade, DoltGres is **Beta** (as of the Oct 2025 "State of Doltgres" it is still pre-1.0, with 1.0 targeted ~Oct 2026). DoltHub frames Beta as "you can begin building a production solution," while warning that "some Postgres features aren't implemented yet, there will be bugs, and performance is worse than it will be in a year" (benchmarked ~5.2× slower than stock Postgres). **Critical for docs: Dolt ≠ DoltGres.** Dolt's version-control surface is invoked with `CALL DOLT_COMMIT(...)`; DoltGres re-implements the same operations as **functions called with `SELECT dolt_commit(...)`**, because Postgres permits side-effects inside `SELECT`.

# 2. Install & run (verified)

All CONFIRMED via the GitHub README (`dolthub/doltgresql`).

- **Binary name:** `doltgres` (single binary).
- **Linux/Mac install:**
  ```bash
  sudo bash -c 'curl -L https://github.com/dolthub/doltgresql/releases/latest/download/install.sh | bash'
  ```
- **Windows:** download the `.msi` from the GitHub releases page and run it.
- **Docker:**
  ```bash
  docker run -e DOLTGRES_PASSWORD=myPassword -p 5432:5432 dolthub/doltgresql:latest
  ```
- **From source:** `./scripts/build.sh`.
- **Start the server:** run `doltgres`. On first run it creates a default user **`postgres`** and a default database **`postgres`**, password **`password`**. Override before first run with env vars **`DOLTGRES_USER`** and **`DOLTGRES_PASSWORD`**.
- **Default port:** **5432** (standard Postgres port, Postgres wire protocol). CONFIRMED.
- **Connect with psql:**
  ```bash
  PGPASSWORD=password psql -h localhost -U postgres
  ```

# 3. Version control in DoltGres (verified)

The headline rule (CONFIRMED — docs + the 2024-07-30 "Re-introducing Dolt Functions" blog):

> **In DoltGres the version-control operations are FUNCTIONS, invoked with `SELECT`, NOT `CALL`.**
> DoltGres: `SELECT DOLT_CHECKOUT('-b', 'my-new-branch');`
> Dolt(MySQL): `CALL DOLT_CHECKOUT('-b', 'my-new-branch');`
> Rationale: Postgres allows side-effects inside `SELECT` (like `nextval()`), MySQL does not.
> A future table-function form `SELECT * FROM DOLT_CHECKOUT(...)` is **planned but NOT yet enabled** (work in progress). UNCONFIRMED whether shipped yet.

## 3a. Mutating functions — `SELECT dolt_xxx(...)` — CONFIRMED (docs: dolt-sql-functions)
Each returns a small result (status int and/or hash/message text).

| Function | Example | Returns |
|---|---|---|
| `dolt_add` | `SELECT DOLT_ADD('-A');` / `SELECT DOLT_ADD('t1','t2');` | `status` int |
| `dolt_commit` | `SELECT DOLT_COMMIT('-a','-m','msg');` | `hash` text |
| `dolt_checkout` | `SELECT DOLT_CHECKOUT('-b','feat');` | `status`, `message` |
| `dolt_branch` | `SELECT DOLT_BRANCH('-c','main','feat');` | `status` |
| `dolt_merge` | `SELECT DOLT_MERGE('feat','--no-ff','-m','msg');` | `hash`,`fast_forward`,`conflicts`,`message` |
| `dolt_reset` | `SELECT DOLT_RESET('--hard','abc123');` | `status` |
| `dolt_tag` | `SELECT DOLT_TAG('v1','HEAD');` | `status` |
| `dolt_clone` | `SELECT DOLT_CLONE('file:///path/.dolt/noms');` | `status` |
| `dolt_push` / `dolt_pull` / `dolt_fetch` | `SELECT DOLT_PUSH('origin','main');` | status/conflicts/message |
| `dolt_revert`, `dolt_rebase`, `dolt_cherry_pick`, `dolt_rm`, `dolt_clean`, `dolt_remote`, `dolt_stash`, `dolt_conflicts_resolve`, `dolt_backup`, `dolt_gc`, `dolt_verify_constraints`, `dolt_undrop`, `dolt_purge_dropped_databases` | all `SELECT DOLT_xxx(...)` | status/etc |

## 3b. Informational (read-only) functions — CONFIRMED
`ACTIVE_BRANCH()`, `DOLT_MERGE_BASE()`, `DOLT_HASHOF()`, `DOLT_HASHOF_TABLE()`, `DOLT_HASHOF_DB()`, `DOLT_VERSION()`, `HAS_ANCESTOR()`, `DOLT_COUNT_COMMITS('--from','feat','--to','main')`.

## 3c. Table functions (return rows) — CONFIRMED
`DOLT_DIFF()`, `DOLT_DIFF_STAT()`, `DOLT_DIFF_SUMMARY()`, `DOLT_LOG()`, `DOLT_PATCH()`, `DOLT_REFLOG()`, `DOLT_SCHEMA_DIFF()`, `DOLT_QUERY_DIFF()`, `DOLT_PREVIEW_MERGE_CONFLICTS()`.

## 3d. System tables — CONFIRMED (docs: dolt-system-tables)
DoltGres exposes version-control state as **`dolt` schema tables**, with a `dolt_`-prefixed alias for each:
```sql
SELECT * FROM dolt.branches;     -- also usable as dolt_branches
SELECT * FROM dolt.log;          -- commit history (reachable from HEAD)
SELECT * FROM dolt.commits WHERE date < '2024-12-02';
SELECT * FROM dolt.status;       -- staged/working changes
SELECT * FROM dolt.diff;
SELECT * FROM dolt.remotes;
SELECT * FROM dolt.tags;
```
Per-table system tables live in the user schema (unqualified or `public.`-qualified):
```sql
SELECT * FROM dolt_diff_employees WHERE diff_type='modified';
SELECT * FROM dolt_history_mytable;
SELECT * FROM dolt_commit_diff_mytable;   -- diff between any two commits, even across branches
SELECT * FROM dolt_conflicts_mytable;
SELECT * FROM public.dolt_blame_employees LIMIT 5;
```
> NOTE: this is the MAIN Postgres-specific divergence vs Dolt — DoltGres uses the **`dolt.` schema** namespace (with `dolt_` aliases). Dolt(MySQL) has only the `dolt_` prefixed tables.

## 3e. AS OF / time travel — CONFIRMED (docs: querying-history)
SQL:2011-style `AS OF`; the operand must be a valid Dolt ref (commit hash, branch name) or a timestamp:
```sql
SELECT * FROM myTable AS OF 'kfvpgcf8pkd6blnkvv8e0kle8j6lug7a';  -- commit hash
SELECT * FROM myTable AS OF 'myBranch';                          -- branch
SELECT * FROM myTable AS OF TIMESTAMP('2020-01-01');             -- timestamp
SHOW CREATE TABLE myTable AS OF 'myBranch';
```
Each table in a query may use a different `AS OF`.

## 3f. Branch / revision selection — CONFIRMED (docs: querying-history)
Three ways:
1. **In-session checkout:** `SELECT dolt_checkout('-b','old-view-def','81223g1...');`
2. **Revision-qualified database name** (read-only snapshot): `USE mydb/ia1ibijq8hq1...` or in the connection string `postgres://host:5432/mydb/<revision>`.
   > Doc example literally shows `...:3306/mydb/<rev>` (copied from MySQL-Dolt); the correct DoltGres port is **5432**.
3. Each branch behaves like a long-running, write-isolated transaction.

# 4. Postgres dialect specifics (CONFIRMED vs UNCONFIRMED)

| Area | DoltGres reality | Status | Source |
|---|---|---|---|
| **Types — fully** | int2/4/8, float4/8, text, varchar, boolean, uuid, interval, all array variants, oid/regclass/regproc/regtype | CONFIRMED | supported-types |
| **Types — partial** | numeric/decimal, bytea, char, json, jsonb, date/time/timestamp/timestamptz/timetz (precision parsed but **not enforced**) | CONFIRMED | supported-types |
| **Types — NOT supported** | `SERIAL`/`smallserial`/`bigserial`, range types, geometric (point/line/box…), network (inet/cidr/macaddr), tsvector/tsquery, xml, money | CONFIRMED | supported-types |
| **Roles / grants** | `CREATE USER`, `CREATE ROLE`, `GRANT <roles> TO <users> [WITH ADMIN OPTION]` supported; users/roles/permissions are versioned. Missing: column-level privileges, object types beyond tables, "assume another user". | CONFIRMED | beta blog + access-mgmt search |
| **Sequences** | Sequences + sequence functions supported. But `ALTER SEQUENCE` (and `COMMENT ON`) **not yet** supported. | CONFIRMED | beta blog |
| **GENERATED … IDENTITY** | Not stated; SERIAL is explicitly unsupported. | UNCONFIRMED | — |
| **Triggers** | Row-level `CREATE FUNCTION RETURNS trigger` + `CREATE TRIGGER` supported (first major post-Beta feature). **STATEMENT-level triggers NOT supported.** Triggers are versioned. | CONFIRMED | state-of-doltgres (Oct 2025) |
| **Procedures (CALL, $$ bodies)** | User-defined functions + procedures listed as supported at Beta; but Oct 2025 says stored procedures are "almost done… not yet complete." Treat full `CALL`/`$$` procedure support as partial. | UNCONFIRMED (partial) | beta blog vs state-of |
| **Extensions** | Native extension support added (late update) — PostGIS, uuid-ossp can load. (Beta blog had said unsupported; Oct 2025 reverses this.) | CONFIRMED (as of Oct 2025) | state-of-doltgres |
| **`ON CONFLICT`, `INSERT … RETURNING`** | Supported | CONFIRMED | beta blog |
| **`pg_catalog`** | Supported (with gaps) | CONFIRMED | beta blog |
| **Domain types** | User-defined domain types supported | CONFIRMED | beta blog |
| **CTEs (`WITH`)** | Unsupported at Beta (Apr 2025); no later confirmation of support | UNCONFIRMED (likely still no) | beta blog |
| **Window functions** | Unsupported at Beta; no later confirmation | UNCONFIRMED (likely still no) | beta blog |
| **Collations** | Currently ignored | CONFIRMED | beta blog |
| **Views** | Not explicitly addressed in fetched DoltGres sources | UNCONFIRMED | — |
| **Transactions / isolation levels** | Not documented for DoltGres; a branch acts as a long-running write-isolated transaction. No statement of READ COMMITTED/REPEATABLE READ/SERIALIZABLE support. | UNCONFIRMED | — |
| **GUCs (SET / current_setting / pg_settings)** | Not covered in fetched sources (Dolt has system variables; DoltGres GUC parity unverified) | UNCONFIRMED | — |

# 5. Beta limitations / not-yet-supported (sourced)

From the GitHub README + Apr-2025 Beta blog + Oct-2025 State-of:
- No Git-style **CLI** for version control — SQL interface only. (README)
- **Cannot push to DoltHub or DoltLab**; only custom remotes (filesystem, S3). (README)
- **Backup & replication** are works in progress. (README)
- **No GSSAPI** auth. (README)
- **STATEMENT-level triggers** not supported (row-level works). (state-of)
- **Stored procedures** not fully complete as of Oct 2025. (state-of)
- **CTEs (`WITH`), window functions, custom operators/indexing/aggregates** unsupported at Beta. (beta blog)
- **Multiple-table UPDATE in a single statement** unsupported. (beta blog)
- Some `psql` backslash commands (e.g. `\d <table>`) unsupported. (beta blog)
- Various DDL: `ALTER SEQUENCE`, `COMMENT ON` not yet supported. (beta blog)
- Collations ignored. (beta blog)
- **Biggest remaining issue = general Postgres compatibility**: hundreds of unresolved `.pgdump` import failures. (state-of)
- **Performance:** ~5.2× slower than Postgres overall (6.3× reads / 3.6× writes); ~91.17% sqllogictest correctness. (README)
- Still **pre-1.0 Beta**; 1.0 targeted ~Oct 2026. (state-of)

# 6. VERIFICATION TABLE (one row per cross-check item)

| Item (from MySQL ref) | DoltGres reality | Status | Source |
|---|---|---|---|
| types | Postgres type system; many full, many partial (precision not enforced on numeric/temporal), several unsupported (incl. SERIAL) | CONFIRMED | supported-types |
| users/grants → Postgres roles | `CREATE USER`/`CREATE ROLE`/`GRANT roles TO users [WITH ADMIN OPTION]`; no column-level/object-type/impersonation | CONFIRMED | beta blog + access-mgmt |
| system variables → GUCs (SET/current_setting/pg_settings) | Not verified for DoltGres | UNCONFIRMED | — |
| triggers (CREATE FUNCTION RETURNS trigger + CREATE TRIGGER) | Row-level supported; STATEMENT-level not | CONFIRMED | state-of-doltgres |
| procedures (CALL vs SELECT, $$ bodies) | VC ops are `SELECT` functions, not `CALL`. General user procedures "almost done", incomplete Oct 2025 | UNCONFIRMED (partial) | re-intro blog + state-of |
| AUTO_INCREMENT → SERIAL / GENERATED IDENTITY | **SERIAL explicitly NOT supported**; IDENTITY not stated | CONFIRMED (SERIAL no) / UNCONFIRMED (IDENTITY) | supported-types |
| transactions / isolation levels | Branch = long-running write-isolated txn; explicit isolation-level support undocumented | UNCONFIRMED | — |
| views + AS OF time travel | `AS OF '<ref|hash>'` / `AS OF TIMESTAMP(...)` CONFIRMED; **views themselves** undocumented in fetched sources | AS OF CONFIRMED / views UNCONFIRMED | querying-history |
| USE/SHOW DATABASES → DoltGres db/schema model | Postgres schema model; VC state in `dolt.` schema (`dolt.branches`, alias `dolt_branches`); revision DBs via `USE mydb/<rev>` and conn-string `/mydb/<rev>` | CONFIRMED | system-tables + querying-history |
| indexes & constraints | Standard constraints work (`dolt_verify_constraints`, `dolt_conflicts_*`); custom/operator indexing unsupported at Beta | CONFIRMED (basic) / UNCONFIRMED (advanced) | functions + beta blog |
| exact VC function/procedure/system-table names + calling convention | Functions via `SELECT dolt_xxx(...)`; system tables `dolt.<name>` (+`dolt_` alias) and per-table `dolt_diff_*`,`dolt_history_*`,`dolt_commit_diff_*`,`dolt_conflicts_*` | CONFIRMED | dolt-sql-functions + dolt-system-tables |

---
title: "Dolt SQL Reference — Version Control (the dolt_* API)"
scope: >
  The precise SQL API for Dolt's version control: stored procedures (CALL),
  functions (scalar + table), system tables, and system variables (@@dolt_*),
  plus AS OF queries, branches, merges, remotes and authentication. This is the
  CORE of Briven's value (version-controlled SQL database). Source product is
  Dolt (MySQL-flavored). TARGET is DoltGres (PostgreSQL-flavored) — the same
  version-control concepts exist but the exact Postgres calling convention must
  be verified; syntax-specific items are flagged with ⟦DoltGres note⟧.
relevance: "[CORE] — version-control SQL extensions are the heart of Briven."
source_urls:
  - https://www.dolthub.com/docs/sql-reference/version-control/sql-extensions/
  - https://www.dolthub.com/docs/sql-reference/version-control/branches/
  - https://www.dolthub.com/docs/sql-reference/version-control/merges/
  - https://www.dolthub.com/docs/sql-reference/version-control/querying-history/
  - https://www.dolthub.com/docs/sql-reference/version-control/remotes/
  - https://www.dolthub.com/docs/sql-reference/version-control/remote-authentication/
  - https://www.dolthub.com/docs/sql-reference/version-control/dolt-sql-procedures/
  - https://www.dolthub.com/docs/sql-reference/version-control/dolt-sql-functions/
  - https://www.dolthub.com/docs/sql-reference/version-control/dolt-system-tables/
  - https://www.dolthub.com/docs/sql-reference/version-control/dolt-sysvars/
  - https://www.dolthub.com/docs/sql-reference/version-control/saved-queries/
fetched: 2026-06-28
---

# Dolt SQL Reference — Version Control

> ⟦DoltGres note — GLOBAL⟧ Everything below is documented for **Dolt (MySQL
> dialect)**. DoltGres is the **PostgreSQL-flavored** equivalent and exposes the
> analogous version-control surface (commit/branch/merge procedures, `dolt_*`
> system tables, `AS OF` time-travel). However: (a) Postgres has no `CALL ... ()`
> result-set convention identical to MySQL — DoltGres procedures may be callable
> as `SELECT dolt_commit(...)` function-style or via `CALL`; (b) backtick
> identifier quoting (`` `db/branch` ``) becomes double-quote quoting in Postgres
> (`"db/branch"`); (c) session/system variable syntax differs (`SET` vs
> `SHOW`/`set_config`). **Do not assume any exact DoltGres signature from this
> doc — verify against DoltGres's own reference before shipping.** The NAMES and
> SEMANTICS are expected to carry over; the CALLING CONVENTION must be confirmed.

---

## Quick reference — every name captured

### Stored procedures (invoke with `CALL`)
`DOLT_ADD`, `DOLT_BACKUP`, `DOLT_BRANCH`, `DOLT_CHECKOUT`, `DOLT_CHERRY_PICK`,
`DOLT_CLEAN`, `DOLT_CLONE`, `DOLT_COMMIT`, `DOLT_COMMIT_HASH_OUT`,
`DOLT_CONFLICTS_RESOLVE`, `DOLT_FETCH`, `DOLT_GC`, `DOLT_MERGE`, `DOLT_PULL`,
`DOLT_PURGE_DROPPED_DATABASES`, `DOLT_PUSH`, `DOLT_REBASE`, `DOLT_REMOTE`,
`DOLT_RESET`, `DOLT_REVERT`, `DOLT_RM`, `DOLT_STASH`, `DOLT_TAG`, `DOLT_UNDROP`,
`DOLT_UPDATE_COLUMN_TAG`, `DOLT_VERIFY_CONSTRAINTS`,
`DOLT_ASSUME_CLUSTER_ROLE` (cluster).
Statistics procedures: `DOLT_STATS_RESTART`, `DOLT_STATS_STOP`,
`DOLT_STATS_PURGE`, `DOLT_STATS_ONCE`, `DOLT_STATS_WAIT`, `DOLT_STATS_GC`,
`DOLT_STATS_FLUSH`, `DOLT_STATS_INFO`.

### Functions — scalar (invoke with `SELECT`)
`ACTIVE_BRANCH()`, `DOLT_MERGE_BASE()`, `DOLT_HASHOF()`, `DOLT_HASHOF_DB()`,
`DOLT_HASHOF_TABLE()`, `HASHOF()`, `HAS_ANCESTOR()`, `DOLT_VERSION()`,
`LAST_INSERT_UUID()`, `DOLT_JOIN_COST()`.

### Functions — table (use in `FROM`)
`DOLT_DIFF()`, `DOLT_DIFF_STAT()`, `DOLT_DIFF_SUMMARY()`, `DOLT_JSON_DIFF()`,
`DOLT_LOG()`, `DOLT_PATCH()`, `DOLT_SCHEMA_DIFF()`, `DOLT_QUERY_DIFF()`,
`DOLT_REFLOG()`, `DOLT_BRANCH_STATUS()`, `DOLT_PREVIEW_MERGE_CONFLICTS()`,
`DOLT_PREVIEW_MERGE_CONFLICTS_SUMMARY()`, `DOLT_TEST_RUN()`.

### System tables
**Metadata:** `dolt_branches`, `dolt_remote_branches`, `dolt_docs`,
`dolt_procedures`, `dolt_query_catalog`, `dolt_remotes`, `dolt_backups`,
`dolt_schemas`, `dolt_tags`, `dolt_branch_activity`, `dolt_statistics`.
**History:** `dolt_blame_$tablename`, `dolt_commit_ancestors`, `dolt_commits`,
`dolt_history_$tablename`, `dolt_log`.
**Diffs:** `dolt_commit_diff_$tablename`, `dolt_diff`, `dolt_diff_$tablename`,
`dolt_column_diff`.
**Working set:** `dolt_conflicts`, `dolt_conflicts_$tablename`,
`dolt_schema_conflicts`, `dolt_merge_status`, `dolt_stashes`, `dolt_status`,
`dolt_status_ignored`, `dolt_workspace_$tablename`.
**Constraints:** `dolt_constraint_violations`,
`dolt_constraint_violations_$tablename`.
**Config:** `dolt_ignore`, `dolt_nonlocal_tables`, `dolt_tests`, `dolt_rebase`.
**Access control:** `dolt_branch_control`, `dolt_branch_namespace_control`.

### System variables (`@@...`)
`@@dbname_default_branch`, `@@dbname_head_ref`, `@@dbname_head`,
`@@dbname_working`, `@@dbname_staged`, `@@dolt_log_level`,
`@@dolt_show_branch_databases`, `@@dolt_show_system_tables`,
`@@dolt_override_schema`, `@@dolt_transaction_commit`,
`@@dolt_transaction_commit_message`, `@@strict_mysql_compatibility`,
`@@dolt_allow_commit_conflicts`, `@@dolt_commit_verification_groups`,
`@@dolt_force_transaction_commit`, `@@dolt_dont_merge_json`,
`@@dolt_allow_ci_creation`, `@@dolt_auto_gc_enabled`, `@@dolt_optimize_json`.
**Replication:** `@@dolt_replicate_to_remote`, `@@dolt_async_replication`,
`@@dolt_read_replica_remote`, `@@dolt_replicate_heads`,
`@@dolt_replicate_all_heads`, `@@dolt_replication_remote_url_template`,
`@@dolt_read_replica_force_pull`, `@@dolt_skip_replication_errors`.
**Cluster:** `@@dolt_cluster_role`, `@@dolt_cluster_role_epoch`,
`@@dolt_cluster_ack_writes_timeout_secs`.
**Commit identity:** `@@dolt_author_name`, `@@dolt_author_email`,
`@@dolt_author_date`, `@@dolt_committer_name`, `@@dolt_committer_email`,
`@@dolt_committer_date`.
**Auth env var (not a sysvar):** `DOLT_REMOTE_PASSWORD`.
**Stats:** `@@dolt_stats_enabled`, `@@dolt_stats_paused`,
`@@dolt_stats_memory_only`, `@@dolt_stats_branches`, `@@dolt_stats_job_interval`,
`@@dolt_stats_gc_enabled`, `@@dolt_stats_gc_interval`.

**Counts:** ~34 procedures (incl. 8 stats), 10 scalar functions, 13 table
functions, ~40 system tables (incl. per-`$tablename` families), ~50 system
variables.

---

## SQL Extensions (index)
URL: https://www.dolthub.com/docs/sql-reference/version-control/sql-extensions/
Relevance: **[CORE]**

A flat index of every Dolt-specific SQL extension — every stored procedure,
function, system table, and system variable — on a single page. These let you
do version control directly through SQL instead of CLI commands.

**The version-control model exposed:**
- **Working set** — current uncommitted state.
- **Staging area** — changes selected for the next commit (`DOLT_ADD`).
- **Commits** — snapshots with metadata (author, date, message).
- **Branches** — independent commit histories.
- **Merges** — integration of parallel changes with conflict detection.

- **Procedures** (state-modifying) are invoked with `CALL` and mirror CLI
  commands (e.g. `CALL DOLT_COMMIT(...)`).
- **Functions** are invoked with `SELECT`; scalar functions return a single
  value, table functions are used in `FROM` clauses.
- **System tables** expose repository state as queryable tables.
- **System variables** (`@@dolt_*`) are session/global settings.

See per-category sections below for full signatures and examples.

---

## Branches & Database Revisions
URL: https://www.dolthub.com/docs/sql-reference/version-control/branches/
Relevance: **[CORE]**

Dolt lets you select a branch/commit/tag as part of the **database name** in the
connection string, in `USE`, or in fully-qualified table references.

### Connection-string revision syntax (Dolt/MySQL)
```
mysql://127.0.0.1:3306/mydb                                   -- default branch
mysql://127.0.0.1:3306/mydb/feature-branch                    -- named branch
mysql://127.0.0.1:3306/mydb/ia1ibijq8hq1llr7u85uivsi5lh3310p  -- commit hash (read-only)
mysql://127.0.0.1:3306/mydb/v1.0                              -- tag (read-only)
mysql://127.0.0.1:3306/mydb/feature-branch~2                  -- ancestry
```
Command line: `mysql --host 127.0.0.1 --port 3306 -u root mydb/feature-branch`

### `USE` statement
```sql
USE mydb;
USE `mydb/feature-branch`;
USE `mydb/ia1ibijq8hq1llr7u85uivsi5lh3310p`;
USE `mydb/v1.0`;
```
> ⟦DoltGres note⟧ Backtick quoting (`` `mydb/feature-branch` ``) is MySQL. In
> Postgres use double quotes: `USE "mydb/feature-branch"` — verify DoltGres
> supports the `db/branch` revision-in-name syntax and its exact quoting.

### Fully-qualified references
```sql
INSERT INTO `mydatabase/feature-branch`.accounts (id) VALUES (1);
SELECT * FROM `mydatabase/ia1ibijq8hq1llr7u85uivsi5lh3310p`.accounts;
SELECT * FROM `mydatabase/v1.0`.accounts;
```

### Switching branches with `DOLT_CHECKOUT()`
```sql
CALL DOLT_CHECKOUT('feature-branch');                                  -- switch
CALL DOLT_CHECKOUT('-b', 'new-branch');                                -- create + switch
CALL DOLT_CHECKOUT('-b', 'new-branch-at-commit',
                   'ia1ibijq8hq1llr7u85uivsi5lh3310p');                -- create at commit
```

### Multi-branch transaction restriction
A single transaction can only commit changes to **one** branch:
```sql
START TRANSACTION;
INSERT INTO `mydb/branch1`.t1 VALUES (100);
INSERT INTO `mydb/branch2`.t1 VALUES (200);
COMMIT; -- ERROR: can only commit changes to one branch at a time
```

Related: `dolt_reflog()` (find prior branch HEADs), `dolt_branch()` (recreate),
`dolt_reset()` (reset branch to a commit). System variable
`@@dbname_default_branch` sets the default branch for new connections.

---

## Merges
URL: https://www.dolthub.com/docs/sql-reference/version-control/merges/
Relevance: **[CORE]**

### `DOLT_MERGE()`
```sql
CALL DOLT_MERGE('feature-branch');
```
Output columns: `hash`, `fast_forward` (0/1), `conflicts` (set to 1 if
conflicts/constraint-violations exist), `message`. Run inside a transaction so
errors can be addressed before `COMMIT`:
```sql
START TRANSACTION;
CALL DOLT_MERGE('branch-name');
-- resolve conflicts if needed
COMMIT;
```

### `dolt_merge_status` (in-progress merge state)
```sql
SELECT * FROM dolt_merge_status;
```
Columns: `is_merging`, `source`, `source_commit`, `target`, `unmerged_tables`.

### Schema conflicts — `dolt_schema_conflicts`
```sql
SELECT table_name, description, base_schema, our_schema, their_schema
FROM dolt_schema_conflicts;
```
Resolve with `DOLT_CONFLICTS_RESOLVE()`:
```sql
CALL dolt_conflicts_resolve('table_name', '--ours');
CALL dolt_conflicts_resolve('table_name', '--theirs');
```

### Data conflicts — `dolt_conflicts` and `dolt_conflicts_$tablename`
```sql
SELECT * FROM dolt_conflicts;   -- columns: table, num_conflicts
DESCRIBE dolt_conflicts_people; -- base_*, our_*, their_* per column
```
Per-table conflict columns: `base_$column` (ancestor), `our_$column` (current
branch), `their_$column` (merged branch).

**Resolve strategies:**
```sql
-- Take ours (keep current working set):
DELETE FROM dolt_conflicts_people;

-- Take theirs (accept merged values):
REPLACE INTO people (id,first_name,last_name,age) (
    SELECT their_id, their_first_name, their_last_name, their_age
    FROM dolt_conflicts_people
    WHERE their_id IS NOT NULL
);
DELETE FROM people WHERE id IN (
    SELECT base_id FROM dolt_conflicts_people
    WHERE base_id IS NOT NULL AND their_id IS NULL
);
DELETE FROM dolt_conflicts_people;

-- Or update in place:
UPDATE dolt_conflicts_people
SET    our_first_name = their_first_name,
       our_last_name  = their_last_name,
       our_age        = their_age
WHERE  their_id IS NOT NULL;
```

### Constraint violations
```sql
SELECT * FROM dolt_constraint_violations;          -- table, num_violations
SELECT violation_type, pk, parent_fk
FROM dolt_constraint_violations_child;
```

### Relevant system variables
- `@@dolt_allow_commit_conflicts` — allow committing unresolved conflicts;
  default `0`. `SET @@dolt_allow_commit_conflicts = 1;`
- `@@dolt_transaction_commit` — alternative auto-commit mechanism; blocks if the
  working set has conflicts.

> ⟦DoltGres note⟧ Conflict/violation system-table NAMES are expected to be the
> same in DoltGres, but verify `CALL dolt_conflicts_resolve(...)` calling style
> and whether `REPLACE INTO` (MySQL-only) must become Postgres
> `INSERT ... ON CONFLICT DO UPDATE`.

---

## Querying History (AS OF time-travel)
URL: https://www.dolthub.com/docs/sql-reference/version-control/querying-history/
Relevance: **[CORE]**

### `AS OF` clause on `SELECT`
```sql
SELECT * FROM myTable AS OF 'kfvpgcf8pkd6blnkvv8e0kle8j6lug7a';   -- commit hash
SELECT * FROM myTable AS OF 'myBranch';                           -- branch name
SELECT * FROM myTable AS OF 'HEAD^2';                             -- ancestry ref
SELECT * FROM myTable AS OF TIMESTAMP('2020-01-01');              -- timestamp
SELECT * FROM myTable AS OF 'myBranch' JOIN myTable AS OF 'yourBranch' AS foo;
```
`AS OF <expr>` accepts any valid Dolt reference (commit hash, branch name, tag,
ancestry spec) or a timestamp/date.

### Schema inspection with `AS OF`
```sql
SHOW TABLES AS OF 'kfvpgcf8pkd6blnkvv8e0kle8j6lug7a';
SHOW CREATE TABLE myTable AS OF 'myBranch';
DESCRIBE myTable AS OF 'HEAD~';
```

### Revision in the database name
```sql
USE mydb/ia1ibijq8hq1llr7u85uivsi5lh3310p;
SHOW CREATE TABLE `mydb/ia1ibijq8hq1llr7u85uivsi5lh3310p`.myTable;
```

### History via system tables
`dolt_history_$table` — one row per revision of a row:
```sql
SELECT * FROM dolt_history_mytable
WHERE state = "Virginia"
ORDER BY "commit_date";
```
`dolt_commit_diff_$table` — differences between two revisions:
```sql
SELECT * FROM dolt_commit_diff_mytable
WHERE to_commit = HASHOF('HEAD')
  AND from_commit = HASHOF('HEAD~')
ORDER BY state, to_commit_date;
```

### Querying historical views
```sql
CALL dolt_checkout('-b', 'old-view-def', '81223g1cpmib215gmov8686b6310p37d');
SELECT * FROM `view_test/81223g1cpmib215gmov8686b6310p37d`.v1;
SELECT * FROM v1 AS OF '81223g1cpmib215gmov8686b6310p37d';
```

> Note: this particular page does not give signatures for `dolt_log`,
> `dolt_blame`, `dolt_commits`, `dolt_commit_ancestors` — those are documented in
> the system-tables / functions sections below.
> ⟦DoltGres note⟧ `AS OF` is standard SQL:2011 temporal syntax and Postgres-
> friendly; confirm DoltGres supports `AS OF TIMESTAMP(...)`, `AS OF 'branch'`,
> and ancestry refs like `HEAD^2`/`HEAD~`.

---

## Remotes
URL: https://www.dolthub.com/docs/sql-reference/version-control/remotes/
Relevance: **[CORE]**

Procedures for synchronizing with remotes. (Full flag lists in the procedures
section.)

```sql
-- Manage remotes
CALL dolt_remote('add', 'origin', 'coffeegoddd/getting_started');
CALL dolt_remote('add', '--ref', 'refs/dolt/custom', 'origin', '../remote.git'); -- Git remote
CALL dolt_remote('remove', 'origin1');

-- Push / Pull / Fetch
CALL dolt_push('origin', 'main');
CALL dolt_pull('origin');           -- supports --user for sql-server auth
CALL dolt_fetch('origin', 'main');  -- supports --user for sql-server auth

-- Clone
CALL dolt_clone('dolthub/us-jails');
CALL dolt_clone('--ref', 'refs/dolt/custom', '../remote.git', 'repo2');
```

**Authentication:** `--user <name>` parameter on push/pull/fetch/clone reads the
password from the **`DOLT_REMOTE_PASSWORD`** environment variable on the
sql-server process (see next section).

Related system tables: `dolt_remotes` (`name, url, fetch_specs, params`),
`dolt_remote_branches`. Replication is controlled by the `@@dolt_replicate_*` /
`@@dolt_read_replica_*` system variables (see sysvars section).

---

## Remote Authentication
URL: https://www.dolthub.com/docs/sql-reference/version-control/remote-authentication/
Relevance: **[CORE]** (operational — how Briven authenticates server-to-server)

The remote-touching procedures `DOLT_CLONE()`, `DOLT_FETCH()`, `DOLT_PULL()`,
`DOLT_PUSH()` authenticate with a `--user <name>` argument; the **password is NOT
a procedure argument** — it is read from the `DOLT_REMOTE_PASSWORD` environment
variable on the `sql-server` process.

```sql
CALL DOLT_CLONE('--user', 'alice', 'https://doltremoteapi.dolthub.com/acme/secret-db');
CALL DOLT_PUSH('--user', 'alice', 'origin', 'main');
```

**Server-side setup** (must be set before the server starts; cannot be set in a
SQL session):
```bash
DOLT_REMOTE_PASSWORD='s3cret' dolt sql-server --config config.yaml
```
Other methods: systemd unit `Environment=`, container env vars, shell env before
forking. **Limitation:** for the lifetime of that server process every `--user`
call uses the SAME password; multiple credentials require separate servers.

**Credential types by remote:**
- **DoltHub** — DoltHub username + account password or API token.
- **DoltLab** — DoltLab username + account password.
- **Hosted Dolt** — deployment admin user/password, or any SQL user with
  `CLONE_ADMIN` privilege.
- **Dolt sql-server remotesapi** — SQL user with `CLONE_ADMIN` (read) or write
  grants (push).

**Error if unset:** `error: must set DOLT_REMOTE_PASSWORD environment variable to
use --user param`.

> ⟦DoltGres note⟧ The `DOLT_REMOTE_PASSWORD` env-var mechanism and `--user`
> argument should carry over to DoltGres's server, but verify the procedure
> calling form in Postgres.

---

## Stored Procedures (full reference)
URL: https://www.dolthub.com/docs/sql-reference/version-control/dolt-sql-procedures/
Relevance: **[CORE]**

> ⟦DoltGres note⟧ All procedures below are documented as MySQL `CALL DOLT_X(...)`.
> Verify DoltGres's calling convention (CALL vs SELECT-function form) and option
> quoting for EACH before use.

### `DOLT_ADD()` — stage tables
`CALL DOLT_ADD(table_spec, ...)` · flags: `table` (use `'.'` for all), `-A`
(stage all). Output: status (0/1).
```sql
CALL DOLT_ADD('-A');
CALL DOLT_ADD('table1', 'table2');
```

### `DOLT_BACKUP()` — manage backups
`CALL DOLT_BACKUP(action, name, [url])` · actions: `sync`, `sync-url`, `add`,
`remove`, `restore`. Output: status (0/1). (Requires GRANT.)
```sql
CALL dolt_backup('add', 'my-backup', 'https://dolthub.com/org/repo');
CALL dolt_backup('sync', 'my-backup');
```

### `DOLT_BRANCH()` — create/copy/move/delete branches
`CALL DOLT_BRANCH([options], [name], [start_point])` · flags: `-c,--copy`,
`-m,--move`, `-d,--delete`, `-f,--force`, `-D` (= `--delete --force`),
`-t,--track`, `-u,--set-upstream-to`, `-r` (delete remote-tracking). Output:
status (0/1).
```sql
CALL DOLT_BRANCH('myNewBranch');
CALL DOLT_BRANCH('-c', 'main', 'feature1');
CALL DOLT_BRANCH('-m', 'oldName', 'newName');
CALL DOLT_BRANCH('-d', 'branchToDelete');
```

### `DOLT_CHECKOUT()` — switch branch / restore tables
`CALL DOLT_CHECKOUT([options], target)` · flags: `-b` (create+checkout), `-B`
(move existing + checkout), `-t` (set upstream), `-f,--force`. Output: status
(0/1), message.
```sql
CALL DOLT_CHECKOUT('-b', 'feature-branch');
CALL DOLT_CHECKOUT('my-existing-branch');
CALL DOLT_CHECKOUT('my-table');   -- restore table from HEAD
```

### `DOLT_CHERRY_PICK()` — replay a commit
`CALL DOLT_CHERRY_PICK([options], commit_ref)` · flags: `--abort`,
`--allow-empty`, `--skip-verification`. Output: `hash`, `data_conflicts`,
`schema_conflicts`, `constraint_violations`.
```sql
CALL DOLT_CHERRY_PICK('my-existing-branch~2');
CALL DOLT_CHERRY_PICK('qj6ouhjvtrnp1rgbvajaohmthoru2772');
```

### `DOLT_CLEAN()` — drop untracked tables
`CALL DOLT_CLEAN([options], [table_name, ...])` · flags: `--dry-run`, `-x`
(ignore dolt_ignore). Output: status (0/1).
```sql
CALL DOLT_CLEAN();
CALL DOLT_CLEAN('untracked-table');
CALL DOLT_CLEAN('--dry-run');
```

### `DOLT_CLONE()` — clone a remote DB
`CALL DOLT_CLONE([options], source_url, [new_db_name])` · flags: `--remote`
(default `origin`), `-b,--branch`, `--depth`, `--single-branch`, `-u,--user`.
Output: status (0/1). (Requires GRANT.)
```sql
CALL DOLT_CLONE('dolthub/us-jails');
CALL DOLT_CLONE('-branch', 'prod', '-remote', 'dolthub',
                'https://doltremoteapi.dolthub.com/dolthub/demo', 'taxis');
```

### `DOLT_COMMIT()` — commit staged changes
`CALL DOLT_COMMIT([options], -m message, [options])` · flags: `-m,--message`
(required), `-a,--all` (stage modified), `-A,--ALL` (stage incl. new),
`--allow-empty`, `--skip-empty`, `--date`, `--author` (`"Name <email>"`),
`-f,--force`, `--amend`, `-S,--sign[=key-id]`, `--skip-verification`. Output:
`hash`.
```sql
CALL DOLT_COMMIT('-a', '-m', 'This is a commit');
CALL DOLT_COMMIT('-m', 'commit message', '--author', 'John Doe <john@example.com>');
```

### `DOLT_COMMIT_HASH_OUT()` — commit, returning hash into a variable
`CALL DOLT_COMMIT_HASH_OUT(@out_var, [flags...], -m message)` · first arg is a
session variable receiving the commit hash; hash also returned in result set.
```sql
SET @c1 = '';
CALL DOLT_COMMIT_HASH_OUT(@c1, '-am', 'creating table t');
SELECT * FROM dolt_diff(@c1, @c2, 't');
```

### `DOLT_CONFLICTS_RESOLVE()` — resolve merge conflicts
`CALL DOLT_CONFLICTS_RESOLVE(strategy, table_spec, ...)` · flags: `--ours`
(destination branch wins), `--theirs` (source branch wins). Output: status (0/1).
```sql
CALL DOLT_CONFLICTS_RESOLVE('--ours', 't1', 't2');
```

### `DOLT_FETCH()` — fetch from remote
`CALL DOLT_FETCH([options], remote, [refspec])` · flags: `--prune,-p`, `--user`,
`--silent`. Output: status (0/1). (Requires GRANT.)
```sql
CALL DOLT_FETCH('origin', 'main');
CALL DOLT_FETCH('origin');
```

### `DOLT_GC()` — garbage collection
`CALL DOLT_GC([options])` · flags: `-s,--shallow`, `-f,--full`, `--archive-level`
(default 1), `--incremental-file-size` (bytes). Output: status (0/1). (Requires
GRANT.)
```sql
CALL DOLT_GC();
CALL DOLT_GC('--shallow');
```

### `DOLT_MERGE()` — merge a branch
`CALL DOLT_MERGE([options], branch_name)` · flags: `--no-ff`, `--ff-only`,
`--squash`, `-m,--message`, `--abort`, `--commit` (default), `--no-commit`,
`--no-edit`, `--author`, `--skip-verification`. Output: `hash`,
`fast_forward` (0/1), `conflicts`, `message`.
```sql
CALL DOLT_MERGE('feature-branch');
CALL DOLT_MERGE('feature-branch', '--no-ff', '-m', 'merge message');
CALL DOLT_MERGE('--abort');
```

### `DOLT_PULL()` — fetch + merge
`CALL DOLT_PULL([options], remote, [branch])` · flags: `--no-ff`, `--ff-only`,
`--squash`, `-f,--force`, `--prune,-p`, `--commit` (default), `--no-commit`,
`--no-edit`, `-r,--rebase`, `--user`, `--silent`, `--skip-verification`. Output:
`fast_forward` (0/1), `conflicts`, `message`. (Requires GRANT.)
```sql
CALL DOLT_PULL('origin');
CALL DOLT_PULL('origin', 'some-branch');
```

### `DOLT_PURGE_DROPPED_DATABASES()` — permanently delete dropped DBs
`CALL DOLT_PURGE_DROPPED_DATABASES()` · requires SUPER privileges. (Requires
GRANT.)
```sql
CALL dolt_purge_dropped_databases();
```

### `DOLT_PUSH()` — push to remote
`CALL DOLT_PUSH([options], remote, [refspec])` · flags: `-f,--force`,
`-u,--set-upstream`, `--all`, `--user`, `--silent`. Output: status (0/1),
message. (Requires GRANT.)
```sql
CALL DOLT_PUSH('origin', 'main');
CALL DOLT_PUSH('--force', 'origin', 'main');
```

### `DOLT_REBASE()` — interactive rebase
`CALL DOLT_REBASE([options], upstream_branch)` · flags: `--interactive,-i`
(required to start), `--continue`, `--abort`, `--empty` (drop/keep),
`--skip-verification`. Output: status (0/1), message. Edit the `dolt_rebase`
table between start and `--continue`.
```sql
CALL DOLT_REBASE('-i', 'main');
CALL DOLT_REBASE('--continue');
CALL DOLT_REBASE('--abort');
```

### `DOLT_REMOTE()` — add/remove remotes
`CALL DOLT_REMOTE(action, name, [url])` · actions: `add`, `remove`. Output:
status (0/1). (Requires GRANT.)
```sql
CALL DOLT_REMOTE('add', 'origin', 'https://doltremoteapi.dolthub.com/Dolthub/museum-collections');
CALL DOLT_REMOTE('remove', 'origin1');
```

### `DOLT_RESET()` — reset working/staged/branch
`CALL DOLT_RESET([options], [commit_ref|table_name])` · flags: `--hard` (reset
working + staged), `--soft` (unstage only, default). Output: status (0/1).
```sql
CALL DOLT_RESET('--hard', 'featureBranch');
CALL DOLT_RESET('--hard', 'commitHash123abc');
CALL DOLT_RESET('myTable');
```

### `DOLT_REVERT()` — revert a commit
`CALL DOLT_REVERT(commit_ref, [options])` · flags: `--author` (`"Name <email>"`).
Output: status (0/1).
```sql
CALL DOLT_REVERT('gtfv1qhr5le61njimcbses9oom0de41e');
CALL DOLT_REVERT('HEAD~2');
CALL DOLT_REVERT('HEAD', '--author=reverter@rev.ert');
```

### `DOLT_RM()` — remove tables from staging
`CALL DOLT_RM([options], table_name, ...)` · flags: `--cached` (unstage only,
keep working copy). Output: status (0/1).
```sql
CALL DOLT_RM('table1');
CALL DOLT_RM('--cached', 'table1');
```

### `DOLT_STASH()` — stash working changes
`CALL DOLT_STASH(subcommand, stash_name, [identifier])` · subcommands: `push`
(`-u,--include-untracked`, `-a,--all`), `pop`, `drop`, `clear`.
```sql
CALL DOLT_STASH('push', 'stash1');
CALL DOLT_STASH('pop', 'stash1');
CALL DOLT_STASH('drop', 'stash1');
CALL DOLT_STASH('clear', 'stash_name');
-- identifier form: CALL DOLT_STASH('pop', 'stash_name', 'stash@{0}');
```

### `DOLT_TAG()` — create/delete/list tags
`CALL DOLT_TAG([options], tag_name, [commit_ref])` · flags: `-m,--message`,
`-d,--delete`, `-v,--verbose`, `--author`. Output: status (0/1).
```sql
CALL DOLT_TAG('tag_name', 'commit_ref');
CALL DOLT_TAG('-m', 'message', 'tag_name', 'commit_ref');
CALL DOLT_TAG('-d', 'tag_name');
```

### `DOLT_UNDROP()` — restore a dropped database
`CALL DOLT_UNDROP(database_name)` · no args = list available to undrop.
```sql
CALL dolt_undrop();
CALL dolt_undrop('database1');
```

### `DOLT_UPDATE_COLUMN_TAG()` — set a column's internal tag
`CALL DOLT_UPDATE_COLUMN_TAG(table, column, tag)` · `tag` is an integer. Output:
status (0/1).
```sql
CALL dolt_update_column_tag('myTable', 'col1', 42);
```

### `DOLT_VERIFY_CONSTRAINTS()` — check constraints
`CALL DOLT_VERIFY_CONSTRAINTS([options], [table_name, ...])` · flags: `-a,--all`
(verify all rows), `-o,--output-only` (skip writing the violations system table).
Output: `violations` (0/1).
```sql
CALL DOLT_VERIFY_CONSTRAINTS();
CALL DOLT_VERIFY_CONSTRAINTS('--all');
CALL DOLT_VERIFY_CONSTRAINTS('parent');
```

### Statistics procedures
- `dolt_stats_restart()` — start the update thread with current session params.
- `dolt_stats_stop()` — stop thread, clear work queue.
- `dolt_stats_purge()` — delete stats cache and stop thread.
- `dolt_stats_once()` — collect statistics one time.
- `dolt_stats_wait()` — block on a full queue cycle.
- `dolt_stats_gc()` — block waiting for a GC signal.
- `dolt_stats_flush()` — block on a flush signal.
- `dolt_stats_info()` — return provider state; optional `'-short'` flag.

### Access control
These administrative procedures require an explicit GRANT: `dolt_backup`,
`dolt_clone`, `dolt_fetch`, `dolt_undrop`, `dolt_purge_dropped_databases`,
`dolt_gc`, `dolt_pull`, `dolt_push`, `dolt_remote`.
```sql
GRANT EXECUTE ON mydb.* TO user@localhost;                       -- all procedures
GRANT EXECUTE ON PROCEDURE mydb.dolt_commit TO user@localhost;   -- one procedure
```

---

## Functions (full reference)
URL: https://www.dolthub.com/docs/sql-reference/version-control/dolt-sql-functions/
Relevance: **[CORE]**

> ⟦DoltGres note⟧ Scalar functions (SELECT-form) are the most likely to port
> cleanly to Postgres; table functions used in `FROM` may need
> `SELECT * FROM dolt_diff(...)` exactly or a set-returning-function variant.
> Verify each.

### Scalar functions

**`ACTIVE_BRANCH()`** — name of the session's active branch.
```sql
SELECT active_branch();
```

**`DOLT_MERGE_BASE(branch1, branch2)`** — commit hash of the common ancestor.
```sql
SELECT DOLT_MERGE_BASE('feature', 'main');
```

**`DOLT_HASHOF(revision)`** — commit hash of a branch/revision spec.
```sql
SELECT dolt_hashof('main');
```
(Doc also references `HASHOF(...)` used inside diff-table queries, e.g.
`HASHOF('HEAD')` — treat as the same family.)

**`DOLT_HASHOF_TABLE(table_name)`** — value hash of a table's data (change
detection).
```sql
SELECT dolt_hashof_table('color');
```

**`DOLT_HASHOF_DB([revision])`** — value hash of the entire versioned database;
optional arg is a branch name or `'STAGED'` / `'WORKING'` / `'HEAD'`.
```sql
SELECT dolt_hashof_db();
SELECT dolt_hashof_db('feature');
```

**`DOLT_VERSION()`** — version string of the Dolt binary.
```sql
SELECT dolt_version();   -- e.g. 0.40.4
```

**`HAS_ANCESTOR(target_ref, ancestor_ref)`** — boolean: is `ancestor_ref` in the
commit graph of `target_ref`.
```sql
SELECT has_ancestor('feature', 'E'); -- true
SELECT has_ancestor('main', 'F');    -- false
```

**`LAST_INSERT_UUID()`** — UUID of the first row inserted by the last statement.
Column must be in the PK as `VARCHAR(36)/CHAR(36)` default `(UUID())` or
`VARBINARY(16)/BINARY(16)` default `(UUID_TO_BIN(UUID()))`.
```sql
INSERT INTO t (c1) VALUES ("one"), ("two");
SELECT last_insert_uuid();
```

**`DOLT_JOIN_COST(query_string)`** — diagnostic: how the planner costs join
plans (returns the memo with groups, operators, estimated costs).
```sql
SELECT dolt_join_cost('SELECT * FROM ab, cd WHERE a = c AND b = d');
```

### Table functions

**`DOLT_DIFF(from, to, table)`** — row-level data diff (two-dot and three-dot).
```sql
DOLT_DIFF(<from>, <to>, <table>)
DOLT_DIFF(<from>..<to>, <table>)
DOLT_DIFF(<from>...<to>, <table>)
```
Options: `-sk`/`--skinny`, `-ic`/`--include-cols=<columns>`. Schema:
`from_commit`, `from_commit_date`, `to_commit`, `to_commit_date`, `diff_type`,
plus per-column `from_X` / `to_Y`.
```sql
SELECT * FROM DOLT_DIFF("main", "feature_branch", "inventory");
```

**`DOLT_DIFF_STAT(from, to, [table])`** — numeric diff stats. Schema:
`table_name`, `rows_unmodified`, `rows_added`, `rows_deleted`, `rows_modified`,
`cells_added`, `cells_deleted`, `cells_modified`, `old_row_count`,
`new_row_count`, `old_cell_count`, `new_cell_count`. (Supports `..` / `...`.)
```sql
SELECT * FROM DOLT_DIFF_STAT('main', 'WORKING');
```

**`DOLT_DIFF_SUMMARY(from, to, [table])`** — which tables changed and how.
Schema: `from_table_name`, `to_table_name`, `diff_type`, `data_change`,
`schema_change`. (Supports `..` / `...`.)
```sql
SELECT * FROM DOLT_DIFF_SUMMARY('main', 'WORKING');
```

**`DOLT_JSON_DIFF(from_document, to_document)`** — diff two JSON docs. Schema:
`diff_type`, `path`, `from_value`, `to_value`.
```sql
SELECT * FROM DOLT_JSON_DIFF('{"colors": ["red"]}', '{"colors": ["red", "blue"]}');
```

**`DOLT_LOG([revisions...], [--tables tables...])`** — commit log reachable from
a revision (default current HEAD); two-dot and three-dot. Options:
`--min-parents`, `--merges`, `--parents`, `--decorate` (short/full/no/auto),
`--show-signature`, `--not`, `--tables`. Schema: `commit_hash`, `committer`,
`email`, `date`, `message`, `commit_order`, `parents`, `refs`, `signature`,
`author`, `author_email`, `author_date`.
```sql
SELECT * FROM DOLT_LOG('main');
SELECT * FROM DOLT_LOG('main..feature');
SELECT * FROM DOLT_LOG('main...feature');
```

**`DOLT_PATCH(from, to, [table])`** — SQL patch statements to transform a table.
Schema: `statement_order`, `from_commit_hash`, `to_commit_hash`, `table_name`,
`diff_type`, `statement`. (Supports `..` / `...`.)
```sql
SELECT * FROM DOLT_PATCH('main', 'WORKING');
```

**`DOLT_SCHEMA_DIFF(from, to, [table])`** — schema-only diff. Schema:
`from_table_name`, `to_table_name`, `from_create_statement`,
`to_create_statement`. (Supports `..` / `...`.)
```sql
SELECT * FROM DOLT_SCHEMA_DIFF("main", "feature_branch");
SELECT * FROM DOLT_SCHEMA_DIFF("main", "feature_branch", "inventory");
```

**`DOLT_QUERY_DIFF(query1, query2)`** — diff two query result sets (brute-force
O(n²)). Schema: `from_*` cols, `to_*` cols, `diff_type`.
```sql
SELECT * FROM dolt_query_diff(
  'SELECT * FROM t AS OF main',
  'SELECT * FROM t AS OF other'
);
```

**`DOLT_REFLOG([--all], [ref_name])`** — history of named refs (find deleted
refs). Schema: `ref`, `ref_timestamp`, `commit_hash`, `commit_message`.
```sql
SELECT * FROM dolt_reflog('prodBranch');
```

**`DOLT_BRANCH_STATUS(base_refspec, [target_refspecs...])`** — commits ahead /
behind. Schema: `branch`, `commits_ahead`, `commits_behind`.
```sql
SELECT * FROM DOLT_BRANCH_STATUS('main', 'other');
```

**`DOLT_PREVIEW_MERGE_CONFLICTS_SUMMARY(base_branch, merge_branch)`** — conflict
summary without merging. Schema: `table`, `num_data_conflicts`,
`num_schema_conflicts`.
```sql
SELECT * FROM DOLT_PREVIEW_MERGE_CONFLICTS_SUMMARY('main', 'feature_branch');
```

**`DOLT_PREVIEW_MERGE_CONFLICTS(base_branch, merge_branch, table_name)`** —
detailed conflicting rows (base/ours/theirs) without merging. Schema:
`from_root_ish`, `our_diff_type`, `their_diff_type`, `dolt_conflict_id`, plus
per-column `base_X`/`our_X`/`their_X`; keyless tables add `base_cardinality`,
`our_cardinality`, `their_cardinality`.
```sql
SELECT * FROM DOLT_PREVIEW_MERGE_CONFLICTS('main', 'feature_branch', 'users');
```

**`DOLT_TEST_RUN([test_names_or_groups...])`** — run tests from the `dolt_tests`
system table; no args / `'*'` runs all. Schema: `test_name`, `test_group_name`,
`query`, `status` (PASS/FAIL), `message`.
```sql
SELECT * FROM DOLT_TEST_RUN();
SELECT * FROM DOLT_TEST_RUN('users', 'schema');
SELECT * FROM DOLT_TEST_RUN('user_count_test');
```

---

## System Tables (full reference)
URL: https://www.dolthub.com/docs/sql-reference/version-control/dolt-system-tables/
Relevance: **[CORE]**

> ⟦DoltGres note⟧ System-table NAMES and column meanings should port to DoltGres;
> verify the `$tablename` naming pattern (e.g. `dolt_diff_<table>`) and that
> writable tables (conflicts/workspace/ignore/etc.) behave the same in Postgres.

### Metadata tables

**`dolt_branches`** (read-only; modify via `DOLT_BRANCH()`). Columns: `name`,
`hash`, `latest_committer`, `latest_committer_email`, `latest_commit_date`,
`latest_commit_message`, `remote`, `branch`, `dirty`, `latest_author`,
`latest_author_email`, `latest_author_date`.
```sql
SELECT * FROM dolt_branches;
```

**`dolt_remote_branches`** (read-only). Columns: `name`, `hash`,
`latest_committer`, `latest_committer_email`, `latest_commit_date`,
`latest_commit_message`, `latest_author`, `latest_author_email`,
`latest_author_date`.
```sql
SELECT * FROM dolt_remote_branches UNION SELECT * FROM dolt_branches;
```

**`dolt_docs`** (writable; disk persistence not guaranteed). Columns:
`doc_name` (text), `doc_text` (text).
```sql
SELECT * FROM dolt_docs;
```

**`dolt_procedures`** (writable; implementation detail — use standard
CREATE/DROP PROCEDURE). Columns: `name`, `create_stmt`, `created_at`,
`modified_at`, `sql_mode`.

**`dolt_query_catalog`** (writable). Columns: `id`, `display_order`, `name`,
`query`, `description`. (See Saved Queries section.)

**`dolt_remotes`** (read-only; modify via `dolt_remote()`). Columns: `name`,
`url`, `fetch_specs`, `params`.
```sql
SELECT * FROM dolt_remotes WHERE name = 'origin';
```

**`dolt_backups`** (read-only; modify via `dolt_backup()`). Columns: `name`,
`url`.

**`dolt_schemas`** (writable; implementation detail — use standard DDL).
Columns: `type`, `name`, `fragment`, `extra`. Stores views/triggers/etc.

**`dolt_tags`** (writable via `DOLT_TAG()`). Columns: `tag_name`, `tag_hash`,
`tagger`, `email`, `date`, `message`.

**`dolt_branch_activity`** (read-only; requires server opt-in). Columns:
`branch`, `last_read`, `last_write`, `active_sessions`, `system_start_time`.
```sql
SELECT * FROM dolt_branch_activity
WHERE active_sessions = 0 AND last_read < NOW() - INTERVAL 7 DAY;
```

**`dolt_statistics`** (read-only; not versioned). Columns: `database_name`,
`table_name`, `index_name`, `row_count`, `distinct_count`, `null_count`,
`columns`, `types`, `upper_bound`, `upper_bound_cnt`, `created_at`, `mcv1`,
`mcv2`, `mcv3`, `mcv4`, `mcvCounts`.

### History tables

**`dolt_blame_$tablename`** (read-only; needs a PK). Columns: `commit`,
`commit_date`, `committer`, `email`, `message`, `[primary key columns]`.
```sql
SELECT * FROM dolt_blame_city LIMIT 20;
```

**`dolt_commit_ancestors`** (read-only). Columns: `commit_hash`, `parent_hash`,
`parent_index`.

**`dolt_commits`** (read-only). Columns: `commit_hash`, `committer`, `email`,
`date`, `message`, `author`, `author_email`, `author_date`.
```sql
SELECT * FROM dolt_commits WHERE date < "2022-04-20";
```

**`dolt_history_$tablename`** (read-only). Columns: `commit_hash`, `committer`,
`commit_date`, `[all user table columns]`.
```sql
SELECT * FROM dolt_history_mytable;
```

**`dolt_log`** (read-only). Columns: `commit_hash`, `committer`, `email`, `date`,
`message`, `commit_order`, `parents`, `refs`, `signature`, `author`,
`author_email`, `author_date`.
```sql
SELECT * FROM dolt_log
WHERE committer = "jennifersp" AND date > "2022-04-01" ORDER BY date;
```

### Diff tables

**`dolt_commit_diff_$tablename`** (read-only). Columns: `from_commit`,
`from_commit_date`, `to_commit`, `to_commit_date`, `diff_type`, plus `from_X` /
`to_X` per table column. Requires both `to_commit` and `from_commit` in WHERE.
```sql
SELECT * FROM dolt_commit_diff_mytable
WHERE to_commit = HASHOF('feature') AND from_commit = HASHOF('main');
```

**`dolt_diff`** (read-only). Columns: `commit_hash`, `table_name`, `committer`,
`email`, `date`, `message`, `data_change`, `schema_change`, `author`,
`author_email`, `author_date`.
```sql
SELECT commit_hash, table_name, schema_change FROM dolt_diff
WHERE date BETWEEN "2022-04-01" AND "2022-04-30";
```

**`dolt_column_diff`** (read-only). Columns: `commit_hash`, `table_name`,
`column_name`, `committer`, `email`, `date`, `message`, `diff_type`, `author`,
`author_email`, `author_date`.
```sql
SELECT commit_hash, date FROM dolt_column_diff WHERE column_name = 'name';
```

**`dolt_diff_$tablename`** (read-only). Columns: `from_commit`,
`from_commit_date`, `to_commit`, `to_commit_date`, `diff_type`, plus `from_X` /
`to_X` per table column.
```sql
SELECT to_county, from_num_inmates_rated_for, to_num_inmates_rated_for
FROM dolt_diff_jails
WHERE from_commit = HASHOF("HEAD~3") AND diff_type = "modified"
ORDER BY delta DESC LIMIT 10;
```

### Working-set tables

**`dolt_conflicts`** (read-only). Columns: `table`, `num_conflicts`.

**`dolt_conflicts_$tablename`** (writable — delete rows to resolve). Columns:
`from_root_ish`, `[base_X, our_X, their_X per column]`, `our_diff_type`,
`their_diff_type`, `dolt_conflict_id`.
```sql
DELETE FROM dolt_conflicts_mytable;  -- keeps all "our" values
```

**`dolt_schema_conflicts`** (read-only). Columns: `table_name`, `description`,
`base_schema`, `our_schema`, `their_schema`.
```sql
SELECT table_name, description FROM dolt_schema_conflicts;
```

**`dolt_merge_status`** (read-only). Columns: `is_merging`, `source`,
`source_commit`, `target`, `unmerged_tables`.
```sql
SELECT * FROM dolt_merge_status;
```

**`dolt_stashes`** (read-only; modify via `dolt_stash()` or CLI). Columns:
`name`, `stash_id`, `branch`, `hash`, `commit_message`.
```sql
SELECT * FROM dolt_stashes WHERE name = 'myStash';
```

**`dolt_status`** (read-only). Columns: `table_name`, `staged`, `status`.
```sql
SELECT * FROM dolt_status WHERE staged = false;
```

**`dolt_status_ignored`** (read-only). Columns: `table_name`, `staged`,
`status`, `ignored`.
```sql
SELECT * FROM dolt_status_ignored WHERE staged = false;
```

**`dolt_workspace_$tablename`** (writable — modify `staged` or delete rows).
Columns: `id`, `staged`, `diff_type`, plus `to_X` / `from_X` per table column.
```sql
SELECT * FROM dolt_workspace_mytable WHERE staged = false;
```

### Constraint-violation tables

**`dolt_constraint_violations`** (read-only). Columns: `table`, `num_violations`.

**`dolt_constraint_violations_$tablename`** (writable — delete rows to resolve).
Columns: `from_root_ish`, `violation_type`, `[table columns]`, `violation_info`.
```sql
DELETE FROM dolt_constraint_violations_mytable;  -- marks violations resolved
```

### Config tables

**`dolt_ignore`** (writable). Columns: `pattern`, `ignored`.
```sql
INSERT INTO dolt_ignore VALUES ("generated_*", true), ("generated_exception", false);
```

**`dolt_nonlocal_tables`** (writable). Columns: `table_name`, `target_ref`,
`ref_table`, `options`.
```sql
INSERT INTO dolt_nonlocal_tables (table_name, target_ref, options)
VALUES ('global_*', 'global_branch', 'immediate');
```

**`dolt_tests`** (writable). Columns: `test_name`, `test_group`, `test_query`,
`assertion_type`, `assertion_comparator`, `assertion_value`.
```sql
INSERT INTO dolt_tests
VALUES ('check_user_count', 'users', 'SELECT * FROM users', 'expected_rows', '==', '10');
```

**`dolt_rebase`** (writable; only present during interactive rebase). Columns:
`rebase_order`, `action`, `commit_hash`, `commit_message`.
```sql
UPDATE dolt_rebase SET action = 'squash' WHERE rebase_order > 1;
```

### Access-control tables
**`dolt_branch_control`** and **`dolt_branch_namespace_control`** — permission
rules governing who may modify which branches / branch namespaces. (Listed in
the SQL-extensions index; consult the access-control docs for column detail.)

---

## System Variables (full reference)
URL: https://www.dolthub.com/docs/sql-reference/version-control/dolt-sysvars/
Relevance: **[CORE]**

> ⟦DoltGres note⟧ MySQL uses `SET @@GLOBAL.x = y` / `SET @@x = y` and
> `SET PERSIST`. Postgres uses `SET x = y`, `SHOW x`, `ALTER SYSTEM SET`, and
> `set_config()`. The variable NAMES should map, but verify the SET/SHOW syntax
> and persistence mechanism in DoltGres. Replace `dbname_` prefix conventions per
> DoltGres docs.

### General
- **`@@dbname_default_branch`** — a DB's default branch for new sessions.
  Default: branch checked out at server startup. e.g. `@@mydb_default_branch`.
- **`@@dolt_log_level`** — server log verbosity. Values: `error`, `warn`, `info`,
  `debug`, `trace`. Default from CLI/config.yaml.
- **`@@dolt_show_branch_databases`** — show branches as separate databases in
  enumeration. Default `0`. Values `0`/`1`.
- **`@@dolt_show_system_tables`** — include system tables in `SHOW TABLES` /
  `information_schema`. Default `0`. Values `0`/`1`.
- **`@@dolt_override_schema`** — map table data to the schema of a given
  commit/branch/tag; **renders the session read-only**. Default unset. Values:
  commit hash / branch / tag / `NULL`.
- **`@@dolt_transaction_commit`** — auto-create a Dolt commit per SQL
  transaction. Default `0`. Values `0`/`1`.
- **`@@dolt_transaction_commit_message`** — message for auto transaction commits.
  Default empty (uses "Transaction commit"). Global + session.
- **`@@strict_mysql_compatibility`** — disable MySQL-compat extensions (e.g.
  MariaDB TEXT/BLOB index support). Default `0`. Values `0`/`1`.
- **`@@dolt_allow_commit_conflicts`** — permit committing txns with merge
  conflicts. Default `0`. Values `0`/`1`.
- **`@@dolt_commit_verification_groups`** — run tests before
  commits/merges/cherry-picks/rebases. Default `NULL`/empty (disabled). Values:
  `"*"`, comma-separated group names, or `NULL`.
  e.g. `SET @@PERSIST.dolt_commit_verification_groups = 'unit,integration';`
- **`@@dolt_force_transaction_commit`** — ignore merge conflicts AND constraint
  violations during commit. Default `0`. Values `0`/`1`.
- **`@@dolt_dont_merge_json`** — treat concurrent JSON changes as conflicts
  (disable auto JSON merge). Default `0`. Values `0`/`1`.
- **`@@dolt_allow_ci_creation`** — gate creation of CI workflow tables. Default
  `0`. Session-scoped. Values `0`/`1`.
- **`@@dolt_auto_gc_enabled`** — background GC. Default `1`. Read once at server
  startup; not changeable at runtime. Values `0`/`1`.
- **`@@dolt_optimize_json`** — deprecated; JSON always uses optimized encoding.
  Default `1` (legacy).

### Replication
- **`@@dolt_replicate_to_remote`** — remote name for primary replication.
  `SET @@GLOBAL.dolt_replicate_to_remote = remote1;`
- **`@@dolt_async_replication`** — async remote pushes on primaries. Values
  `0`/`1`. Faster commits, more replication delay.
- **`@@dolt_read_replica_remote`** — remote that read replicas pull from.
  Requires `dolt_replicate_heads` or `dolt_replicate_all_heads`.
- **`@@dolt_replicate_heads`** — which branches replicas fetch. Comma-separated,
  supports `*`. Mutually exclusive with `dolt_replicate_all_heads`.
  `SET @@GLOBAL.dolt_replicate_heads = "main,release*";`
- **`@@dolt_replicate_all_heads`** — pull all branches at txn start. Values
  `0`/`1`. Mutually exclusive with `dolt_replicate_heads`.
- **`@@dolt_replication_remote_url_template`** — auto-create remotes for new DBs
  using a template with `{database}` placeholder. e.g.
  `'file:///share/doltRemotes/{database}'` or
  `'aws://dynamo-table:s3-bucket/{database}'`.
- **`@@dolt_read_replica_force_pull`** — force pull even when diverged. Default
  `1`. Values `0`/`1`.
- **`@@dolt_skip_replication_errors`** — ignore replication errors on read
  replicas (log warnings). Default `0`. Values `0`/`1`.

### Cluster
- **`@@dolt_cluster_role`** — `primary` or `standby`. Exists only with cluster
  replication configured. Not set directly — use `dolt_assume_cluster_role()`.
- **`@@dolt_cluster_role_epoch`** — monotonically increasing integer tracking
  role transitions; persisted, not set directly via `SET`.
- **`@@dolt_cluster_ack_writes_timeout_secs`** — timeout for primary awaiting
  standby write ack. Default `0` (no blocking). Range `0`–`60`.

### Session metadata
- **`@@dbname_head_ref`** — current session head branch. Values: branch names or
  `refs/heads/branchName`. `SET @@mydb_head_ref = 'feature-branch';` ≡
  `CALL dolt_checkout('feature-branch')`.
- **`@@dbname_head`** — read-only current HEAD commit hash. e.g. `@@mydb_head`.
- **`@@dbname_working`** — read-only working root value hash.
- **`@@dbname_staged`** — read-only staged root value hash.

### Commit identity
- **`@@dolt_author_name`** — default: `DOLT_AUTHOR_NAME` env or `user.name`.
- **`@@dolt_author_email`** — default: `DOLT_AUTHOR_EMAIL` env or `user.email`.
- **`@@dolt_author_date`** — RFC 3339 (`2006-01-02`, `2006-01-02T15:04:05`,
  `2006-01-02T15:04:05Z07:00`). Default now. e.g. `'2026-01-15T12:00:00Z'`.
- **`@@dolt_committer_name`** — default: `DOLT_COMMITTER_NAME` env or `user.name`.
- **`@@dolt_committer_email`** — default: `DOLT_COMMITTER_EMAIL` env or
  `user.email`.
- **`@@dolt_committer_date`** — controls merge commit timestamps. RFC 3339.
  `SET @@dolt_committer_date = '2023-01-15T10:00:00';`

### Statistics (also referenced from the extensions index)
`@@dolt_stats_enabled`, `@@dolt_stats_paused`, `@@dolt_stats_memory_only`,
`@@dolt_stats_branches`, `@@dolt_stats_job_interval`, `@@dolt_stats_gc_enabled`,
`@@dolt_stats_gc_interval` — control automatic statistics collection /
scheduling / GC.

### Persistence
Variables support `SET PERSIST` / `SET PERSIST_ONLY`, writing to
`.dolt/config.json` so they survive restarts. CLI equivalent:
`dolt config add --local sqlserver.global.<var> <value>`. **Limitation:**
deleting persisted variables via `RESET PERSIST` is not supported.

---

## Saved Queries
URL: https://www.dolthub.com/docs/sql-reference/version-control/saved-queries/
Relevance: [SUPPORTING] — convenience feature; version-controlled example queries
stored with the DB.

Saved queries are version-controlled SQL stored alongside the database (examples
of how the data can be queried). They live in the **`dolt_query_catalog`** system
table — columns: `id`, `display_order`, `name`, `query`, `description`.

**CLI:**
```bash
# Save with description
dolt sql --save "Example saved query" -q "show tables" -m "You can even add a long description"
# Save without description
dolt sql --save "Example saved query" -q "show tables"
# Execute a saved query
dolt sql -x "Example saved query"
```

**Manage directly via SQL:**
```sql
SELECT * FROM dolt_query_catalog;
DELETE FROM dolt_query_catalog WHERE id = 'Example saved query';
```

DoltHub surfaces saved queries in a database's **Queries** tab.

> ⟦DoltGres note⟧ The `dolt_query_catalog` table should exist in DoltGres;
> the `dolt sql --save/-x` CLI flags are Dolt-CLI specific — verify the DoltGres
> CLI equivalents.

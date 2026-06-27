---
title: "Dolt Concepts — SQL (Databases, Schema, Types, Constraints, Transactions, …)"
group: "Concepts → Dolt → SQL"
relevance: "[CORE] — DoltGres data plane for Briven"
source_urls:
  - https://www.dolthub.com/docs/concepts/dolt/sql/
  - https://www.dolthub.com/docs/concepts/dolt/sql/databases/
  - https://www.dolthub.com/docs/concepts/dolt/sql/schema/
  - https://www.dolthub.com/docs/concepts/dolt/sql/table/
  - https://www.dolthub.com/docs/concepts/dolt/sql/primary-key/
  - https://www.dolthub.com/docs/concepts/dolt/sql/types/
  - https://www.dolthub.com/docs/concepts/dolt/sql/indexes/
  - https://www.dolthub.com/docs/concepts/dolt/sql/views/
  - https://www.dolthub.com/docs/concepts/dolt/sql/constraints/
  - https://www.dolthub.com/docs/concepts/dolt/sql/triggers/
  - https://www.dolthub.com/docs/concepts/dolt/sql/procedures/
  - https://www.dolthub.com/docs/concepts/dolt/sql/users-grants/
  - https://www.dolthub.com/docs/concepts/dolt/sql/transaction/
  - https://www.dolthub.com/docs/concepts/dolt/sql/system-variables/
scope: >
  Distilled reference of Dolt's SQL concept pages. Captures the Dolt (MySQL-dialect)
  semantics as the baseline, and flags every dialect-specific item where DoltGres
  (PostgreSQL dialect) differs and must be verified separately.
fetched: 2026-06-28
---

# ⚠️ TOP WARNING — THIS GROUP NEEDS POSTGRES VERIFICATION

> **All source pages below describe Dolt, which uses the *MySQL* SQL dialect.**
> **DoltGres = the PostgreSQL-flavored sibling. It diverges substantially in this exact
> area: data types, type syntax, `AUTO_INCREMENT` vs `SERIAL`/`GENERATED`, the
> `GRANT`/roles model, the `mysql` system catalog vs Postgres `pg_*` catalogs,
> `SET`/system-variables vs Postgres GUCs/`information_schema`, and identifier quoting.**
>
> Treat the Dolt/MySQL content here as the **conceptual reference for how Dolt's
> version-control layer interacts with SQL** — that part carries over to DoltGres.
> But for any concrete syntax tagged with a `⟦DoltGres note⟧`, **do NOT copy the MySQL
> syntax into DoltGres docs**. Verify against the actual DoltGres (Postgres) behaviour first.
> Where a Postgres analog is stated, it is a *conceptual* hint marked "(verify)", not a guarantee.

---

## SQL (overview) — `/concepts/dolt/sql/`
**Relevance:** [CORE]

Dolt is a full-featured SQL database, comparable to Postgres or MySQL. Dolt itself
uses the **MySQL SQL dialect** and aims to be a drop-in MySQL replacement — you connect
with standard MySQL clients.

Supported SQL feature areas:
- Databases and tables (standard SQL structures)
- All MySQL data types
- Secondary indexes
- Foreign key and check constraints
- Views, triggers, stored procedures
- User management + permission grants
- Full transactions
- System variables for tuning

**What makes Dolt distinctive:** it layers **version control** (commit graph, branches,
diff, merge) onto ordinary SQL. The whole concepts section is about how each standard SQL
element interacts with that version-control layer. The section walks ~13 SQL concept areas,
from databases/schema up to procedures and system variables.

> ⟦DoltGres note⟧ The single biggest dialect fact for this whole group: **Dolt = MySQL
> dialect; DoltGres = PostgreSQL dialect / wire protocol.** The version-control concepts
> (commit graph, diff, merge, branches-as-transactions) carry over, but every concrete SQL
> snippet on these pages is MySQL syntax. Verify each against DoltGres/Postgres.

---

## Databases — `/concepts/dolt/sql/databases/`
**Relevance:** [CORE]

A database is "a container for a set of schema: tables, views, triggers, procedures, etc."
Queries within one database are optimized; cross-database queries are not.

**Basic ops:**
- `SHOW DATABASES` — list databases
- `USE <database>` — select a database
- Database can also be set in the connection string

**Version-control behaviour (carries over conceptually):**
- Each Dolt database has its **own independent commit graph**. Version control is
  per-database: you cannot commit across multiple databases at once, and branches cannot
  span databases.
- The **database is the unit of sharing** — clone/push/pull/fetch operate on one database.
  Replicating several databases = several clone operations from their remotes.

**Important caveat — `DROP DATABASE` is UNVERSIONED:** it permanently deletes the database
and its entire history from disk. This is deliberate (SQL import tools issue it). Keep
offline/remote backups for recovery.

**Naming (since v1.27.0):** hyphens and spaces are allowed in database names. Earlier
versions replaced them with underscores. The `DOLT_DBNAME_REPLACE` env var restores legacy
behaviour.

> ⟦DoltGres note⟧ `SHOW DATABASES` / `USE` are MySQL-isms. Postgres has no `USE`; you select
> a database at connection time (or `\c` in psql), and lists via `\l` / `SELECT datname FROM
> pg_database`. How DoltGres exposes "databases" vs Postgres schemas — verify against DoltGres.
> The version-control facts (per-DB commit graph, DB = sharing unit, `DROP DATABASE` unversioned)
> are dialect-agnostic and should hold.

---

## Schema — `/concepts/dolt/sql/schema/`
**Relevance:** [CORE]

"Schema defines the shape of the data in your database." Components:
- **Tables** — columns + rows; each column typed; require one or more primary keys whose
  combined values uniquely identify a row.
- **Columns** — may carry constraints (e.g. foreign keys referencing other tables).
- **Views** — virtual tables generated by a stored query, not stored data.
- **Secondary indexes** — improve reads, cost storage + write speed.
- **Triggers and procedures** — stored executable code (on-condition or on-call).

**Why it matters:** schema both communicates structure and drives query performance.
Primary-key and index design matter for large/complex datasets. But schema changes —
especially adding an index to an existing column — can be **expensive** (full table scan,
may block writes).

**Dolt-specific:** Dolt versions **schema and data together** and can `diff` schema changes
across commits. Dolt supports "all MySQL schema elements at least partially."

> ⟦DoltGres note⟧ The component model (tables/columns/views/indexes/triggers/procedures) is
> universal. But "all MySQL schema elements" is a MySQL-dialect statement; DoltGres targets
> Postgres schema semantics (incl. the Postgres notion of a `schema` namespace via `CREATE
> SCHEMA` / `search_path`, which differs from MySQL's "schema = database" usage). Verify.

---

## Tables — `/concepts/dolt/sql/table/`
**Relevance:** [CORE]

Tables are the fundamental schema building block: columns + rows, with primary-key columns
identifying each row. Create/alter with standard `CREATE` / `ALTER` SQL. Define
relationships via foreign-key constraints.

**Storage difference from MySQL:** both are row-major, but MySQL uses a B-tree while Dolt
uses a **content-addressed binary tree called a "prolly tree."** This is what enables fast
`diff` / version control while keeping "query performance fairly comparable to MySQL."

**Version-control integration:** tables behave like files in Git — a table is the unit of
change and the target of `dolt add`. Dolt tracks both schema and data changes across versions.

**Example:** the docs build a table `complex` with a composite primary key (`pk1`, `pk2`)
and columns covering integer, string, datetime, JSON, and binary data.

> ⟦DoltGres note⟧ `CREATE TABLE` / `ALTER TABLE` exist in both dialects but column **type
> spellings** differ (see Types section). The prolly-tree storage and table-as-unit-of-change
> facts are engine-level and carry over to DoltGres. The example's MySQL types (e.g. `datetime`,
> `json`, binary types) have Postgres analogs (`timestamp`, `jsonb`/`json`, `bytea`) — verify
> against DoltGres.

---

## Primary Keys — `/concepts/dolt/sql/primary-key/`
**Relevance:** [CORE]

"A primary key is a column or set of columns that defines a unique row in a table."
Primary keys give O(1) lookup (DB maps PK → row data).

**Rules:**
- Rows cannot share identical PK values.
- PK columns cannot be NULL.
- Multiple columns → composite primary key.
- Common PK sources: auto-incrementing IDs and `UUID()`.

You can define PKs at `CREATE TABLE` time or add them later via `ALTER TABLE`.

**Keyless tables:** tables without a primary key are implemented as a map of every column →
row counters (less efficient). In version control, keyless tables show **only additions and
deletions**, whereas keyed tables enable **cell-wise diffs and logs** (column-level row
modifications) across versions.

"Dolt primary keys function identically to MySQL primary keys" (same syntax).

> ⟦DoltGres note⟧ Two MySQL-isms to flag:
> - **`AUTO_INCREMENT`** — Postgres analog is `SERIAL`/`BIGSERIAL` or
>   `GENERATED { ALWAYS | BY DEFAULT } AS IDENTITY` (verify which DoltGres supports).
> - **`UUID()`** function — Postgres uses `gen_random_uuid()` (pgcrypto/builtin) or
>   `uuid_generate_v4()` (uuid-ossp). Verify against DoltGres.
> The keyless-table diff behaviour (adds/deletes only vs cell-wise) is engine-level and carries over.

---

## Types — `/concepts/dolt/sql/types/`
**Relevance:** [CORE]

"A column in a SQL database has a defined type, like an integer or a string." Types are a
built-in constraint defining data shape and storage footprint.

**Dolt supports all MySQL types** and the page defers to the official MySQL type manual
(`https://dev.mysql.com/doc/refman/8.0/en/data-types.html`) rather than reproducing a table.

Types are used when: defining tables, altering columns, querying (the column type determines
available functions), and casting via `CAST()`.

**Version control:** type changes are tracked and **can cause conflicts when merged**; Dolt
attempts to diff across type changes.

> ⚠️ **Fetch note:** this page does NOT contain the full type table — it only links out to
> the MySQL manual. A complete type list must be sourced separately (MySQL manual for Dolt;
> the Postgres manual / DoltGres docs for DoltGres).

> ⟦DoltGres note⟧ **This is the most divergent page of the group.** Dolt uses MySQL types;
> DoltGres uses **Postgres types**. Conceptual analogs to verify against DoltGres:
> - `TINYINT/SMALLINT/MEDIUMINT/INT/BIGINT` → Postgres `smallint/integer/bigint`
>   (no `tinyint`/`mediumint` in Postgres; `boolean` replaces `tinyint(1)`).
> - `DECIMAL/NUMERIC` → same names in Postgres (verify precision behaviour).
> - `FLOAT/DOUBLE` → `real`/`double precision`.
> - `VARCHAR/CHAR/TEXT` → same names; MySQL `TINYTEXT/MEDIUMTEXT/LONGTEXT` → Postgres `text`.
> - `DATETIME` → `timestamp`; `TIMESTAMP` semantics differ; MySQL `YEAR` has no direct Postgres type.
> - `JSON` → Postgres `json`/`jsonb`.
> - `BLOB`/binary types → Postgres `bytea`.
> - `ENUM`/`SET` → Postgres `enum` (via `CREATE TYPE`); `SET` has no native Postgres type.
> - Spatial types → Postgres uses PostGIS (`geometry`/`geography`) — verify DoltGres support.
> - `CAST()` exists in both, but `::type` cast syntax is Postgres-specific.
> **Do not reproduce the MySQL type list as DoltGres truth — build the DoltGres type list from Postgres.**

---

## Indexes — `/concepts/dolt/sql/indexes/`
**Relevance:** [CORE]

"A secondary index can be added to any column or set of columns to convert lookup queries
involving those columns into indexed lookups," giving ~O(1) retrieval at the cost of extra
storage and slightly slower inserts/updates. Called "secondary" to distinguish from primary
keys (which also provide indexed lookups). "Functionally, Dolt and MySQL indexes are equivalent."

**Create:**
```sql
create index index1 on complex(c1);
```

**Version control:** "Dolt indexes are versioned along with the core table they reference"
(historical queries keep performance), and "Dolt will merge indexes as part of a Dolt merge"
— enabling create-index workflows across branches / offline.

**Guidance:** index columns frequently used in `WHERE` clauses; accept slightly reduced
insert/update performance and have storage headroom.

> ⟦DoltGres note⟧ `CREATE INDEX ... ON table(col)` is broadly compatible, but Postgres adds
> index types/options absent in MySQL (`USING btree|hash|gin|gist|brin`, partial indexes
> `WHERE ...`, expression indexes, `CONCURRENTLY`). MySQL `FULLTEXT`/`SPATIAL` index syntax
> differs from Postgres (GIN/tsvector, GiST/PostGIS). Verify which index types DoltGres supports.
> The "indexes are versioned + merged with the table" behaviour is engine-level and carries over.

---

## Views — `/concepts/dolt/sql/views/`
**Relevance:** [CORE]

"Views look and act like tables, but the data in views is materialized on execution using a
view definition query that itself references concrete tables." Views store no data — the
underlying tables do. Reads are slower than tables because values are computed on access.
Use to derive computed tables without duplicating data (e.g. monthly from yearly).
"There is no difference between MySQL and Dolt views. They are functionally equivalent."

**Create:**
```sql
CREATE VIEW monthly_salaries AS
SELECT name, salary/12 as monthly_pay FROM salaries;
```

**Version control:** view definitions live in the `dolt_schemas` system table. You can:
1. Use `AS OF` to read a current view against a historical data snapshot, or
2. Checkout an earlier branch/commit to get an earlier view definition.

Example: `SELECT * FROM monthly_salaries AS OF 'HEAD';`

> ⟦DoltGres note⟧ `CREATE VIEW ... AS SELECT` is standard and largely portable. The
> `AS OF '<commit>'` time-travel syntax is a Dolt extension — verify DoltGres exposes the
> same (Postgres has no native `AS OF`). Whether view definitions live in `dolt_schemas` or a
> Postgres-style catalog in DoltGres — verify. Postgres also distinguishes `VIEW` vs
> `MATERIALIZED VIEW`; note Dolt views here are non-materialized (computed on read).

---

## Constraints — `/concepts/dolt/sql/constraints/`
**Relevance:** [CORE]

Constraints "restrict the values allowed in a column." Three kinds:
1. **Column-level** — `NOT NULL`, `UNIQUE`.
2. **Check constraints** — complex validation (e.g. numeric ranges / business rules).
3. **Foreign keys** — relations + referential integrity across tables.

Add via `CREATE TABLE` or `ALTER`. "MySQL and Dolt constraints are functionally equivalent."

**Examples:**
```sql
CREATE TABLE employees (
    id int,
    last_name varchar(100),
    first_name varchar(100),
    age int,
    PRIMARY KEY(id),
    CONSTRAINT over_18 CHECK (age >= 18)
);

CREATE TABLE pay (
    id int,
    salary int,
    PRIMARY KEY(id),
    FOREIGN KEY (id) REFERENCES employees(id)
);
```

**Critical merge behaviour (engine-level — carries over):**
- Different constraints on the same column across branches → merge conflicts needing manual
  resolution.
- **Foreign-key dangers from version control:**
  - *Orphaned references* — one branch adds an FK reference, another deletes the parent row;
    the merge succeeds but leaves an invalid state.
  - *Unenforced cascading actions* — `DELETE CASCADE` etc. do **not** fire during merges,
    because "merges happen at the storage layer, not at the SQL layer."

**Detecting violations:** problematic merges are blocked and surfaced via the
`dolt_constraint_violations` table. Dolt blocks the transaction by default; resolve manually
or override with `@@dolt_force_transaction_commit=1`.

> ⟦DoltGres note⟧ `NOT NULL`, `UNIQUE`, `CHECK`, `FOREIGN KEY ... REFERENCES` are all standard
> SQL and largely portable to Postgres (the example types `int`/`varchar(100)` carry over).
> The `dolt_constraint_violations` table and `@@dolt_force_transaction_commit` are Dolt
> system-table / system-variable names — in DoltGres these may be exposed differently
> (Postgres-style). Verify the exact catalog/variable names in DoltGres. Merge-violation
> semantics are engine-level and should carry over.

---

## Triggers — `/concepts/dolt/sql/triggers/`
**Relevance:** [CORE]

"Triggers are SQL statements you can set to run every time a row is inserted, updated, or
deleted from a particular table." They receive row data and can modify values. Most commonly
used to enforce complex constraints not expressible via foreign keys, nullness, types, or
`CHECK`. "Dolt triggers match MySQL triggers exactly."

**Version control:** trigger definitions are versioned in the `dolt_schemas` table (same as
views). Add/commit `dolt_schemas` after creating/altering a trigger. Example uses a
`BEFORE INSERT` trigger (increments a value) and an `AFTER INSERT` trigger (propagates to
another table); each appears as a row in `dolt_schemas` with type, name, full create
statement, id, and timestamp.

> ⟦DoltGres note⟧ **MySQL and Postgres triggers differ significantly in syntax.** MySQL puts
> the trigger body inline (`CREATE TRIGGER ... BEFORE INSERT ... FOR EACH ROW <stmt>`),
> while Postgres triggers call a `FUNCTION` (`CREATE FUNCTION ... RETURNS trigger` + `CREATE
> TRIGGER ... EXECUTE FUNCTION ...`, using `NEW`/`OLD`). Do NOT carry MySQL trigger syntax
> into DoltGres — verify the Postgres trigger model DoltGres uses. Whether definitions live
> in `dolt_schemas` in DoltGres — verify.

---

## Stored Procedures — `/concepts/dolt/sql/procedures/`
**Relevance:** [CORE]

"A stored procedure is SQL code that can be accessed using SQL `CALL`." Takes input
parameters, can return results as tables. Created by users, stored as schema.

**Create / call (MySQL-style):**
```sql
CREATE PROCEDURE example(x INT) SELECT x + 1;
CALL example(1);   -- returns a single row: 2
```

**Version control:** procedures are tracked in the `dolt_procedures` table with columns
`name`, `create_stmt`, `created_at`, `modified_at`. Stage + commit changes like any schema.

**Dolt-specific procedures:** Dolt exposes custom stored procedures for **version-control
operations**, named after the corresponding Dolt CLI commands (e.g. committing, branching),
callable via `CALL` from SQL. (These — `DOLT_COMMIT`, `DOLT_CHECKOUT`, `DOLT_MERGE`, etc. —
are the SQL interface to Dolt's git-like operations.)

> ⟦DoltGres note⟧ MySQL `CREATE PROCEDURE` differs from Postgres `CREATE PROCEDURE`/`CREATE
> FUNCTION` (Postgres uses `LANGUAGE sql|plpgsql`, `$$ ... $$` bodies, and `CALL`/`SELECT`).
> Verify DoltGres procedure syntax against Postgres. The **Dolt version-control procedures**
> are the important carry-over concept, but their invocation form in DoltGres may follow
> Postgres conventions (e.g. `SELECT dolt_commit(...)` vs `CALL`) — verify exact spelling and
> whether the backing table is `dolt_procedures` or a Postgres-style catalog.

---

## Users and Grants — `/concepts/dolt/sql/users-grants/`
**Relevance:** [CORE]

Users + grants are "SQL's permissions system." Admins create accounts and roles and authorize
operations (read/write on tables). Recommended: grant to **roles**, assign users to roles.

**Storage / version control:** "The users and grants tables exist outside of Dolt in a
separate database named `mysql`." This keeps MySQL compatibility, but means **users/grants are
NOT version-controlled** and not in Dolt history.

**Current limitations (vs MySQL):** no column-level privileges, no restricted access to stored
procedures. Grants apply only to ordinary SQL table access — **not** to version-control
operations (e.g. branch-specific write permissions) yet (roadmap item).

**Example:**
```sql
CREATE USER testuser@localhost IDENTIFIED BY 'password123';
GRANT SELECT ON db_name.example TO testuser@localhost;
```

> ⟦DoltGres note⟧ **This is heavily MySQL-specific.** MySQL's `user@host` account model,
> `IDENTIFIED BY`, the `mysql` system database, and `GRANT ... ON db.table` all differ from
> Postgres. Postgres uses **roles** (`CREATE ROLE ... LOGIN PASSWORD '...'`), `GRANT priv ON
> table TO role`, and stores them in `pg_authid`/`pg_roles` (system catalogs), not a `mysql`
> database. DoltGres almost certainly follows the Postgres role/grant model — **do NOT carry
> the `user@host` / `mysql`-database syntax into DoltGres docs.** Verify the DoltGres
> auth/role/grant model against Postgres. The fact that auth is *outside version control* is a
> design point likely to carry over (verify).

---

## Transactions — `/concepts/dolt/sql/transaction/`
**Relevance:** [CORE]

"A transaction is the unit of change isolation in a database" — manages concurrent writes for
consistency.

**Management (standard SQL):** `BEGIN` to start, `COMMIT` to persist, `ROLLBACK` to revert.
Uncommitted changes are isolated to the session until committed.

**Autocommit:** most clients enable `AUTOCOMMIT` by default — each write is wrapped in an
implicit `BEGIN`/`COMMIT` (one write = one transaction).

**Isolation:** Dolt implements **Read Committed only**, whereas MySQL supports all standard
isolation levels.

**Two-layer transaction model (key Dolt concept — carries over):**
1. Ordinary SQL `BEGIN`/`COMMIT` (like MySQL).
2. Dolt's version-control layer — **branches act as long-running transactions** that may
   eventually merge into main.

**Bridge to version control:** set `@@dolt_transaction_commit` so that every SQL transaction
commit also creates a Dolt commit.

> ⟦DoltGres note⟧ `BEGIN`/`COMMIT`/`ROLLBACK` and autocommit are common to both dialects.
> Differences to verify: Postgres supports more isolation levels (Read Committed default,
> plus Repeatable Read / Serializable) — DoltGres's actual supported set may differ from this
> "Read Committed only" Dolt statement. The `@@dolt_transaction_commit` **session-variable
> spelling is MySQL-style** (`@@var`); in Postgres/DoltGres it may be a GUC set via `SET
> dolt.transaction_commit = ...` or similar — verify. The two-layer (branch = transaction)
> concept is engine-level and carries over.

---

## System Variables — `/concepts/dolt/sql/system-variables/`
**Relevance:** [CORE]

"System variables are server-side key-value pairs" with three scopes: `PERSIST` (survive
restart), `GLOBAL` (server session), `SESSION` (single client). Init order:
`PERSIST` → `GLOBAL` → `SESSION`.

**`@@variable` syntax:**
- Read: `SELECT @@GLOBAL.var`, `SELECT @@SESSION.var`, or `SELECT @@var` (defaults to session).
- Write: `SET @@SESSION.var = value` or `SET @@GLOBAL.var = value`.

**Session vs global:** changing a global affects only *new* sessions; current sessions keep
their inherited local copy. Session changes don't affect others or the global default.

**Persistence:**
- `SET @@PERSIST.var = value` — updates current global AND persists across restarts.
- `SET @@PERSIST_ONLY.var = value` — affects only post-restart value; current global unchanged.

**Dolt-specific variables** (prefixed `dolt_` or `<dbname>_`):
- `dolt_force_transaction_commit` — create a Dolt commit for every SQL transaction.
- `dolt_allow_commit_conflicts` — permit merge conflicts during auto-commits.
- `dolt_transactions_disabled` — control transaction behaviour.
- `dolt_async_replication`, `dolt_replicate_to_remote` — replication config.
- List with `SHOW VARIABLES LIKE 'dolt_%';`

**Gotchas:**
1. Some variables are read-only (error on write).
2. Some are dynamically changeable only at session OR global scope, not both.
3. System variables are **outside version control** — each clone keeps independent config.
4. Dolt supports only a subset of MySQL's system variables (supported ones match MySQL lifecycle).
5. No variable deletion — persisted variables cannot be deleted (unlike MySQL).

> ⟦DoltGres note⟧ **The entire `@@var` / `SET @@GLOBAL`/`@@SESSION`/`@@PERSIST` syntax is
> MySQL-specific.** Postgres uses **GUCs**: `SHOW var`, `SET [SESSION|LOCAL] var = value`,
> `ALTER SYSTEM SET var = value` (persist), `ALTER DATABASE/ROLE ... SET ...`, and
> `current_setting('var')` / `pg_settings`. DoltGres will expose its Dolt settings as
> Postgres-style GUCs (likely dotted names like `dolt.force_transaction_commit` — **verify the
> exact names**), not `@@dolt_*`. Do NOT carry `@@`-syntax or `SHOW VARIABLES LIKE` into
> DoltGres docs. The scope concepts (session/global/persist) and "outside version control"
> facts carry over conceptually.

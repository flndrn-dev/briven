---
title: "DoltGres Docs Source — Concepts → Dolt → Git (Version Control / 'Git for Data')"
group: "Concepts → Dolt → Git"
scope: >
  Source material for building the DoltGres docs. These pages document Dolt
  (MySQL-flavored). DoltGres is the PostgreSQL-flavored sibling. The
  version-control CONCEPTS captured here (commit / log / diff / branch / merge /
  conflicts / remotes / working-set) are universal to both and are the HEART of
  what makes DoltGres special — they are Briven's data plane.
relevance_legend:
  - "[CORE]  — directly applies to DoltGres now (the DB platform's version control)"
  - "[LATER: DoltLab] — hosting / self-hosted-server specific, defer"
doltgres_caveat: >
  Where SQL/CLI syntax below is MySQL-flavored, it is KEPT verbatim and flagged
  with a ⟦DoltGres note⟧. DoltGres uses the Postgres equivalent (e.g. Postgres
  system-catalog / function call conventions). Exact DoltGres syntax must be
  verified against DoltGres docs — none is invented here.
source_urls:
  - https://www.dolthub.com/docs/concepts/dolt/
  - https://www.dolthub.com/docs/concepts/dolt/git/
  - https://www.dolthub.com/docs/concepts/dolt/git/commits/
  - https://www.dolthub.com/docs/concepts/dolt/git/log/
  - https://www.dolthub.com/docs/concepts/dolt/git/diff/
  - https://www.dolthub.com/docs/concepts/dolt/git/branch/
  - https://www.dolthub.com/docs/concepts/dolt/git/merge/
  - https://www.dolthub.com/docs/concepts/dolt/git/conflicts/
  - https://www.dolthub.com/docs/concepts/dolt/git/remotes/
  - https://www.dolthub.com/docs/concepts/dolt/git/working-set/
fetched: 2026-06-28
fetch_status: "all 10 pages fetched successfully"
---

# DoltGres Docs Source — Version Control Concepts ("Git for Data")

> ⟦DoltGres note⟧ Global: every CLI/SQL snippet below is **Dolt (MySQL-flavored)**.
> Keep the *concept*; treat the *syntax* as needing a Postgres-equivalent check
> in DoltGres. The version-control behaviour is identical across Dolt and DoltGres.

---

## 1. Dolt — Version-Controlled SQL Database  `[CORE]`
Source: https://www.dolthub.com/docs/concepts/dolt/

**Core concept.** Dolt combines Git-style distributed version control with a SQL
database, so data can be collaborated on the way Git let people collaborate on
source code.

**What it solves.** Before Dolt, sharing a SQL database meant both parties kept
synchronized views with sequential writes only. Copying a database meant a
point-in-time backup with no tractable way to compare or merge the copies — a
"hard fork" with no path back together. Dolt removes those constraints. Users can:
- Copy databases freely
- Make independent changes on each copy
- Compare versions across copies
- Merge changes back together
- Support thousands of concurrent readers/writers
- Roll back to earlier states
- Use branches/diffs for debugging and testing

**Four foundational axioms** (the design rules Dolt is built on):
1. "Git versions files. Dolt versions table schema and table data."
2. The CLI mirrors Git's command structure exactly (`dolt <git-command>`).
3. MySQL compatibility is maintained. *(In DoltGres: PostgreSQL compatibility.)*
4. "Git features in SQL will extend MySQL SQL. Write operations will be
   procedures. Read operations will be system tables."

**Architecture note.** Dolt was "built from the storage engine up" to deliver Git
functionality inside a relational database (it is not a layer bolted onto an
existing engine).

> ⟦DoltGres note⟧ Axiom 3 ("MySQL compatibility") and axiom 4 ("extend MySQL
> SQL") are the MySQL-flavored statements. DoltGres substitutes PostgreSQL —
> Postgres wire protocol + Postgres SQL dialect. The versioning model (axioms 1–2)
> is unchanged.

---

## 2. Dolt and Git — How Git Maps onto a SQL Database  `[CORE]`
Source: https://www.dolthub.com/docs/concepts/dolt/git/

**The big idea.** "Dolt implements Git-style version control on tables instead of
files." Git tracks changes to files across a repository; Dolt tracks changes to
rows and tables inside a database. "If you know Git, Dolt will feel very familiar
because conceptually, Dolt is modeled on Git."

**Two interfaces, two mapping styles:**

- **CLI** — a direct 1:1 replacement of `git` with `dolt`. Same subcommands, same
  argument patterns:
  - `git log` → `dolt log`
  - `git add` → `dolt add`
- **SQL** — SQL has no native Git vocabulary, so Dolt maps version control onto
  SQL primitives:
  - **Read** operations → exposed as **system tables** (e.g. `dolt_log`,
    `dolt_branches`, `dolt_diff_<table>`)
  - **Write** operations → exposed as **stored procedures** (e.g. `DOLT_COMMIT`,
    `DOLT_MERGE`, `DOLT_CHECKOUT`)

**Eight Git concepts implemented in Dolt** (each is its own page, captured below):
1. Commits — snapshot points in database history
2. Log — viewing commit history
3. Diff — comparing database states
4. Branch — parallel lines of development
5. Merge — combining branches
6. Conflicts — handling incompatible changes
7. Remotes — distributed/networked copies
8. Working Set — uncommitted changes before staging/commit

(No diagrams on the page.)

> ⟦DoltGres note⟧ The system-tables-for-reads / procedures-for-writes pattern is a
> MySQL-ism in its exact spelling. DoltGres keeps the same pattern but the call
> conventions follow Postgres (e.g. how stored procedures are invoked and how
> system relations are namespaced). Verify exact DoltGres names/syntax.

---

## 3. Commits  `[CORE]`
Source: https://www.dolthub.com/docs/concepts/dolt/git/commits/

**What a commit is.** A commit preserves the database state for later reference.
Dolt "stores the root hash (or reference) of the database in a graph of all the
commits with a link to its parent commit." A merge commit has multiple parents.
Together these commits form a **directed acyclic graph (DAG)** — the commit graph.

**Commit identifiers.** Commit hashes are a SHA-256 encoding of the entire
database state. They look like `t5d5inj4bpc1fltrdm9uoscjdsgebaih`. Dolt accepts
abbreviated forms.

**Important gotcha — two kinds of "commit".** "A Dolt commit is different from a
standard SQL transaction commit. Dolt supports both which can be a bit
confusing." A Dolt commit creates a versioned snapshot in history; a SQL
transaction `COMMIT` just ends a transaction. They are independent.

**What commits enable:** diff two commits, find a common ancestor, restore the DB
to an earlier commit, compare the working state against the last commit, review
the whole history, and read each commit's author + message.

**Dolt vs Git difference.** "In Dolt, you can create a commit via the SQL
interface. There is no analogue in Git." (Git has no SQL.)

**Each commit contains:** hash identifier · author · timestamp · message ·
parent commit reference(s).

### CLI
```bash
dolt add .                                 # stage all changes
dolt status                                # see what is staged / unstaged
dolt commit -m "Added example table docs"  # commit (needs configured username + message)
dolt commit --allow-empty -m "This is a commit"   # empty commit
```

### SQL
```sql
CALL dolt_commit('-a', '-m', 'message');   -- -a stages all, skips dolt add; returns commit hash
CALL dolt_commit('-a', '--allow-empty', '-m', 'message');  -- empty commit
```

> ⟦DoltGres note⟧ `CALL dolt_commit(...)` and `dolt add/commit/status` are
> MySQL-flavored. DoltGres uses the Postgres equivalent procedure-call form —
> verify exact syntax. The DAG/parent/hash model is identical.

---

## 4. Log  `[CORE]`
Source: https://www.dolthub.com/docs/concepts/dolt/git/log/

**What it is.** The log is a visual walk of the commit graph: commits in
"a topologically sorted commit order that led to the commit you have checked
out." It is the audit trail. **Dolt extends Git here** — you can view logs at
database, table, row, or even individual *cell* granularity.

**Three main uses:**
1. **Reverting** — find the historical state you want, then use other Dolt
   commands to restore it.
2. **Troubleshooting** — find *why* the DB reached a state by examining the
   relevant commits and their diffs.
3. **Auditing** — verify specific values haven't changed since you last read them.

### CLI — `dolt log`
Shows commit hash, author name, email, timestamp, message:
```
commit cffu3k56rtv6cf28370buivf33bb2mvr
Author: Tim Sehn <tim@dolthub.com>
Date:   Fri Dec 03 09:49:29 -0800 2021

        This is a commit
```

### SQL — `dolt_log` system table
```sql
select * from dolt_log;
```
Columns: `commit_hash`, `committer`, `email`, `date`, `message`.

### Advanced — cell-level history (`dolt_history_<tablename>`)
Unique to Dolt: see the full revision history of specific rows/cells.
```sql
select * from dolt_history_employees where id=0 order by commit_date;
```
Returns every intermediate value of that row across all commits.

> ⟦DoltGres note⟧ `dolt_log` and `dolt_history_<table>` are MySQL-flavored system
> tables. DoltGres exposes equivalents under Postgres conventions — verify names.

---

## 5. Diff  `[CORE]`
Source: https://www.dolthub.com/docs/concepts/dolt/git/diff/

**What it is.** A diff "is used to display the differences between two references,
usually commits." It captures both **schema** and **data** changes, using a
**cell-wise** approach.

**Schema diff vs data diff:**
- **Schema diff** — textual difference between the `CREATE TABLE` statements at the
  two commits. CLI only, via `dolt diff --schema`.
- **Data diff** — cell-wise comparison. When a **primary key** exists, rows are
  matched across commits by that key and non-key column updates are shown as
  modifications. Changes to a primary-key column show up as an insert+delete pair.
  **Without a primary key, "all changes look like inserts and deletes."**

**Why it scales (storage architecture).** Dolt "breaks the rows in the database
down into chunks. Each chunk is content-addressed and stored in a tree called a
**Prolly Tree**." Diffing walks the two trees and only surfaces the chunks that
differ — so diff cost is proportional to the change, not the table size. (This is
the same structure that makes merge fast — see §7.)

### CLI — `dolt diff`
Filters:
- `--filter=added` — new tables and inserted rows
- `--filter=modified` — schema modifications and row updates
- `--filter=renamed` — renamed tables
- `--filter=dropped` — dropped tables and deleted rows

```bash
dolt diff HEAD~1 --filter=added -r sql     # diff vs previous commit, added only, output as SQL
```

### SQL — `dolt_diff_<tablename>` system table
Columns include:
- target ("to") state: `to_c1`, `to_pk`, `to_commit`, `to_commit_date`
- source ("from") state: `from_c1`, `from_pk`, `from_commit`, `from_commit_date`
- `diff_type`: `added`, `modified`, or `removed`

```sql
... WHERE diff_type = 'added';
```
(For uncommitted changes, `to_commit` shows the literal `'WORKING'` — see §10.)

**Output formats:** (1) human-readable CLI table, (2) a SQL patch, (3) SQL query
results from the diff system tables.

**Practical use.** Diffs catch unexpected NULLs, surprising modification counts,
or import anomalies — by eye or programmatically via SQL.

> ⟦DoltGres note⟧ `dolt diff`, `-r sql`, and `dolt_diff_<table>` are
> MySQL-flavored. DoltGres has Postgres equivalents (incl. the `DOLT_DIFF` table
> function family) — verify syntax. Prolly-tree storage and cell-wise semantics
> are identical.

---

## 6. Branch  `[CORE]`
Source: https://www.dolthub.com/docs/concepts/dolt/git/branch/

**What a branch is.** "A branch is a named reference that starts with a parent
commit." It gives Dolt **non-distributed write isolation** — it behaves like a
long-running transaction, letting a logically-grouped set of changes stay
isolated until explicitly merged.

Key points:
- "When creating a branch you define it's parent commit and then effectively you
  have created a new copy of the Dolt database." (Cheap copy — no data duplication.)
- Changes on a branch affect only that branch until merged.
- A database starts with a default `main` branch (name configurable).
- Branches **advance** as you commit — unlike **tags**, which are immutable
  references to a single commit.

**Why it matters in server mode.** Traditional SQL transactions are short-lived
with row-level locking. Because Dolt has merge + conflict resolution, "Dolt can
essentially support long running transactions on branches." On a running Dolt
**server**, applications coordinate concurrent writes through branches rather than
through separate local clones — so branches matter even more in server mode than
on the CLI. "Conceptually Git branches and Dolt branches are the same."

### CLI
```bash
dolt branch new-branch                 # create a branch
dolt branch                            # list branches; * marks the current one
dolt checkout -b check-out-new-branch  # create AND switch to a new branch
```

### SQL — `dolt_branches` system table
```bash
dolt sql -q "select * from dolt_branches"
```
Shows each branch's hash, latest committer, committer email, commit date, message.

> ⟦DoltGres note⟧ `dolt branch/checkout`, `dolt_branches`, and the SQL procedures
> `DOLT_BRANCH` / `DOLT_CHECKOUT` (plus branch-qualified access like
> `database/branch`, `AS OF`, and `USE`) are MySQL-flavored as written here.
> DoltGres provides Postgres equivalents — verify exact spelling. The branch =
> named ref to a parent commit + cheap-copy + write-isolation model is identical.

---

## 7. Merge  `[CORE]`
Source: https://www.dolthub.com/docs/concepts/dolt/git/merge/

**What merge does.** A merge combines two branches into one database, assembling
"a reasonable combination of the two databases represented by those branches."
Crucially: merging happens "at the Dolt storage layer. No SQL is used to merge."
(It walks the Prolly trees — see §5 — and combines chunks.)

**Merge types:**
- **Fast-forward** — when the target branch has *no* new changes since the branch
  point, Dolt just moves the pointer forward / appends commits. **No merge commit
  is created.**
- **Three-way / cell-wise merge** — when both sides changed: "Dolt does a
  cell-wise merge of data." A successful non-trivial merge creates a **merge
  commit with two parents**.

**How it can be triggered (three ways):**
1. Command line
2. Dolt SQL functions/procedures
3. Implicitly, on a SQL transaction commit

**When conflicts arise.** Schema changes to *different* tables/columns merge with
no conflict. Data is merged cell-wise; if both sides changed the *same* cell to
different values, you get a conflict (see §8).

**Limitation / gotcha.** "Dolt merges can only have two parents. Merges in Git can
have N parents." (No octopus merges.)

**Role.** Merge is "a fundamental building block used to power distributed writes
to Dolt" and underpins the branch → modify → diff → merge workflow.

> ⟦DoltGres note⟧ This concept page does not give exact CLI/SQL syntax. In Dolt
> (MySQL) the operations are `dolt merge <branch>` and `CALL dolt_merge('<branch>')`
> with flags like `--no-ff`, `--abort`, `--squash`. Those specific spellings were
> NOT on this page — do not assume them for DoltGres; verify against DoltGres docs.
> The fast-forward vs cell-wise three-way model and the two-parent limit are
> universal.

---

## 8. Conflicts  `[CORE]`
Source: https://www.dolthub.com/docs/concepts/dolt/git/conflicts/

**What a conflict is.** A conflict means a merge produced a database that needs
human/explicit action — the merge algorithm couldn't infer the final state from
its rules alone. Conflicts can occur on **data** and on **schema**.

**Data conflicts** (detected at the **cell** level):
- When two sides set the same row+column to different values → conflict.
- "Primary key values are used to identify rows across versions for the purpose of
  diff and merge."
- **JSON cells:** if both sides edit a JSON value, Dolt tries to merge the
  underlying objects — different keys merge cleanly; the *same* key changed on
  both sides conflicts.
- **Keyless tables:** every column acts as part of the key. A conflict only arises
  when one side deletes a row and the other adds the identical row.

**Schema conflicts.** Occur when branches add / delete / modify same-named tables,
columns, foreign keys, indexes, or check constraints in incompatible ways (e.g.
two different type changes on one column, or two different table schemas). The
docs include detailed conflict matrices for tables, columns, foreign keys,
indexes, and check constraints.

**How conflicts are stored — `dolt_conflicts` system tables (NOT `<<<`/`>>>` markers).**
Unlike Git's inline file markers, Dolt records conflicts in system tables. Each
conflicted table gets a `dolt_conflicts_<tablename>` table exposing three values
per conflicted cell:
- **base** — the original (common-ancestor) value
- **ours** — current branch's value (marked with `*`)
- **theirs** — the merging branch's value (marked with `*`)

There is also a top-level `dolt_conflicts` table listing tables that have conflicts.

**Resolving conflicts:**
- Automated, keep current branch:
  ```bash
  dolt conflicts resolve --ours <tablename>
  ```
- Automated, keep incoming branch:
  ```bash
  dolt conflicts resolve --theirs <tablename>
  ```
- Manual: update the conflicted rows to the desired values, then delete the
  corresponding rows from `dolt_conflicts_<tablename>`.

**Constraint violations (related but distinct).** Even after conflicts are
resolved, a merge can be *invalid* because of constraint violations (e.g. a
foreign-key violation produced by combining both sides). These surface via
constraint-violation tracking (`dolt_constraint_violations` family). So
"resolved all conflicts" does not guarantee a committable merge.

**Differences from Git:** stored in system tables (not file markers); covers both
schema and data (Git is file-line only); FK/constraint violations can invalidate a
merge even after conflict resolution.

**Worked example (from the page):** two branches set the same row's column to `10`
vs `0` → data conflict appears in `dolt_conflicts_docs` showing base/ours/theirs →
resolved with the `--ours` strategy.

> ⟦DoltGres note⟧ `dolt conflicts resolve --ours/--theirs`,
> `dolt_conflicts_<table>`, and `dolt_constraint_violations` are MySQL-flavored.
> DoltGres has Postgres equivalents — verify names. base/ours/theirs semantics,
> cell-level detection, JSON merge behaviour, and keyless-table rules are identical.

---

## 9. Remotes  `[CORE for clone/push/pull;  LATER: DoltLab for self-hosting]`
Source: https://www.dolthub.com/docs/concepts/dolt/git/remotes/

**What a remote is.** "A remote is a Dolt database in another location, usually on
a different, network accessible host." Remotes are "the coordination mechanism
between many local copies of Dolt." A database can have multiple remotes at once.

**Supported remote backends:**
- **DoltHub** — hosted remote with a web UI  `[LATER: DoltLab]` *(hosting product)*
- **DoltLab** — self-hosted alternative to DoltHub  `[LATER: DoltLab]`
- Filesystem remotes  `[CORE]`
- SSH remotes  `[CORE]`
- HTTPS remotes  `[CORE]`
- AWS remotes  `[CORE]`
- GCS (Google Cloud Storage) remotes  `[CORE]`
- Git repositories used as remotes  `[CORE]`

**Core operations:**
- **Clone** — copy a remote database locally; the source automatically becomes the
  `origin` remote.
- **Fetch** — download all changes made on the remote since the last fetch.
- **Push** — send your branch's changed data, schema, and commit history to the
  remote (merging your branch with the remote branch).
- **Pull** — fetch, then merge the remote branch into your local branch.

### CLI
```bash
dolt clone timsehn/docs     # clone; source becomes "origin"
dolt remote                 # list configured remotes
dolt remote -v              # verbose: include URLs
dolt push origin main       # push branch main to remote origin
```

**Git repositories as remotes (notable).** Dolt can use a Git repo as a remote,
storing its data under Git refs (default `refs/dolt/data`). You can point at a
GitHub repo over SSH or HTTPS.

> ⟦DoltGres note⟧ This page mentions SQL-based remote operations exist but does not
> detail them here. In Dolt (MySQL) they are `CALL DOLT_CLONE/DOLT_PUSH/DOLT_PULL/
> DOLT_FETCH` plus the `dolt_remotes` system table — those exact spellings were NOT
> on this page; verify the DoltGres equivalents before using. clone/fetch/push/pull
> + origin + multi-remote semantics are universal.
>
> Hosting note: DoltHub/DoltLab are DoltHub-the-company's hosting products. For
> Briven/DoltGres, the relevant remote backends now are filesystem / SSH / HTTPS /
> cloud-bucket / Git-as-remote; a DoltHub-style UI is `[LATER: DoltLab]`-tier.

---

## 10. Working Set  `[CORE]`
Source: https://www.dolthub.com/docs/concepts/dolt/git/working-set/

**What it is.** The working set is the set of uncommitted, unstaged changes.
"Dolt has three kinds of changes: committed, staged and working. The working set
is the set of changes that has not been staged or committed." You can think of the
working set as "Dolt without version control features, just a standard MySQL
relational database" — when you start a Dolt SQL server and write without
committing, you're editing the working set.

**The three tiers:**
- **Working set** — uncommitted, unstaged changes
- **Staged** — changes added with `dolt add <table>`, ready to commit
- **Committed** — permanent history after `dolt commit`

Flow: edit → `add` (stage) → `commit` (with author + message).

**Isolation.** "Working sets are used to isolate changes to your database from
committed schema or data. Each branch gets it's own working set so you can make
changes in isolation." Unwanted changes can be thrown away with `reset` or
`checkout`.

### CRITICAL gotcha — CLI vs SQL-server checkout behaviour differ
- **Command line:** working-set changes *travel with you* to a newly checked-out
  branch (just like Git).
- **SQL server mode:** working-set changes *stay on their original branch* — they
  do **not** transfer on `dolt_checkout`. This is deliberate, so multiple
  concurrent SQL-server users can share a branch without stepping on each other.

### Examples
View pending changes:
```sql
insert into docs values (3,0);
```
```bash
dolt status
# Changes not staged for commit:
#   modified:       docs
dolt diff           # shows the inserted row with a +
```

Discard working-set changes (restore committed state):
```bash
dolt checkout docs
dolt status
# nothing to commit, working tree clean
```

CLI checkout carries the working set (row `(3,0)` follows into `follow-me`):
```bash
dolt checkout -b follow-me   # uncommitted (3,0) is still present here
```

SQL-server checkout does NOT carry the working set (row `(4,4)` is dropped):
```sql
insert into docs values (4,4);     -- working-set change
call dolt_checkout('follow-me');   -- switches branch; (4,4) does NOT follow
-- only committed rows (0-3) are visible on follow-me
```

**Working set in diff system tables.** For uncommitted changes, the
`dolt_diff_<table>` system table shows `to_commit = 'WORKING'` with a NULL
`to_commit_date` (e.g. `dolt_diff_docs`, `diff_type = 'added'`).

> ⟦DoltGres note⟧ `dolt status/add/reset/checkout`, `call dolt_checkout(...)`, and
> the `'WORKING'` sentinel are MySQL-flavored. DoltGres has Postgres equivalents —
> verify. The three-tier (working/staged/committed) model, per-branch working
> sets, and the CLI-vs-server checkout difference are universal and are an
> important gotcha to surface in DoltGres docs.

---

## Cross-cutting takeaways for the DoltGres docs section
- The version-control model is **identical** between Dolt and DoltGres; only the
  SQL dialect/wire protocol differs (MySQL → PostgreSQL).
- **Reads = system tables, writes = stored procedures** is the unifying pattern to
  teach once, then reuse per concept.
- **Prolly trees + content-addressed chunks** are the single mechanism behind both
  fast **diff** and storage-layer **merge** — worth one shared explainer.
- Three high-value gotchas to call out prominently for non-experts:
  1. Dolt commit ≠ SQL transaction commit.
  2. Conflicts live in `dolt_conflicts_*` system tables, not inline markers; and
     "no conflicts" still doesn't guarantee a valid merge (constraint violations).
  3. Working-set changes follow you on CLI checkout but are left behind on
     SQL-server checkout.
- Mark anything DoltHub/DoltLab (hosted UI) as `[LATER: DoltLab]`; the open remote
  backends (filesystem/SSH/HTTPS/cloud bucket/Git-as-remote) are `[CORE]`.

# Phase 0 — SuperTokens Core ↔ Doltgres compatibility report

**Date:** 2026-07-22  
**Who for:** flndrn decision gate before Phase 1  
**Where tested:** France live stack `briven-brivenfrance-uilsk6`, Doltgres DB `st_core_spike4`  
**Spike containers (not product):** `st-sql-proxy` + `st-core-spike`  
**Product Auth page:** still blank / retired (no product deploy of Core)

---

## DECISION (flndrn 2026-07-22): **Option B**

| | |
|--|--|
| **Chosen** | **B — native briven-engine on Doltgres** |
| **Not chosen** | A (keep fighting SuperTokens Core + permanent translator) |
| **Not chosen** | C (hybrid / stock Postgres exception) |

**What B means in plain words:**

- Product Auth data lives **only** in Doltgres (`briven_engine`).  
- Login brain = **Briven API code** (briven-engine), **not** SuperTokens Core Docker.  
- SuperTokens docs stay the **feature checklist** (what to build).  
- Branding = **Briven Auth** — no SuperTokens logo, no Core as product dependency.  
- Phase 0 is **closed**. Core spike was evidence, not the product path.

**Phase 1 under B:** blank yellow Auth shell + briven-engine online + version / “not ready for app login yet” — **only after flndrn says start Phase 1.**

---

## Plain-English summary

We asked: *can SuperTokens Core (the ready-made login engine) live inside Briven’s Doltgres database?*

**Short answer:** **Partly — only with a special “translator” box in the middle.**  
It is **not** plug-and-play. **flndrn chose not to depend on that for the product (Option B).**

Think of SuperTokens Core as a vault that only understands a very strict Postgres dialect.  
Doltgres is the same *family* (Postgres wire, port 5432), but some “words” and “error notes” are different.

With a small SQL rewrite proxy we got Core to:

- start and stay up  
- create **52** auth tables on Doltgres  
- answer **API version** successfully  

But everyday login work is **not green yet** (sign-up / hello hit duplicate-key errors because Doltgres error codes look more like MySQL than Postgres).

**Product path = B (native briven-engine).** Core remains research evidence only.

---

## What we proved (evidence)

| Check | Result | Evidence |
|-------|--------|----------|
| Doltgres accepts Postgres clients | Yes | `psql` + JDBC connect to `doltgres:5432` |
| Core 9.3 alone on Doltgres | **No** | Crash: `table not found: apps` |
| Why 9.3 fails | Doltgres says `table not found: apps`; Core 9.3 only treats Postgres text `relation "apps" does not exist` as “table missing”, so it never creates tables | Plugin `v9.3.3` `doesTableExists()` |
| Core **latest** (12.x image) alone on Doltgres | **No** | Hard-coded `SET SESSION CHARACTERISTICS…` not supported |
| Official Doltgres docs | Confirms gaps | `SET SESSION CHARACTERISTICS` ❌; `DROP … CASCADE` ❌; partitions partial; BRIN ❌ |
| SQL rewrite proxy + Core latest | **Boot yes** | Log: `Started SuperTokens on 0.0.0.0:3567` |
| Tables created on Doltgres | **52 tables** | `apps`, `tenants`, sessions, emailpassword_*, webauthn_*, oauth_*, … |
| `GET /apiversion` | **HTTP 200** | Returns CDI version list |
| `GET /hello` | **HTTP 500** | `duplicate primary key given: [public,public] (errno 1062)` |
| Email/password signup CDI | **HTTP 500** | Same duplicate-key / error-semantics issue |
| Stock Postgres for Auth product | **Forbidden** by DOLTGRES-FIRST | Not used for product path |

Proxy source saved at: `infra/st-core-doltgres-spike/rewrite_proxy.py`

---

## Compat matrix (what works / needs workaround / blocked)

| Area | Status | Notes |
|------|--------|-------|
| Wire protocol (`postgresql://`, port 5432) | Works | Same family |
| `CREATE DATABASE` / basic `CREATE TABLE` / FK / indexes | Works | Probed live |
| Named **column** `CONSTRAINT name UNIQUE` | Needs rewrite | Doltgres: “non-foreign key column constraint names are not yet supported”. Table-level named UNIQUE is OK. Proxy strips names. |
| `SET SESSION CHARACTERISTICS AS TRANSACTION…` | Needs rewrite | Official: not supported. Equivalent that works: `SET default_transaction_isolation TO 'read committed'`. Core hard-codes the bad form on every pool connection. |
| `SET TRANSACTION` isolation | Docs ❌ | Avoid relying on it |
| Table partitions (`PARTITION OF`) | Needs rewrite | Core latest creates `activity_log` partitions; Doltgres rejects. Proxy turns parent into normal table and no-ops child partitions. |
| BRIN indexes | Needs rewrite | Proxy drops `USING brin` → btree |
| `DROP … CASCADE` | Blocked / rewrite | Not used for boot; cleanup fragile |
| Core 9.3 “does table exist?” probe | Blocked without rewrite | Expects Postgres error *wording* |
| Core latest table existence via `pg_tables` | Works | Better than 9.3 |
| Runtime unique / FK error codes | **Blocked for product** | Doltgres uses MySQL-ish `errno 1062` / `HY000`; Core expects Postgres `23505` etc. Hello/signup fail because “already exists” is not recognized as OK. |
| Full recipe smoke (password, session, MFA…) | **Not proven** | Blocked by error semantics |
| Production without proxy | **No** | Hard-coded SQL + error dialects |

---

## Root causes (not guesses)

1. **Hikari init SQL (Core latest)**  
   `ConnectionPool` sets  
   `SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL READ COMMITTED`  
   Doltgres rejects this. Workaround: rewrite → `SET default_transaction_isolation TO 'read committed'`.

2. **Core 9.3 table probe**  
   `SELECT 1 FROM apps LIMIT 1` + catch only if message contains `relation` + `does not exist`.  
   Doltgres: `table not found: apps (errno 1146)`. Never creates schema.

3. **DDL dialect**  
   Named column UNIQUE constraints; partitions; BRIN — need rewrites for Core latest schema install.

4. **Runtime error dialect**  
   Duplicate key: Doltgres `errno 1062` / `HY000` vs Postgres `23505`.  
   Core’s “ignore duplicate tenant” / unique handling does not fire → 500s on hello/signup even when data is fine.

---

## Options (historical — decision made)

| Option | Status |
|--------|--------|
| **A** Keep pushing Core + translator | Rejected |
| **B** Native briven-engine on Doltgres | **CHOSEN 2026-07-22** |
| **C** Hybrid / exception | Not chosen |

---

## What Phase 1 is under Option B

| ID | Work |
|----|------|
| 1.1 | briven-engine DB `briven_engine` on Doltgres (live France ensure) |
| 1.2 | Product APIs for engine health / version (Briven-branded, not Core) |
| 1.3 | Yellow Auth UI: engine version + “not ready for app login yet” only |
| 1.4 | Confirm old customer Auth routes stay retired (410) |
| 1.5 | G-LIVE smoke + G-SEC (no open customer holes) + flndrn G-OK |

**Not in Phase 1:** SuperTokens Core container in product compose; translator proxy in production.

I will **not** start Phase 1 until flndrn says **START PHASE 1** (or equivalent).

---

## Spike hygiene

| Item | State |
|------|--------|
| `st-core-spike` | **Removed** (CLEAN SPIKE 2026-07-22) |
| `st-sql-proxy` | **Removed** |
| Spike DBs (`st_core_spike*`, `st_ddl_probe`) | **Dropped** |
| Product compose | No SuperTokens Core service |
| Auth UI | Phase 1 shell (Option B) — see `AUTH-BLANK-STATE.md` |

---

## Knowledge-base links used

- Doltgres supported commands: https://www.doltgres.com/docs/reference/sql-support/supported-commands/  
- SuperTokens postgresql plugin `ConnectionPool` / `GeneralQueries` (tags v9.3.3, v9.5.5, master)  
- Repo: `knowledge-base.md` (Doltgres section), `AI_DOCS/dolt-reference/00-doltgres-truth.md`

---

*End of Phase 0 report. Waiting on flndrn.*

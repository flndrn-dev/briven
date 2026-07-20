# 🔴 VERY IMPORTANT — Briven.tech is **DOLTGRES-FIRST**

**Status:** HARD RULE (flndrn 2026-07-21). Non-negotiable product DNA.  
**Applies to:** every agent, every PR, every backup design, every docs sentence about “the database.”

---

## The rule (one sentence)

**Briven.tech is built on Doltgres (Postgres-wire, git-for-data). Everything that stores product state must breathe Doltgres — not stock Postgres as the product engine.**

---

## What “Doltgres-first” means in practice

| Layer | Must be |
|--------|---------|
| **Control plane** (`briven_control`) | **Doltgres** database on the doltgres service (users, orgs, projects, billing, **Briven Auth**) |
| **Data plane** (each project) | **Doltgres** database per project (`proj_…`) |
| **SQL dialect** | **Postgres** SQL / wire protocol (not MySQL Dolt) |
| **DB driver (API)** | **`pg` (node-postgres)** against Doltgres — **not** `postgres.js` (wire panics) |
| **Backups (DBs)** | **`dolt_backup` / Doltgres-native**, then off-site mirror — not “stock Postgres forever” as the primary story |
| **Files (S3)** | MinIO object storage (not SQL) — still part of the platform, but not a second SQL engine |

**Stock Postgres (pgvector container):** allowed only as temporary **rollback** after cutover.  
**Forbidden:** designing new features that **require** stock Postgres for control or project data.  
**Forbidden:** docs, backup plans, or architecture that treat dual-engine (control Postgres + data Doltgres) as the **desired forever** product line.

---

## Agent checklist (before you write code)

1. Would this put product state on stock Postgres? → **Stop. Use Doltgres.**
2. Would this use MySQL Dolt APIs or `mysql` protocol? → **Stop. Use Doltgres/Postgres.**
3. Would this use `postgres.js` against Doltgres? → **Stop. Use `pg`.**
4. Would this backup control with only `pg_dump` as the long-term DR plan? → **Prefer `dolt_backup` + off-site vault.**
5. Are you about to say “we keep control on Postgres for stability”? → **Wrong product line. Raise Doltgres gaps; don’t re-split the brain.**

---

## Live topology (post cutover 2026-07-21)

```text
Doltgres (one cluster, France)
├── briven_control     ← platform brain + Auth
└── proj_<projectId>   ← each customer project’s data (+ version history)

MinIO                  ← project file buckets (S3 API)
Redis                  ← sessions / queues (ephemeral OK)
```

`BRIVEN_DATABASE_URL` → `…@doltgres:5432/briven_control`  
`BRIVEN_DATA_PLANE_URL` → `…@doltgres:5432/postgres` (provisioner admin)

---

## Related

- ADR: `docs/ADR/0004-control-on-doltgres.md` (force-add if `docs/` gitignored)
- Skill: `.claude/skills/briven/SKILL.md` (gotcha #0 / top rule)
- Memory: project `memory.md` product-line section
- Doltgres facts: `AI_DOCS/dolt-reference/00-doltgres-truth.md`

---

## Plain words (for non-coders)

Briven’s “undo button for data” is **Doltgres**.  
The whole product’s databases run on that engine — not a separate ordinary Postgres for the brain.  
Files still use object storage (S3-style). Everything else about **SQL data** is Doltgres.

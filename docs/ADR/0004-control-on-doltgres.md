# ADR-0004 — Control plane on Doltgres (product line)

**Status:** Accepted (flndrn 2026-07-21)  
**Supersedes:** dual-engine reading of ADR-0002 where control stayed on stock Postgres forever  

## Decision

**Briven is Doltgres.** Both:

1. **Control plane** (`briven_control` — users, orgs, projects, billing, Briven Auth), and  
2. **Data plane** (per-project databases),

run on the **Doltgres** engine (Postgres wire + version control).

Stock Postgres (pgvector) is **not** the product database. It may remain only as a temporary rollback artifact after cutover.

## Consequences

- `BRIVEN_DATABASE_URL` points at `doltgres:5432/briven_control`.
- Control backups use **`dolt_backup`**, not long-term `pg_dump` as the primary story.
- Off-site DR mirrors the Doltgres backup volume (+ MinIO for files).
- No `CREATE EXTENSION` / `vector` type on control (not used in schema; Doltgres beta gap).

## Migration note (2026-07-21)

Live control data was dumped from stock Postgres and restored into Doltgres database `briven_control` (row counts verified). API cut over via compose `BRIVEN_DATABASE_URL`.

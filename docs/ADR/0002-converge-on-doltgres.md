# ADR-0002: Converge the platform on DoltGres

**Status:** Accepted — 2026-06-26. Supersedes the deleted ADR-0001 (the MySQL-mode-Dolt migration).

**Cross-references:** [`SPEC.md`](../../SPEC.md) (see the 2026-06-26 engine-decision banner) · [`docs/BUILD_PLAN.md`](../BUILD_PLAN.md) (staged build plan).

---

## Context

A full re-audit of `feat/admin-manifest` found the platform **split-brained across two databases**. The control plane (`apps/api` — sign-in, project provisioning, snapshots) spoke stock **Postgres**, while the engine room (`apps/runtime`, `apps/realtime`) had been switched to **MySQL-mode Dolt** in an abandoned migration (the now-deleted ADR-0001). The two halves pointed at different databases, so **nothing worked end-to-end** — and neither half was actually DoltGres.

The owner wants a modern, git-for-data platform: one database engine, with commit/branch/diff/undo as first-class customer features. That means picking one engine and pointing every service at it.

## Decision

Converge the whole platform on **DoltGres** (Postgres-wire, git-for-data). Concretely:

- **Control plane** stays **stock Postgres** + postgres.js/drizzle. It must **NOT** point at DoltGres — it keeps its own real Postgres instance for sign-in, project metadata, billing, and secrets.
- **Customer data plane** = per-project **DoltGres DATABASES**, accessed through the **`pg`** driver. We use `pg` (not postgres.js) on the data plane because **postgres.js's extended protocol desyncs against DoltGres** (verified 2026-06-26).
- **Database-per-project** so each customer project gets its own independent commit history.
- **`SET dolt_transaction_commit=1`** is issued per write-transaction, so every write becomes an undoable commit and advances `DOLT_HASHOF('HEAD')`.
- **Realtime** works by polling `DOLT_HASHOF('HEAD')` per project, because DoltGres has no `LISTEN`/`NOTIFY`. When the hash changes, the data changed.

## Consequences

- The engine room (`apps/runtime`, `apps/realtime`) is reverted off `mysql2`; the MySQL-mode detour is removed.
- API schema-model services are repointed to **database-per-project** DoltGres.
- **Snapshots** must be redesigned on DoltGres-native commits (replacing the earlier snapshot approach).
- The **control plane needs a real Postgres instance in production** — it cannot share the DoltGres data-plane engine.
- The two-driver split (postgres.js for the control plane, `pg` for the data plane) is now a deliberate, documented constraint, not an accident.

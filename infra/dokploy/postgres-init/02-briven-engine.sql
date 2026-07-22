-- OBSOLETE for product line (DOLTGRES-FIRST).
--
-- briven-engine Auth data MUST live on Doltgres database `briven_engine`,
-- created by compose service `briven-engine-db-init` (or API ensure),
-- NOT on stock Postgres.
--
-- This file is intentionally a no-op so accidental mounts on the rollback
-- postgres container do not create a second Auth brain.
--
-- See: DOLTGRES-FIRST.md · BRIVEN-AUTH-FROM-ZERO-PLAN.md

SELECT 1;

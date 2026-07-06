-- 0049_storage_enforcement_mode — Sprint 4 Phase 4 (the deferred "block" lever).
--
-- Per-project storage enforcement mode. Default 'flag' = current behaviour
-- (surface over-limit in the admin dashboard, never block a customer). 'block'
-- = an admin opts THIS project in so new writes (studio insert / create table /
-- object upload) are refused once it is over its effective cap. Off by default;
-- the enforcement code fails OPEN. Lands on the control DB (Postgres). Additive,
-- idempotent ADD COLUMN with a default — DoltGres-safe by construction.
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "storage_enforcement_mode" text DEFAULT 'flag' NOT NULL;

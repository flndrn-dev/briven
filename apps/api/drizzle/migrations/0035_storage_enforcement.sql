-- 0035_storage_enforcement — Sprint 4 Phase 4 (the deferred "block" lever).
--
-- Per-project storage enforcement mode. Default 'flag' = current behaviour
-- (surface over-limit in the admin dashboard, never block a customer).
-- 'block' = reject new writes (createTable / insertRow) while the project is
-- over its effective cap. Off by default; an admin opts a specific project in.
-- Lands on the control DB (Postgres). Additive ADD COLUMN with default.
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "storage_enforcement" text DEFAULT 'flag' NOT NULL;

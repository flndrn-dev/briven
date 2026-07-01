-- 0034_storage_enforcement — Sprint 4 Phase 4 (the deferred "block" lever).
--
-- Per-project storage enforcement mode. Default 'flag' = current behaviour
-- (surface over-limit in admin, never block a customer). 'block' = reject new
-- writes while the project is over its effective cap. Off by default; an admin
-- opts a specific project in. DoltGres-safe: plain ADD COLUMN text + default.

ALTER TABLE "projects" ADD COLUMN "storage_enforcement" text DEFAULT 'flag' NOT NULL;

-- 0033_storage_limits — Sprint 4 storage admin.
--
-- DoltGres can't report byte sizes, so storage is governed by ROW + TABLE
-- counts. This migration makes the Free/Pro/Team caps DB-backed (so an admin
-- can edit them without a redeploy) and adds optional per-project overrides.
--
-- DoltGres-safe by construction: only text/bigint/timestamptz columns, a plain
-- PRIMARY KEY, ON CONFLICT DO NOTHING (supported), and bare ADD COLUMN. No
-- partial/expression indexes, no DO $$ blocks, no pg_catalog functions.

CREATE TABLE IF NOT EXISTS "tier_storage_caps" (
	"tier" text PRIMARY KEY NOT NULL,
	"max_rows" bigint NOT NULL,
	"max_tables" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
INSERT INTO "tier_storage_caps" ("tier", "max_rows", "max_tables") VALUES
	('free', 100000, 50),
	('pro', 5000000, 500),
	('team', 50000000, 5000)
ON CONFLICT ("tier") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "storage_max_rows" bigint;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "storage_max_tables" bigint;

-- 0050_project_storage_grants — M5 S3 sprint (cross-project storage sharing).
--
-- A GRANTER project explicitly shares one file (by file id) OR a whole path
-- prefix with a GRANTEE project. The grantee can then mint a download URL for
-- exactly the granted resource — nothing else. This is the ONLY sanctioned
-- exception to strict cross-project storage isolation.
--
-- Strict-deny by construction: access is allowed ONLY when a matching row
-- exists with revoked_at IS NULL. Revoke sets revoked_at (never deletes) so the
-- row can be re-activated on a fresh grant and the unique index stays intact.
-- Lands on the control DB (Postgres). Additive + idempotent.
CREATE TABLE IF NOT EXISTS "project_storage_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"granter_project_id" text NOT NULL,
	"grantee_project_id" text NOT NULL,
	"resource" text NOT NULL,
	"is_prefix" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_storage_grants" ADD CONSTRAINT "project_storage_grants_granter_project_id_projects_id_fk" FOREIGN KEY ("granter_project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_storage_grants_unique_idx" ON "project_storage_grants" ("granter_project_id","grantee_project_id","resource");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_storage_grants_grantee_idx" ON "project_storage_grants" ("grantee_project_id");

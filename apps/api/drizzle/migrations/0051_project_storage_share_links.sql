-- 0051_project_storage_share_links — M5 S3 sprint (tokenized public share-links).
--
-- The public-link half of M5. A file OWNER mints a signed public link — a URL
-- carrying a cryptographically-random token that ANYONE can open for a LIMITED
-- TIME, with NO project/auth needed — and can revoke it at will. Unlike a grant
-- (project→project), this exposes ONE file to the open internet.
--
-- Strict-deny by construction: a link resolves to its file ONLY when a row
-- matches the exact token AND revoked_at IS NULL AND expires_at > now(). Revoke
-- sets revoked_at (never deletes). The token is the only bearer credential and
-- is never logged. Lands on the control DB (Postgres). Additive + idempotent.
CREATE TABLE IF NOT EXISTS "project_storage_share_links" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"file_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_storage_share_links" ADD CONSTRAINT "project_storage_share_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_storage_share_links_token_idx" ON "project_storage_share_links" ("token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_storage_share_links_project_idx" ON "project_storage_share_links" ("project_id");

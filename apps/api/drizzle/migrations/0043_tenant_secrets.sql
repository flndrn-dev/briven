-- 0043_tenant_secrets — RE-ISSUE of the orphaned 0041_tenant_secrets.
--
-- 0041_tenant_secrets.sql was authored but never added to meta/_journal.json,
-- so drizzle-kit migrate skipped it forever and the table was never created in
-- any environment. Slotting 0041 back into the journal would NOT help: the
-- drizzle migrator only applies entries whose `when` is newer than the newest
-- already-applied migration, and 0042 (when=1780130000000) has already run in
-- prod — so anything dated at 0041's slot is treated as "older than last
-- applied" and skipped again. The only reliable fix is to re-issue the table
-- builder as a NEW entry dated AFTER 0042 (when=1780200000000). The 0041 file
-- is deleted alongside this to avoid two builders for the same table.
--
-- Backs services/tenant-secret-store.ts (Layer-2 per-tenant secret: HKDF-SHA256
-- per-tenant key + AES-256-GCM). One row per (project, service, name) secret —
-- e.g. a project's `google_client_secret` for the `auth` service. The body is
-- byte-for-byte the orphaned 0041 (all IF NOT EXISTS), so it is a no-op if a
-- partial create ever ran.
CREATE TABLE IF NOT EXISTS "tenant_secrets" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"service" text NOT NULL,
	"name" text NOT NULL,
	"encrypted_value" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_secrets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "tenant_secrets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_secrets_project_service_name_idx" ON "tenant_secrets" USING btree ("project_id","service","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_secrets_project_service_idx" ON "tenant_secrets" USING btree ("project_id","service");

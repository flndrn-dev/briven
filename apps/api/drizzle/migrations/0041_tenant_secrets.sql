-- 0041_tenant_secrets — persistence for per-tenant encrypted secrets.
--
-- Backs the Layer-2 secret primitive in services/tenant-secret-store.ts
-- (HKDF-SHA256 per-tenant key + AES-256-GCM). One row per
-- (project, service, name) secret — e.g. a project's `google_client_secret`
-- for the `auth` service. `encrypted_value` is the base64 ciphertext that
-- encryptTenantSecret returns; it is NEVER read directly — always through
-- services/tenant-secrets.ts which wraps decrypt. `service` stores the
-- TenantService string ('auth' | 'pay') so one table serves both briven
-- auth and pay without colliding (key derivation is service-scoped).
--
-- created_by is NULLABLE (system-set secrets have no actor) and uses
-- ON DELETE no action — a deleted user keeps the secret intact for the
-- still-living project. The (project_id, service, name) unique index is the
-- upsert key; the (project_id, service) index serves per-service listing.
-- IF NOT EXISTS guards keep this safe if a partial create ever ran.
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

-- 0034_briven_auth_sdk_keys — create the missing Auth → API Keys table.
--
-- `briven_auth_sdk_keys` exists in the Drizzle schema (db/schema.ts) but no
-- migration ever created it (the schema-diff needs a TTY — road-to-ga §2.9 —
-- so it was never generated). Result: the auth → api-keys panel 500'd with a
-- "relation does not exist" against this table. This lands it on the control
-- DB (real Postgres). IF NOT EXISTS guards keep it safe if a partial create
-- ever ran.
CREATE TABLE IF NOT EXISTS "briven_auth_sdk_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"created_by" text NOT NULL,
	"name" text NOT NULL,
	"hash" text NOT NULL,
	"prefix" text NOT NULL,
	"suffix" varchar(4) NOT NULL,
	"scope" text DEFAULT 'read' NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "briven_auth_sdk_keys_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "briven_auth_sdk_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "briven_auth_sdk_keys_hash_idx" ON "briven_auth_sdk_keys" USING btree ("hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "briven_auth_sdk_keys_project_idx" ON "briven_auth_sdk_keys" USING btree ("project_id");

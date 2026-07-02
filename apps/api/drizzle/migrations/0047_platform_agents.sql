-- 0047_platform_agents — platform-level AI-agent registry for the admin cockpit.
--
-- Backs services/platform-agents.ts. One row per admin-registered agent
-- (name + provider + optional endpoint + model + scope + enabled). The
-- provider api key is stored as AES-256-GCM ciphertext produced by
-- services/tenant-secret-store.ts (HKDF-SHA256 key salted with the agent id);
-- plaintext never lands in this table. key_prefix / key_suffix are the only
-- displayable fragments, mirroring the mcp_keys masking pattern.
CREATE TABLE IF NOT EXISTS "platform_agents" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"endpoint" text,
	"model" text NOT NULL,
	"scope" text DEFAULT 'read' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"encrypted_api_key" text,
	"key_prefix" text,
	"key_suffix" varchar(4),
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_agents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "platform_agents_name_idx" ON "platform_agents" USING btree ("name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_agents_enabled_idx" ON "platform_agents" USING btree ("enabled");

-- 0038_mcp_keys — MCP / Agent-Access keys (B Phase 5).
--
-- The on/off + key-issuing surface for the future MCP server. A key is the
-- credential an agent / MCP client presents to reach a project once MCP is
-- enabled for it. Same one-time-reveal discipline as api_keys /
-- briven_auth_sdk_keys: the plaintext is returned exactly once on issue; only
-- a sha-256 hex digest is stored, alongside a constant `prefix` and the 4-char
-- `suffix` so the dashboard can render `pk_briven_mcp_•••<suffix>`.
--
-- The GLOBAL on/off flag (mcp.enabled) and per-project enablement
-- (mcp.project.<id>) live in platform_settings — not here. The mcp.* audit
-- trail reuses the existing audit_logs table via the audit() helper; no
-- dedicated audit table is created. IF NOT EXISTS guards keep this safe if a
-- partial create ever ran.
CREATE TABLE IF NOT EXISTS "mcp_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"hash" text NOT NULL,
	"prefix" text NOT NULL,
	"suffix" varchar(4) NOT NULL,
	"scope" text DEFAULT 'read' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "mcp_keys_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "mcp_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_keys_hash_idx" ON "mcp_keys" USING btree ("hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_keys_project_idx" ON "mcp_keys" USING btree ("project_id");

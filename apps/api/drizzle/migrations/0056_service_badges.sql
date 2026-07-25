-- Standard project-scoped service badges: one badge → one product wall.
-- db = Doltgres, s3 = MinIO/S3, auth = SuperTokens-style M2M, pay = reserved.
-- Doltgres-safe: no DO $$ exception blocks (unsupported on wire path).
CREATE TABLE IF NOT EXISTS "service_badges" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"product" text NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT 'developer' NOT NULL,
	"prefix" text NOT NULL,
	"suffix" varchar(4) NOT NULL,
	"hash" text,
	"storage_key_id" text,
	"m2m_client_id" text,
	"created_by" text,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "service_badges_hash_idx" ON "service_badges" ("hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_badges_project_product_idx" ON "service_badges" ("project_id","product");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_badges_m2m_client_idx" ON "service_badges" ("m2m_client_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_badges_storage_key_idx" ON "service_badges" ("storage_key_id");

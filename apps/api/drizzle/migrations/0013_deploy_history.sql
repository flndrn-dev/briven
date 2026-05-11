-- deploy_history — one row per api boot, written from src/index.ts after
-- migrations succeed. Drives the admin "Deploys" widget and is the audit
-- trail behind /info.buildSha. See apps/api/src/db/schema.ts for the
-- field-level reasoning.

CREATE TABLE IF NOT EXISTS "deploy_history" (
  "id" text PRIMARY KEY NOT NULL,
  "service" text NOT NULL,
  "build_sha" text NOT NULL,
  "build_at" text,
  "env" text NOT NULL,
  "booted_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "deploy_history_service_booted_idx"
  ON "deploy_history" USING btree ("service", "booted_at");

CREATE INDEX IF NOT EXISTS "deploy_history_build_sha_idx"
  ON "deploy_history" USING btree ("build_sha");

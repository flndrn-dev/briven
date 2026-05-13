-- 0020_webhook_endpoints — inbound webhook receivers.
-- The public POST /webhooks/:projectId/:endpointId endpoint authenticates
-- callers via HMAC-SHA256(`${timestamp}.${rawBody}`, signingSecret). The
-- signing secret is stored AES-256-GCM-encrypted, same KEK + format as
-- project_env_vars. Every inbound request (accepted OR rejected) inserts
-- one row into webhook_deliveries — the audit log surface is the only way
-- an operator can tell "did the signature fail" vs "did my function 500".

CREATE TABLE IF NOT EXISTS "webhook_endpoints" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL,
  "name" text NOT NULL,
  "function_name" text NOT NULL,
  "signing_secret_encrypted" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "last_delivery_at" timestamp with time zone,
  "last_delivery_status" text,
  "created_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "webhook_endpoints_project_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE,
  CONSTRAINT "webhook_endpoints_created_by_fk"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "webhook_endpoints_project_name_idx"
  ON "webhook_endpoints" USING btree ("project_id", "name")
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "webhook_endpoints_project_idx"
  ON "webhook_endpoints" USING btree ("project_id")
  WHERE "deleted_at" IS NULL;

CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
  "id" text PRIMARY KEY NOT NULL,
  "endpoint_id" text NOT NULL,
  "project_id" text NOT NULL,
  "status" text NOT NULL,
  "source_ip_hash" text,
  "function_name" text,
  "duration_ms" text,
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "webhook_deliveries_endpoint_id_fk"
    FOREIGN KEY ("endpoint_id") REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE,
  CONSTRAINT "webhook_deliveries_project_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "webhook_deliveries_endpoint_idx"
  ON "webhook_deliveries" USING btree ("endpoint_id", "created_at");

CREATE INDEX IF NOT EXISTS "webhook_deliveries_project_idx"
  ON "webhook_deliveries" USING btree ("project_id", "created_at");

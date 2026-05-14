-- 0021_webhook_subscribers — outbound (platform → customer) webhooks.
-- briven emits events (abuse.report.opened, deploy.succeeded, ...) and
-- fans them out to every matching subscriber. Deliveries retry on
-- failure with exponential backoff up to 5 attempts; the dispatcher
-- claims rows via the partial index on status='pending'.

CREATE TABLE IF NOT EXISTS "webhook_subscribers" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL,
  "name" text NOT NULL,
  "target_url" text NOT NULL,
  "event_types" text NOT NULL DEFAULT '*',
  "signing_secret_encrypted" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "last_delivery_at" timestamp with time zone,
  "last_delivery_status" text,
  "created_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "webhook_subscribers_project_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE,
  CONSTRAINT "webhook_subscribers_created_by_fk"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "webhook_subscribers_project_name_idx"
  ON "webhook_subscribers" USING btree ("project_id", "name")
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "webhook_subscribers_project_idx"
  ON "webhook_subscribers" USING btree ("project_id")
  WHERE "deleted_at" IS NULL;

CREATE TABLE IF NOT EXISTS "webhook_outbound_deliveries" (
  "id" text PRIMARY KEY NOT NULL,
  "subscriber_id" text NOT NULL,
  "project_id" text NOT NULL,
  "event_id" text NOT NULL,
  "event_type" text NOT NULL,
  "payload" jsonb NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempt_count" text DEFAULT '0' NOT NULL,
  "next_attempt_at" timestamp with time zone NOT NULL,
  "last_attempt_at" timestamp with time zone,
  "status_code" text,
  "duration_ms" text,
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "webhook_outbound_deliveries_subscriber_id_fk"
    FOREIGN KEY ("subscriber_id") REFERENCES "webhook_subscribers"("id") ON DELETE CASCADE,
  CONSTRAINT "webhook_outbound_deliveries_project_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE
);

-- Dispatcher hot path: pending rows only.
CREATE INDEX IF NOT EXISTS "webhook_outbound_deliveries_due_idx"
  ON "webhook_outbound_deliveries" USING btree ("next_attempt_at")
  WHERE "status" = 'pending';

CREATE INDEX IF NOT EXISTS "webhook_outbound_deliveries_subscriber_idx"
  ON "webhook_outbound_deliveries" USING btree ("subscriber_id", "created_at");

CREATE INDEX IF NOT EXISTS "webhook_outbound_deliveries_project_idx"
  ON "webhook_outbound_deliveries" USING btree ("project_id", "created_at");

CREATE INDEX IF NOT EXISTS "webhook_outbound_deliveries_event_id_idx"
  ON "webhook_outbound_deliveries" USING btree ("event_id");

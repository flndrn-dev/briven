-- usage_events — hourly rollups, one row per (project, hour, metric).
-- The aggregation cron writes here every hour; the Polar metering push
-- worker reads pending rows and POSTs them to Polar's meter API.
-- Survives function_logs retention (free tier prunes at 7 days) so
-- historical usage queries beyond the log window still resolve.

CREATE TABLE IF NOT EXISTS "usage_events" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL,
  "metric" text NOT NULL,
  "period_start" timestamp with time zone NOT NULL,
  "value" text NOT NULL,
  "polar_push_status" text NOT NULL DEFAULT 'pending',
  "polar_pushed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- One row per (project, hour, metric). Idempotent re-runs of the cron
-- overwrite the same row instead of stacking duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS "usage_events_project_period_metric_idx"
  ON "usage_events" USING btree ("project_id", "period_start", "metric");

-- Partial index for the Polar push worker — only scans pending rows.
CREATE INDEX IF NOT EXISTS "usage_events_pending_idx"
  ON "usage_events" USING btree ("polar_push_status", "period_start")
  WHERE "polar_push_status" = 'pending';

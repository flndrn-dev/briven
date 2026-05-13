-- 0018_project_schedules — cron-triggered function invocations.
-- The dispatcher worker (apps/api/src/workers/schedule-dispatcher.ts)
-- runs every 60s, selects rows where enabled and next_run_at <= now()
-- using the partial index below, and bumps next_run_at forward in the
-- same UPDATE that records the run outcome — optimistic claim with no
-- explicit lock needed.

CREATE TABLE IF NOT EXISTS "project_schedules" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL,
  "name" text NOT NULL,
  "function_name" text NOT NULL,
  "cron_expression" text NOT NULL,
  "args" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "next_run_at" timestamp with time zone NOT NULL,
  "last_run_at" timestamp with time zone,
  "last_run_status" text,
  "last_run_error" text,
  "created_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "project_schedules_project_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE,
  CONSTRAINT "project_schedules_created_by_fk"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL
);

-- Unique per project among non-deleted rows. Soft-deleted schedules
-- don't block a customer from reusing a name.
CREATE UNIQUE INDEX IF NOT EXISTS "project_schedules_project_name_idx"
  ON "project_schedules" USING btree ("project_id", "name")
  WHERE "deleted_at" IS NULL;

-- Dispatcher hot path: enabled + due rows only.
CREATE INDEX IF NOT EXISTS "project_schedules_due_idx"
  ON "project_schedules" USING btree ("next_run_at")
  WHERE "enabled" = true AND "deleted_at" IS NULL;

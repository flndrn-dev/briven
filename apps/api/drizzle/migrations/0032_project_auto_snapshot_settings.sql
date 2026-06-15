-- 0032_project_auto_snapshot_settings — per-project automatic save-points.
-- One row per project that has automatic scheduled snapshots configured.
-- Drives the auto-snapshot worker (apps/api/src/workers/auto-snapshot.ts):
-- a project is "due" when enabled = true and next_run_at <= now(). The
-- worker then takes an `auto`-flagged snapshot and prunes auto snapshots
-- beyond retention_count — manual snapshots are never touched. The
-- per-project `_briven_snapshots` registry (in the data-plane schema)
-- gains an `auto` boolean at runtime via ensureRegistry, so no control-
-- plane migration is needed for that flag.

CREATE TABLE IF NOT EXISTS "project_auto_snapshot_settings" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "frequency" text DEFAULT 'daily' NOT NULL,
  "retention_count" integer DEFAULT 7 NOT NULL,
  "next_run_at" timestamp with time zone NOT NULL,
  "last_run_at" timestamp with time zone,
  "last_run_status" text,
  "last_run_error" text,
  "created_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "project_auto_snapshot_settings_project_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE,
  CONSTRAINT "project_auto_snapshot_settings_created_by_fk"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "project_auto_snapshot_settings_project_idx"
  ON "project_auto_snapshot_settings" USING btree ("project_id");

CREATE INDEX IF NOT EXISTS "project_auto_snapshot_settings_due_idx"
  ON "project_auto_snapshot_settings" USING btree ("next_run_at")
  WHERE "enabled" = true;

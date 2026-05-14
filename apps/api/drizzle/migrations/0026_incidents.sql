-- 0026_incidents — operator-published platform incident log.
-- Replaces the hand-curated apps/docs/src/lib/incidents.ts array. An
-- admin opens an incident via /dashboard/admin/incidents when something
-- customer-impacting starts, edits the narrative as the situation
-- unfolds, and resolves it when restored. Status page + RSS feed will
-- read from this table in a follow-up consumer turn.

CREATE TABLE IF NOT EXISTS "incidents" (
  "id" text PRIMARY KEY NOT NULL,
  "started_at" timestamp with time zone NOT NULL,
  "resolved_at" timestamp with time zone,
  "severity" text NOT NULL,
  "services" jsonb NOT NULL,
  "summary" text NOT NULL,
  "postmortem" text DEFAULT '' NOT NULL,
  "created_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "incidents_created_by_fk"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "incidents_started_idx"
  ON "incidents" USING btree ("started_at");

-- Hot path for the public status page: "is anything ongoing right now?"
CREATE INDEX IF NOT EXISTS "incidents_active_idx"
  ON "incidents" USING btree ("started_at")
  WHERE "resolved_at" IS NULL;

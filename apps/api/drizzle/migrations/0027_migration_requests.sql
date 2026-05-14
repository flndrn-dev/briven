-- 0027_migration_requests — customer-initiated migration intake.
-- The dashboard wizard at /dashboard/projects/new/migrate writes one
-- row per source-platform import request. During beta, every row is
-- triaged by an operator via /dashboard/admin/migrations and either
-- handled by the (forthcoming) automated adapter pipeline or migrated
-- by hand for free. Once the adapter for a source ships, status
-- transitions through `scheduled` → `in_progress` → `completed`
-- without an operator in the loop.

CREATE TABLE IF NOT EXISTS "migration_requests" (
  "id" text PRIMARY KEY NOT NULL,
  -- Requester. user_id is always set; org_id is the org the migrated
  -- project should land in, defaulting to the user's personal org.
  "user_id" text NOT NULL,
  "org_id" text,
  -- Source platform. Open vocabulary so we can add adapters without a
  -- migration; the wizard restricts the picker to known sources.
  "source" text NOT NULL,
  "source_url" text,
  "source_notes" text NOT NULL DEFAULT '',
  -- Rough scale signals the operator uses to triage queue order.
  "estimated_tables" integer,
  "estimated_rows" bigint,
  "estimated_functions" integer,
  -- Urgency lets the customer self-report their timeline so we don't
  -- have to ask twice. Values: exploring | this_week | this_month | this_quarter.
  "urgency" text NOT NULL DEFAULT 'exploring',
  -- Lifecycle. new → contacted → scheduled → in_progress → completed
  -- (terminal) | cancelled (terminal).
  "status" text NOT NULL DEFAULT 'new',
  "contact_email" text NOT NULL,
  -- Operator-only fields. Customer never sees these.
  "assigned_to" text,
  "operator_notes" text NOT NULL DEFAULT '',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "migration_requests_user_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "migration_requests_org_fk"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE SET NULL,
  CONSTRAINT "migration_requests_assigned_fk"
    FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL
);

-- Triage queue: operator opens the admin page sorted newest-first.
CREATE INDEX IF NOT EXISTS "migration_requests_created_idx"
  ON "migration_requests" USING btree ("created_at" DESC);

-- Hot path for the customer's own list ("my migration requests").
CREATE INDEX IF NOT EXISTS "migration_requests_user_idx"
  ON "migration_requests" USING btree ("user_id", "created_at" DESC);

-- "How many open requests do we have?" — drives the admin nav badge
-- and the operator's at-a-glance load.
CREATE INDEX IF NOT EXISTS "migration_requests_open_idx"
  ON "migration_requests" USING btree ("created_at" DESC)
  WHERE "status" NOT IN ('completed', 'cancelled');

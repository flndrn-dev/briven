-- 0029_marketing_events — minimal funnel tracking for /migrate.
--
-- Records two event types:
--   migrate_view           — fired when /migrate/<source> renders
--   migrate_lead_submitted — fired when POST /v1/migration-leads succeeds
--
-- Source values: convex | supabase | firebase | mongodb | drizzle |
-- prisma | postgres | hasura | nextauth | other | hub (the /migrate
-- index page itself).
--
-- No PII; ip_hash optional for future dedup-by-visitor logic. Customer
-- emails are recorded only in migration_requests (the actual lead).

CREATE TABLE IF NOT EXISTS "marketing_events" (
  "id" text PRIMARY KEY NOT NULL,
  "event_type" text NOT NULL,
  "source" text NOT NULL,
  "ip_hash" text,
  "user_agent" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "marketing_events_lookup_idx"
  ON "marketing_events" USING btree ("source", "event_type", "created_at" DESC);

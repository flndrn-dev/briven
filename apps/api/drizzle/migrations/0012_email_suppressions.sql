-- email_suppressions — recipients we won't send to.
-- Populated by the mittera webhook (permanent bounces, complaints,
-- mittera-side suppressions) and by operator action via the admin UI.
-- The outbound send path checks this table before posting to mittera.

CREATE TABLE IF NOT EXISTS "email_suppressions" (
  "id" text PRIMARY KEY NOT NULL,
  "email" text NOT NULL,
  "reason" text NOT NULL,
  "detail" text,
  "source_event_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "email_suppressions_email_unique" UNIQUE ("email")
);

CREATE INDEX IF NOT EXISTS "email_suppressions_email_idx"
  ON "email_suppressions" USING btree ("email");

CREATE INDEX IF NOT EXISTS "email_suppressions_created_idx"
  ON "email_suppressions" USING btree ("created_at");

-- 0025_platform_settings — dashboard-controllable platform flags.
-- Single key/value JSONB store an admin can flip without a container
-- restart. Today the only key is `openSignups`; the table is sized for
-- a handful of flags total.

CREATE TABLE IF NOT EXISTS "platform_settings" (
  "key" text PRIMARY KEY NOT NULL,
  "value" jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by" text,
  CONSTRAINT "platform_settings_updated_by_fk"
    FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL
);

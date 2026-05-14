-- 0024_signup_allowlist — invite-only beta gate.
-- When BRIVEN_OPEN_SIGNUPS=false (the private-beta default), Better
-- Auth's user.create hook rejects any email not in this table. An admin
-- adds entries via /dashboard/admin/allowlist. accepted_at is stamped
-- by the same hook the moment the email signs in for the first time,
-- so the admin sees who's claimed their invite vs who's still pending.

CREATE TABLE IF NOT EXISTS "signup_allowlist" (
  "id" text PRIMARY KEY NOT NULL,
  "email" text NOT NULL,
  "invited_by" text,
  "invited_at" timestamp with time zone DEFAULT now() NOT NULL,
  "accepted_at" timestamp with time zone,
  "notes" text,
  CONSTRAINT "signup_allowlist_invited_by_fk"
    FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "signup_allowlist_email_idx"
  ON "signup_allowlist" USING btree ("email");

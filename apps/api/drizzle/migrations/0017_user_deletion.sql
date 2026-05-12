-- 0017_user_deletion — adds the deletion_reason column so the audit
-- trail can carry a (short, optional) free-text justification the user
-- supplies when they click "delete account". `deleted_at` already
-- exists on users (migration 0001); this only adds the reason field.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "deletion_reason" text;

-- Pseudonymise PII once a row is soft-deleted: email + audit-log FKs
-- survive (so admin can correlate post-deletion incidents), but legal
-- name / address / VAT / company name / display name / image all clear
-- inside the same transaction the service runs. No DB-side trigger —
-- the service is the only path that touches deletion, and a trigger
-- would make the hard-delete cron's logic harder to reason about.

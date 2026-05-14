-- 0028_migration_requests_public — drop the NOT NULL on user_id so
-- unauthenticated leads from /migrate can submit a request without
-- creating an account first. Operator triages from /dashboard/admin/
-- migrations exactly the same way; rows with null user_id show as
-- "unauth lead" until the operator manually links them (or the
-- customer creates an account later).
--
-- This is the friction-reducing slice for non-technical users who want
-- to hear "yes, we can move you off X" before they commit to signing
-- up for a new platform.

ALTER TABLE "migration_requests" ALTER COLUMN "user_id" DROP NOT NULL;

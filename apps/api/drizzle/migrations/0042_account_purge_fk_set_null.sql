-- 0042_account_purge_fk_set_null — unblock GDPR hard-deletion.
--
-- `hardDeleteExpiredAccounts` (services/account-deletion.ts) runs
--   DELETE FROM users WHERE deleted_at < now() - 30 days
-- which ALWAYS failed with FK violation 23503 (silently swallowed by the
-- account-deletion-gc worker) because two FKs onto users.id were ON DELETE
-- NO ACTION:
--   * organizations.created_by  (and NOT NULL)
--   * audit_logs.actor_id       (already nullable)
-- Net effect: no expired account was ever purged.
--
-- Fix: make organizations.created_by nullable and flip both FKs to
-- ON DELETE SET NULL. A surviving shared org keeps its row (creator nulls
-- out); audit rows keep their action + timestamp (actor nulls out). The
-- purge transaction hard-deletes the user's own sole-owner soft-deleted
-- orgs first (their projects cascade via projects.org_id ON DELETE CASCADE),
-- then deletes the user — which now succeeds instead of raising 23503.
--
-- DROP CONSTRAINT statements list both the drizzle-style name and the
-- postgres-default `_fkey` name with IF EXISTS so the migration is robust
-- whichever name the live constraint carries.

-- organizations.created_by: drop NOT NULL, recreate FK as ON DELETE SET NULL.
ALTER TABLE "organizations" ALTER COLUMN "created_by" DROP NOT NULL;
ALTER TABLE "organizations" DROP CONSTRAINT IF EXISTS "organizations_created_by_fkey";
ALTER TABLE "organizations" DROP CONSTRAINT IF EXISTS "organizations_created_by_users_id_fk";
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;

-- audit_logs.actor_id: already nullable; recreate FK as ON DELETE SET NULL.
ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "audit_logs_actor_id_users_id_fk";
ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "audit_logs_actor_id_fkey";
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;

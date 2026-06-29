-- 0044_account_purge_fk_sweep — finish the job 0042 started.
--
-- 0042 flipped TWO foreign keys onto users.id to ON DELETE SET NULL
-- (organizations.created_by, audit_logs.actor_id) so the GDPR account
-- hard-delete (services/account-deletion.ts → hardDeleteExpiredAccounts)
-- could complete instead of raising FK violation 23503. But the SAME
-- "blocks-the-purge" class of FK was left NO ACTION on 7+ OTHER tables, so
-- the DELETE FROM users still fails for any user who created an api key,
-- sdk key, mcp key, env var, tenant secret, deployment, or invitation, OR
-- whose org owns a project that audit_logs.project_id still references.
--
-- This migration walks EVERY remaining `*_by` / `project_id` FK of that
-- class and flips it to ON DELETE SET NULL (audit Theme 0 — "fix it
-- everywhere, not in one place"). For the three keys that were also NOT
-- NULL (api_keys / briven_auth_sdk_keys / mcp_keys created_by) we DROP NOT
-- NULL first — a key stays scoped to its project; only the creator
-- attribution is severed when that user is purged.
--
-- Each DROP CONSTRAINT lists both the drizzle-style `_users_id_fk` /
-- `_projects_id_fk` name AND the postgres-default `_fkey` name with
-- IF EXISTS, so the migration is robust whichever name the live constraint
-- carries (org_invitations.invited_by was created as an inline column
-- REFERENCES, so its live name is the `_fkey` form).
--
-- Also adds the project_members(user_id) index used by the sole-owner
-- membership sweep + access checks (the composite PK is
-- (project_id, user_id), so user_id alone was unindexed).

-- api_keys.created_by: drop NOT NULL, recreate FK as ON DELETE SET NULL.
ALTER TABLE "api_keys" ALTER COLUMN "created_by" DROP NOT NULL;
ALTER TABLE "api_keys" DROP CONSTRAINT IF EXISTS "api_keys_created_by_users_id_fk";
ALTER TABLE "api_keys" DROP CONSTRAINT IF EXISTS "api_keys_created_by_fkey";
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

-- briven_auth_sdk_keys.created_by: drop NOT NULL, recreate FK as ON DELETE SET NULL.
ALTER TABLE "briven_auth_sdk_keys" ALTER COLUMN "created_by" DROP NOT NULL;
ALTER TABLE "briven_auth_sdk_keys" DROP CONSTRAINT IF EXISTS "briven_auth_sdk_keys_created_by_users_id_fk";
ALTER TABLE "briven_auth_sdk_keys" DROP CONSTRAINT IF EXISTS "briven_auth_sdk_keys_created_by_fkey";
ALTER TABLE "briven_auth_sdk_keys" ADD CONSTRAINT "briven_auth_sdk_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

-- mcp_keys.created_by: drop NOT NULL, recreate FK as ON DELETE SET NULL.
ALTER TABLE "mcp_keys" ALTER COLUMN "created_by" DROP NOT NULL;
ALTER TABLE "mcp_keys" DROP CONSTRAINT IF EXISTS "mcp_keys_created_by_users_id_fk";
ALTER TABLE "mcp_keys" DROP CONSTRAINT IF EXISTS "mcp_keys_created_by_fkey";
ALTER TABLE "mcp_keys" ADD CONSTRAINT "mcp_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

-- audit_logs.project_id: recreate FK as ON DELETE SET NULL (sibling of the
-- actor_id FK that 0042 already fixed) so a project cascade during a purge
-- doesn't block on retained audit rows. Column is already nullable.
ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "audit_logs_project_id_projects_id_fk";
ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "audit_logs_project_id_fkey";
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

-- deployments.triggered_by: recreate FK as ON DELETE SET NULL. Already nullable.
ALTER TABLE "deployments" DROP CONSTRAINT IF EXISTS "deployments_triggered_by_users_id_fk";
ALTER TABLE "deployments" DROP CONSTRAINT IF EXISTS "deployments_triggered_by_fkey";
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

-- project_invitations.invited_by: recreate FK as ON DELETE SET NULL. Already nullable.
ALTER TABLE "project_invitations" DROP CONSTRAINT IF EXISTS "project_invitations_invited_by_users_id_fk";
ALTER TABLE "project_invitations" DROP CONSTRAINT IF EXISTS "project_invitations_invited_by_fkey";
ALTER TABLE "project_invitations" ADD CONSTRAINT "project_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

-- org_invitations.invited_by: recreate FK as ON DELETE SET NULL. Already
-- nullable; live constraint is the inline-column `_fkey` form.
ALTER TABLE "org_invitations" DROP CONSTRAINT IF EXISTS "org_invitations_invited_by_users_id_fk";
ALTER TABLE "org_invitations" DROP CONSTRAINT IF EXISTS "org_invitations_invited_by_fkey";
ALTER TABLE "org_invitations" ADD CONSTRAINT "org_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

-- project_env_vars.created_by: recreate FK as ON DELETE SET NULL. Already nullable.
ALTER TABLE "project_env_vars" DROP CONSTRAINT IF EXISTS "project_env_vars_created_by_users_id_fk";
ALTER TABLE "project_env_vars" DROP CONSTRAINT IF EXISTS "project_env_vars_created_by_fkey";
ALTER TABLE "project_env_vars" ADD CONSTRAINT "project_env_vars_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

-- tenant_secrets.created_by: recreate FK as ON DELETE SET NULL. Already nullable.
ALTER TABLE "tenant_secrets" DROP CONSTRAINT IF EXISTS "tenant_secrets_created_by_users_id_fk";
ALTER TABLE "tenant_secrets" DROP CONSTRAINT IF EXISTS "tenant_secrets_created_by_fkey";
ALTER TABLE "tenant_secrets" ADD CONSTRAINT "tenant_secrets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

-- project_members(user_id) reverse-lookup index (composite PK leads with
-- project_id, so user_id alone was unindexed).
CREATE INDEX IF NOT EXISTS "project_members_user_id_idx" ON "project_members" USING btree ("user_id");

-- Project suspension state — populated by admin action (manual) or by
-- the abuse-report pipeline when a resolution lands as "suspended" or
-- "banned". A non-null suspended_at means: state-changing routes for
-- this project return 403 project_suspended; reads remain open so the
-- operator can investigate via the dashboard. See
-- apps/api/src/services/abuse.ts and middleware/project-suspended.ts
-- for the enforcement points.

ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "suspended_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "suspend_reason" text;

CREATE INDEX IF NOT EXISTS "projects_suspended_at_idx"
  ON "projects" USING btree ("suspended_at")
  WHERE "suspended_at" IS NOT NULL;

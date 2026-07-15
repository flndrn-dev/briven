-- Add auth_domain column to projects for fast custom-auth-subdomain lookup
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "auth_domain" text;
CREATE UNIQUE INDEX IF NOT EXISTS "projects_auth_domain_idx" ON "projects"("auth_domain");

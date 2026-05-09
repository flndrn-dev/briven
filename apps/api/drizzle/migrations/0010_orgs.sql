-- Move from user-owned to org-owned data model.
-- Runs in one transaction; rollback on any error leaves the DB untouched.

BEGIN;

-- 1. New tables
CREATE TABLE "organizations" (
  "id" text PRIMARY KEY NOT NULL,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "personal" boolean DEFAULT false NOT NULL,
  "created_by" text NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);
CREATE UNIQUE INDEX "organizations_slug_idx" ON "organizations" ("slug");

CREATE TABLE "org_members" (
  "org_id" text NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" text DEFAULT 'developer' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("org_id", "user_id")
);
CREATE INDEX "org_members_user_id_idx" ON "org_members" ("user_id");

-- 2. Seed one personal org per existing user.
-- Slug derived from email local-part, lowercased, non-alnum → '-'.
-- For today's single dev user there is no slug collision; for any future
-- pre-migration collision the INSERT will fail and the whole transaction
-- rolls back — safer than silently salting.
INSERT INTO "organizations" ("id", "slug", "name", "personal", "created_by", "created_at", "updated_at")
SELECT
  'org_' || u."id",
  lower(regexp_replace(split_part(u."email", '@', 1), '[^a-z0-9]+', '-', 'gi')),
  COALESCE(NULLIF(u."name", ''), split_part(u."email", '@', 1)),
  true,
  u."id",
  now(),
  now()
FROM "users" u;

-- 3. Make each user the owner of their personal org.
INSERT INTO "org_members" ("org_id", "user_id", "role", "created_at", "updated_at")
SELECT 'org_' || u."id", u."id", 'owner', now(), now()
FROM "users" u;

-- 4. Add nullable org_id FK columns.
ALTER TABLE "subscriptions" ADD COLUMN "org_id" text REFERENCES "organizations"("id") ON DELETE CASCADE;
ALTER TABLE "projects"      ADD COLUMN "org_id" text REFERENCES "organizations"("id") ON DELETE CASCADE;

-- 5. Backfill — each row points to its owner's personal org.
UPDATE "subscriptions" SET "org_id" = 'org_' || "owner_id";
UPDATE "projects"      SET "org_id" = 'org_' || "owner_id";

-- 6. Lock it down.
ALTER TABLE "subscriptions" ALTER COLUMN "org_id" SET NOT NULL;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_org_idx" UNIQUE ("org_id");
ALTER TABLE "projects"      ALTER COLUMN "org_id" SET NOT NULL;
CREATE INDEX "projects_org_idx" ON "projects" ("org_id");

-- 7. Drop the old unique-per-owner constraint on subscriptions, and the old owner_id columns.
DROP INDEX IF EXISTS "subscriptions_owner_idx";
DROP INDEX IF EXISTS "projects_owner_idx";
ALTER TABLE "subscriptions" DROP COLUMN "owner_id";
ALTER TABLE "projects"      DROP COLUMN "owner_id";

COMMIT;

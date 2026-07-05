-- 0048_auth_signup_geo — control-plane sign-up IP + geo capture (admin-only SEO).
--
-- Backs services/signup-geo.ts (write, from the per-tenant Better Auth
-- user.create hook) and services/signup-geo-admin.ts (read, admin cockpit).
-- One row per end-user sign-up across ALL briven-auth tenant projects.
--
-- DELIBERATE: stores the RAW ip (flndrn-approved) in the control plane,
-- admin-side only. Independent of Better Auth's own session ip tracking and
-- of the per-project customer users page (which never reads this table).
--
-- All statements are IF NOT EXISTS so a partial/re-run apply is a no-op.
-- Journal note: the newest journalled entry in this repo is 0033
-- (when=1779570000000); this entry is dated well after it so the drizzle
-- migrator applies it regardless of which older files ever landed.
CREATE TABLE IF NOT EXISTS "auth_signup_geo" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text,
	"email" text,
	"ip" text,
	"country" text,
	"city" text,
	"region" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_signup_geo_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_signup_geo_created_idx" ON "auth_signup_geo" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_signup_geo_project_created_idx" ON "auth_signup_geo" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_signup_geo_country_idx" ON "auth_signup_geo" USING btree ("country");

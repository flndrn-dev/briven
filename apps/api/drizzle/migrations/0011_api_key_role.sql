-- Add `role` column to `api_keys` so each key carries an effective role
-- (viewer / developer / admin). Defaults to 'admin' so keys minted before
-- this migration keep their previous full-power semantics; new keys can
-- be issued at any standard role at creation time. 'owner' is never
-- assignable to a key — reserved for human owners.

BEGIN;

ALTER TABLE "api_keys" ADD COLUMN "role" text DEFAULT 'admin' NOT NULL;

COMMIT;

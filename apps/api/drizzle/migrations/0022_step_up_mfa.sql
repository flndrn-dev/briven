-- 0022_step_up_mfa — last_mfa_at column on users for step-up auth.
-- CLAUDE.md §5.4 requires admin actions to carry recent (≤10 min)
-- re-authentication. The middleware reads this column on the route;
-- POST /v1/auth/step-up bumps it after a successful password prompt.
-- No index — every admin request reads this single field from the
-- already-loaded user row.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "last_mfa_at" timestamp with time zone;

-- usage_events.pushed_value — the running total already delivered to Polar
-- for a GAUGE row (storage_bytes, auth_mau). The Polar meter push sends
-- `value - pushed_value` (delta-to-latest) and advances pushed_value on a
-- 2xx, so a SUM-type meter bills the latest gauge value exactly once and can
-- never over-count the ~720 hourly snapshots a billing month produces.
-- NULL for counter rows (invocations, connection_seconds), which keep
-- pushing their absolute hourly value unchanged.
ALTER TABLE "usage_events" ADD COLUMN IF NOT EXISTS "pushed_value" text;

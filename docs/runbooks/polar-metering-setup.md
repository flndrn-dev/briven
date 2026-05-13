# Polar metering — setup checklist

**Owner:** J. **Audience:** operator wiring Polar so billing for over-tier usage actually goes out.

This runbook covers the Polar-side configuration that has to land for the briven meter push worker to do useful work. The code is shipped (see `apps/api/src/workers/polar-meter-push.ts` and `apps/api/src/workers/usage-aggregator.ts`); only the Polar dashboard config + a handful of env vars block the GA billing flow.

---

## 1. What briven sends

The hourly aggregator writes one `usage_events` row per `(project, hour, metric)` for each active project. The push worker drains those rows and POSTs one event per row to Polar:

```
POST {BRIVEN_POLAR_API_BASE}/v1/meters/{meter_id}/events
Authorization: Bearer {BRIVEN_POLAR_ACCESS_TOKEN}
Content-Type: application/json

{
  "customer_id": "<polar customer id, from subscriptions.polar_customer_id>",
  "value":        <number>,
  "timestamp":    "<ISO8601 — first ms of the UTC hour the row covers>"
}
```

Metric semantics:

| Metric | Type | Value unit | Notes |
|---|---|---|---|
| `invocations` | counter | invocations in the hour | Sum these across the billing period to get total invocations. |
| `storage_bytes` | gauge | bytes at end of hour | Average or max across the period — bytes are not additive over time. |
| `connection_seconds` | counter | realtime connection-seconds in the hour | Not yet emitted by the aggregator (see TODO §A — needs a `/metrics` scraper). Polar meter can be created today; values start flowing once the scraper lands. |

---

## 2. Polar dashboard steps

1. **Create three meters** under Polar → Meters. Names below are conventional; the meter id is what matters.
   - `briven_invocations` — unit "invocation", aggregation **sum** across the period.
   - `briven_storage_bytes` — unit "byte", aggregation **average** (or **max**) across the period.
   - `briven_connection_seconds` — unit "second", aggregation **sum**.
2. **Copy each meter id** into the api env:
   ```
   BRIVEN_POLAR_METER_INVOCATIONS_ID=meter_…
   BRIVEN_POLAR_METER_STORAGE_ID=meter_…
   BRIVEN_POLAR_METER_CONNECTION_ID=meter_…
   ```
   Without these set the worker logs `polar_push_skipped_no_meter` and marks the row skipped.
3. **Attach overage prices** to the Pro and Team products. Free tier is hard-capped — it never overages, so no Polar price is needed there.
   - Pro overage:
     - invocations: `€0.20 per 100,000` above the 1,000,000 included.
     - storage: `€0.10 per GiB-month` above the 10 GiB included.
     - connection_seconds: `€0.05 per 1,000,000 seconds` above the 10,000,000 included.
   - Team overage:
     - invocations: `€0.10 per 100,000` above the 10,000,000 included.
     - storage: `€0.05 per GiB-month` above the 100 GiB included.
     - connection_seconds: `€0.025 per 1,000,000 seconds` above the 100,000,000 included.

   (Exact numbers above are placeholders — confirm against the pricing page on briven.tech before clicking "publish" in Polar.)
4. **Smoke-test** with a single event:
   - In the Polar dashboard, navigate to the meter and watch the live events feed.
   - On the briven api host, run a single hour of the aggregator manually (`bun run -e "import('./dist/workers/usage-aggregator.js').then(m => m.aggregateUsageForCompletedHour())"`). One row per active project per metric should land.
   - Watch the api logs for `polar_push_pushed` (success) or `polar_push_skipped_*` (configuration gap). 4xx in the body usually means the customer id isn't recognised by Polar — verify `subscriptions.polar_customer_id` actually exists in your Polar tenant.

---

## 3. Unit conversions the code expects

The aggregator writes raw values — no scaling, no rounding. If you change the unit on the Polar side (e.g. GiB instead of bytes), you change the price unit too. Recommended: keep the meter unit identical to what briven sends, and price per-X via the Polar price config.

| Metric | What briven sends | What Polar shows | Common pricing unit |
|---|---|---|---|
| `invocations` | one integer per hour | sum over period | per 100,000 invocations |
| `storage_bytes` | byte count at end of hour | average over period | per GiB (1 GiB = 1,073,741,824) |
| `connection_seconds` | second count per hour | sum over period | per 1,000,000 seconds |

---

## 4. What happens on a configuration gap

The worker is intentionally noisy about misconfiguration so an operator can spot the gap in logs without staring at the DB:

| Log key | Meaning | What to do |
|---|---|---|
| `polar_push_skipped_no_token` | `BRIVEN_POLAR_ACCESS_TOKEN` unset | Add the token, restart api, reset skipped rows to pending. |
| `polar_push_skipped_no_meter` | No `BRIVEN_POLAR_METER_*_ID` for the row's metric | Create the meter in Polar, set the env var, restart. |
| `polar_push_skipped_no_customer` | Project's org has no `polar_customer_id` (never checked out) | Expected for free-tier projects that haven't upgraded. No fix needed. |
| `polar_push_skipped_bad_value` | usage_events.value isn't finite | Look at the row, fix manually, re-run aggregator for that hour. |
| `polar_push_skipped_4xx` | Polar rejected the payload | Read `body` for the reason — usually a stale customer id or wrong meter id. Manual cleanup required; resetting status='pending' won't help. |
| `polar_push_retry` | Network or 5xx | No action — the row stays pending and the next tick retries. |

---

## 5. Re-enabling skipped rows

After a config fix, the rows already marked `skipped` won't be retried automatically. Reset them:

```sql
UPDATE usage_events
SET polar_push_status = 'pending', polar_pushed_at = NULL
WHERE polar_push_status = 'skipped'
  AND period_start >= now() - interval '7 days';
```

Adjust the window to match how far back the gap actually went. The push worker drains in batches of 50 per tick (once per minute), so a couple thousand backlog rows clear in well under an hour.

---

## 6. Open follow-ups (Claude work, queued)

- **`connection_seconds` scraper** — the aggregator already writes `storage_bytes` and `invocations`; the realtime `/metrics` scrape lives on a separate path (Prometheus → Loki) and isn't yet feeding `usage_events`. A small periodic job that walks `/metrics` from the api → realtime and deltas the counter into `usage_events` will close this.
- **`usage_rollups` snapshot table** — `function_logs` is pruned to 7 days on free, so invocations past the retention window are under-counted on the dashboard. A daily snapshot landed pre-prune would close this; gated on the drizzle-kit TTY-prompt unblock (see TODO cross-cutting).
- **Deploy-time storage-cap enforcement** — caps are surfaced today but not hard-enforced. Wire `assertStorageBytesAllowed(projectId)` into the deploy path once the meter push has been live long enough that the numbers are trusted.

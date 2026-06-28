import { createMetricsRegistry } from '@briven/shared/observability';

/**
 * realtime's metrics registry. Surface (incCounter / registerGauge /
 * renderPrometheus) is preserved so the call sites in `index.ts` are
 * unchanged. Histograms aren't used today; the registry supports them
 * if a latency metric lands later.
 */
const registry = createMetricsRegistry({
  help: {
    briven_realtime_subscriptions_active: 'Active websocket subscriptions',
    briven_realtime_channels_active: 'Distinct channels currently watched via commit-diff polling',
    briven_realtime_notifies_total: 'Total change events detected via Dolt commit-diff polling',
    briven_realtime_reinvoke_total:
      'Total function re-invocations triggered by change events, by outcome',
    briven_realtime_poll_failures_total:
      'Total poll cycles that errored or fell back, by reason',
    briven_realtime_fanout_latency_ms:
      'Latency from change detection to all frames shipped for a channel, in ms',
  },
});

export const incCounter = registry.incCounter;
export const registerGauge = registry.registerGauge;
export const renderPrometheus = registry.render;

/**
 * Record a latency observation for a histogram metric. The shared registry
 * supports native histograms (bucketed `_bucket`/`_sum`/`_count` exposition),
 * so this delegates straight through. Kept as a named export with a stable
 * signature because another module depends on it. Never throws.
 */
export function observeHistogram(
  name: string,
  value: number,
  labels?: Record<string, string>,
): void {
  try {
    registry.observeHistogram(name, value, labels);
  } catch {
    /* metrics must never break the hot path */
  }
}

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
    briven_realtime_channels_active: 'Distinct channels currently watched (Phase 1 stub; Phase 2 commit-diff)',
    briven_realtime_notifies_total: 'Total change events received (Phase 1 stub; Phase 2 commit-diff)',
    briven_realtime_reinvoke_total:
      'Total function re-invocations triggered by change events, by outcome',
  },
});

export const incCounter = registry.incCounter;
export const registerGauge = registry.registerGauge;
export const renderPrometheus = registry.render;

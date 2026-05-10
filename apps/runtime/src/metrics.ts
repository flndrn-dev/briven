import { createMetricsRegistry } from '@briven/shared/observability';

/**
 * runtime's metrics registry. The registerPoolGauges helper is the
 * runtime-specific binding to the IsolatePool — it stashes a pull-based
 * provider that snapshots `describeForMetrics()` at scrape time, so the
 * spawn / invoke hot paths stay free of gauge bookkeeping.
 */
const registry = createMetricsRegistry({
  help: {
    briven_runtime_invocations_total: 'Total invocations completed',
    briven_runtime_invocation_duration_ms: 'Invocation duration (ms)',
    briven_runtime_isolate_spawns_total: 'Total isolate spawn attempts by outcome',
    briven_runtime_cold_start_ms: 'Isolate cold-start latency (ms)',
    briven_runtime_isolate_kills_total: 'Total isolate kills by reason',
    briven_runtime_crash_loop_breaks_total: 'Crash-loop breaker trips',
    briven_runtime_pool_size: 'Total isolates in pool',
    briven_runtime_isolates_by_state: 'Isolates in each lifecycle state',
  },
});

export const incCounter = registry.incCounter;
export const observeHistogram = registry.observeHistogram;
export const renderPrometheus = registry.render;
export const resetMetrics = registry.reset;

export function registerPoolGauges(pool: {
  describeForMetrics(): { isolatesByState: Record<string, number>; poolSize: number };
}): void {
  registry.registerGauge('briven_runtime_pool_size', () => {
    const snap = pool.describeForMetrics();
    return [{ labels: {}, value: snap.poolSize }];
  });
  registry.registerGauge('briven_runtime_isolates_by_state', () => {
    const snap = pool.describeForMetrics();
    return Object.entries(snap.isolatesByState).map(([state, value]) => ({
      labels: { state },
      value,
    }));
  });
}

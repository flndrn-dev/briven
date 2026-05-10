import { createMetricsRegistry } from '@briven/shared/observability';

/**
 * api's metrics registry. Single instance per process; the route in
 * `routes/health.ts` exposes `render()` at /metrics, the middleware in
 * `middleware/metrics.ts` calls `incCounter` + `observeHistogram` per
 * request.
 */
const registry = createMetricsRegistry({
  help: {
    http_requests_total: 'Total HTTP requests handled by the api, by method, status, and route',
    http_request_duration_ms: 'HTTP request duration (ms), by method and route',
    briven_api_audit_writes_total: 'Total audit-log rows written, by action namespace',
  },
});

export const incCounter = registry.incCounter;
export const observeHistogram = registry.observeHistogram;
export const registerGauge = registry.registerGauge;
export const renderPrometheus = registry.render;
export const resetMetrics = registry.reset;

import type { MiddlewareHandler } from 'hono';

import { incCounter, observeHistogram } from '../lib/metrics.js';
import { recordAuthRoute5xx } from '../services/auth-reliability.js';

/**
 * Records `http_requests_total{method,status,route}` and
 * `http_request_duration_ms{method,route}` for every request that reaches
 * a handler. Uses Hono's matched-route pattern (`c.req.routePath`) rather
 * than the raw path so dynamic segments don't blow up label cardinality —
 * `/v1/projects/p_abc.../functions/foo` becomes the same label as
 * `/v1/projects/p_xyz.../functions/bar`.
 *
 * Skips its own `/metrics` endpoint to keep prometheus scrapes from
 * polluting the metric they're scraping.
 */
export const metricsMiddleware = (): MiddlewareHandler => async (c, next) => {
  // Hono v4 exposes the matched pattern via `routePath`. Falls back to the
  // raw path if for some reason it's missing (older middleware order, etc).
  const start = performance.now();
  await next();
  const durationMs = performance.now() - start;

  const route =
    typeof (c.req as { routePath?: unknown }).routePath === 'string'
      ? ((c.req as { routePath: string }).routePath || c.req.path)
      : c.req.path;

  if (route === '/metrics') return;

  const labels = {
    method: c.req.method,
    route,
  };
  incCounter('http_requests_total', { ...labels, status: String(c.res.status) });
  observeHistogram('http_request_duration_ms', durationMs, labels);

  // S6.3: auth-path 5xx for operator snapshot + Prometheus.
  const status = c.res.status;
  if (status >= 500) {
    const path = c.req.path;
    if (
      path.includes('/auth') ||
      path.includes('/auth-tenant') ||
      path.includes('/v1/auth')
    ) {
      recordAuthRoute5xx();
    }
  }
};

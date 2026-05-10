import { createLogger } from '@briven/shared/observability';

import { env } from '../env.js';

/**
 * Structured JSON logger. Per CLAUDE.md §5.1:
 * - log structure, never customer content
 * - redact credentials; never log IPs or emails
 * - log shape stays stable so Grafana/Loki queries are cheap
 *
 * Delegates to the shared `createLogger` factory, which applies redaction
 * recursively across `msg` and `fields` so no caller can accidentally leak
 * an email or IPv4 into Loki even if they forget to scrub it locally.
 */
export const log = createLogger({
  service: 'api',
  env: env.BRIVEN_ENV,
  level: env.BRIVEN_LOG_LEVEL,
});

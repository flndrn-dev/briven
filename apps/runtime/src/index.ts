import { resolve } from 'node:path';

import { constantTimeEqual, resolveBuildIdentity } from '@briven/shared';
import { createLogger } from '@briven/shared/observability';
import { Hono } from 'hono';
import { z } from 'zod';

import { env } from './env.js';

const log = createLogger({
  service: 'runtime',
  env: env.BRIVEN_ENV,
  level: env.BRIVEN_LOG_LEVEL,
});
import { handleInvoke } from './invoke.js';
import { registerPoolGauges, renderPrometheus } from './metrics.js';
import { getPool } from './runtime-bootstrap.js';
import type { InvokeRequest } from './types.js';

const BOOT_TIME = new Date().toISOString();
// Same .git/HEAD fallback as apps/api + apps/realtime. From
// /app/apps/runtime, the repo root's .git is two levels up.
const { buildSha: BUILD_SHA, buildAt: BUILD_AT } = resolveBuildIdentity(
  resolve(process.cwd(), '../../.git'),
);

const invokeSchema = z.object({
  projectId: z.string().min(1),
  functionName: z.string().min(1).max(128),
  deploymentId: z.string().min(1),
  requestId: z.string().min(1),
  args: z.unknown(),
  auth: z
    .object({
      userId: z.string().min(1),
      tokenType: z.enum(['session', 'api_key']),
    })
    .nullable()
    .default(null),
  env: z.record(z.string(), z.string()).optional(),
});

const app = new Hono();

app.get('/health', (c) =>
  c.json({ status: 'ok', service: 'runtime', executor: env.BRIVEN_RUNTIME_EXECUTOR }),
);

app.get('/info', (c) =>
  c.json({
    service: 'runtime',
    env: env.BRIVEN_ENV,
    buildSha: BUILD_SHA,
    buildAt: BUILD_AT,
    bootedAt: BOOT_TIME,
    uptimeSec: Math.floor(process.uptime()),
    executor: env.BRIVEN_RUNTIME_EXECUTOR,
  }),
);

app.get('/ready', async (c) => {
  const [apiOk, dpOk] = await Promise.all([probeApi(), probeDataPlane()]);
  const ready = apiOk && dpOk;
  return c.json(
    {
      status: ready ? 'ready' : 'not_ready',
      checks: {
        api: apiOk ? 'ok' : 'unreachable',
        data_plane_dolt: env.BRIVEN_URL
          ? dpOk
            ? 'ok'
            : 'unreachable'
          : 'not_configured',
      },
    },
    ready ? 200 : 503,
  );
});

async function probeApi(): Promise<boolean> {
  try {
    const res = await fetch(`${env.BRIVEN_API_INTERNAL_URL}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function probeDataPlane(): Promise<boolean> {
  if (!env.BRIVEN_URL) return false;
  try {
    // @README-DOLT: migrated from dynamic `import('postgres')` to static
    // `import('mysql2/promise')` for the readiness probe. Opens a single
    // connection, pings, and closes — never leaves a connection in the pool.
    const mysql2 = await import('mysql2/promise');
    const conn = await mysql2.createConnection({
      uri: env.BRIVEN_URL,
      connectTimeout: 2000,
    });
    await conn.ping();
    await conn.end();
    return true;
  } catch {
    return false;
  }
}

app.post('/invoke', async (c) => {
  const expected = env.BRIVEN_RUNTIME_SHARED_SECRET;
  if (expected) {
    const auth = c.req.header('authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : null;
    if (!token || !constantTimeEqual(token, expected)) {
      return c.json({ code: 'unauthorized', message: 'runtime is not open to the public' }, 401);
    }
  }

  const body = await c.req.json().catch(() => null);
  const parsed = invokeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { code: 'validation_failed', message: 'invalid request body', issues: parsed.error.issues },
      400,
    );
  }

  const result = await handleInvoke(parsed.data as InvokeRequest);
  // Always 200 — the business-level outcome is in the body. The runtime
  // treats user-code failures as data, not HTTP errors, so the control
  // plane can observe durations and error codes uniformly.
  return c.json(result);
});

// `/metrics` is intentionally unauthenticated — Prometheus scrapers run
// inside the swarm overlay network and the host firewall keeps the port
// off the public internet. Adding bearer-auth here would force every
// scrape config to manage a secret.
app.get('/metrics', async (c) => {
  const text = await renderPrometheus();
  return c.text(text, 200, { 'content-type': 'text/plain; version=0.0.4' });
});

// Eagerly construct the pool on boot so the gauge provider has a stable
// reference before the first scrape arrives. `getPool()` is idempotent —
// the singleton is shared with `handleInvoke`.
registerPoolGauges(getPool());

app.notFound((c) => c.json({ code: 'not_found', message: 'route not found' }, 404));

log.info('runtime_boot', {
  port: env.BRIVEN_RUNTIME_PORT,
  executor: env.BRIVEN_RUNTIME_EXECUTOR,
  bundleDir: env.BRIVEN_RUNTIME_BUNDLE_DIR,
});

export default {
  port: env.BRIVEN_RUNTIME_PORT,
  fetch: app.fetch,
};

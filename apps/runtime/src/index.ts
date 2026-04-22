import { Hono } from 'hono';
import { z } from 'zod';

import { env } from './env.js';
import { handleInvoke } from './invoke.js';
import type { InvokeRequest } from './types.js';

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

app.get('/ready', async (c) => {
  const [apiOk, dpOk] = await Promise.all([probeApi(), probeDataPlane()]);
  const ready = apiOk && dpOk;
  return c.json(
    {
      status: ready ? 'ready' : 'not_ready',
      checks: {
        api: apiOk ? 'ok' : 'unreachable',
        data_plane_postgres: env.BRIVEN_DATA_PLANE_URL
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
  if (!env.BRIVEN_DATA_PLANE_URL) return false;
  try {
    const postgresMod = await import('postgres');
    const sql = postgresMod.default(env.BRIVEN_DATA_PLANE_URL, {
      max: 1,
      connect_timeout: 2,
      prepare: false,
    });
    await sql`SELECT 1`;
    await sql.end({ timeout: 1 });
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
    if (token !== expected) {
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

app.notFound((c) => c.json({ code: 'not_found', message: 'route not found' }, 404));

console.log(
  JSON.stringify({
    event: 'runtime_boot',
    port: env.BRIVEN_RUNTIME_PORT,
    executor: env.BRIVEN_RUNTIME_EXECUTOR,
    bundleDir: env.BRIVEN_RUNTIME_BUNDLE_DIR,
  }),
);

export default {
  port: env.BRIVEN_RUNTIME_PORT,
  fetch: app.fetch,
};
